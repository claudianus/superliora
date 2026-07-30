/**
 * Runtime kitty graphics protocol detection.
 *
 * Env detection (`detectNativeTerminalImageProtocol`) misses kitty-capable
 * terminals whose environment does not advertise it: SSH sessions that drop
 * `KITTY_WINDOW_ID`, WezTerm with `enable_kitty_graphics = true`, Konsole,
 * Zed, and friends. The kitty graphics protocol defines an official support
 * query: a dummy load with `a=q` (query action) followed by a DA1 request.
 * A supporting terminal must answer the query (`ESC _ Gi=31;…ST/BEL`) before
 * the DA1 reply; a non-supporting terminal ignores the APC and only answers
 * DA1 (`ESC [ ? … c`). Graphics reply first → supported, DA1 first → not.
 *
 * The probe mirrors `queryOsc11` in `#/tui/theme/detect`: it must run before
 * the TUI enters raw mode and owns stdin, otherwise the reply is eaten by the
 * input loop. `runShell` awaits `initImageProtocolProbe()` in that same
 * pre-raw-mode boot window.
 */

import {
  detectNativeTerminalImageProtocol,
  type RendererInlineImageProtocol,
} from '#/tui/renderer';

/**
 * Official kitty graphics support query: a query-action dummy load with our
 * probe id (`i=31`) immediately followed by a DA1 request, so every terminal
 * produces some reply we can order against.
 */
export const KITTY_GRAPHICS_PROBE_QUERY =
  '\u001B_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\u001B\\\u001B[c';

/** Unsupported terminals never reply to the query; keep the boot delay small. */
export const KITTY_GRAPHICS_PROBE_TIMEOUT_MS = 400;

/** Explicit user override for the inline image protocol. */
export const IMAGE_PROTOCOL_OVERRIDE_ENV = 'SUPERLIORA_IMAGE_PROTOCOL';

export type KittyGraphicsProbeState = 'supported' | 'unsupported' | 'pending';

/**
 * A complete graphics response to our probe id: `ESC _ Gi=31;` + payload up to
 * ST (`ESC \`) or BEL. Some terminals terminate with BEL instead of ST, so
 * accept both. Requiring the terminator keeps fragmented replies 'pending'
 * until the full response has arrived.
 */
const KITTY_GRAPHICS_RESPONSE_PATTERN = /\u001B_Gi=31;[^\u0007\u001B]*(?:\u001B\\|\u0007)/;

/** DA1 (primary device attributes) reply from a terminal without graphics. */
const DA1_RESPONSE_PATTERN = /\u001B\[\?[0-9;]*c/;

/**
 * Parse the accumulated stdin buffer for the probe outcome. The graphics
 * response is checked before DA1 so a buffer containing both (graphics reply
 * followed by the DA1 answer) counts as supported.
 */
export function parseKittyGraphicsProbe(buffer: string): KittyGraphicsProbeState {
  if (KITTY_GRAPHICS_RESPONSE_PATTERN.test(buffer)) return 'supported';
  if (DA1_RESPONSE_PATTERN.test(buffer)) return 'unsupported';
  return 'pending';
}

interface RawModeStdin {
  isRaw?: boolean;
  setRawMode(mode: boolean): NodeJS.ReadStream;
  on(event: 'data', listener: (data: Buffer) => void): NodeJS.ReadStream;
  off(event: 'data', listener: (data: Buffer) => void): NodeJS.ReadStream;
}

/**
 * Ask the host terminal whether it implements the kitty graphics protocol.
 * Resolves `false` on timeout or any non-supporting reply; never throws.
 */
export async function probeKittyGraphicsSupport(opts?: {
  timeoutMs?: number;
}): Promise<boolean> {
  if (!(process.stdin.isTTY ?? false) || !(process.stdout.isTTY ?? false)) return false;
  const stdin = process.stdin as unknown as RawModeStdin;
  if (typeof stdin.setRawMode !== 'function') return false;
  // If something else is already listening on stdin (e.g. another raw-mode
  // consumer), don't fight for it — keep env-only detection.
  if (process.stdin.listenerCount('data') > 0) return false;

  const wasRaw = stdin.isRaw === true;
  let buffer = '';
  let listener: ((data: Buffer) => void) | null = null;
  let timer: NodeJS.Timeout | null = null;

  try {
    if (!wasRaw) stdin.setRawMode(true);

    return await new Promise<boolean>((resolve) => {
      listener = (chunk: Buffer): void => {
        buffer += chunk.toString('utf8');
        const state = parseKittyGraphicsProbe(buffer);
        if (state === 'supported') resolve(true);
        else if (state === 'unsupported') resolve(false);
      };
      stdin.on('data', listener);
      timer = setTimeout(() => {
        resolve(false);
      }, opts?.timeoutMs ?? KITTY_GRAPHICS_PROBE_TIMEOUT_MS);
      try {
        process.stdout.write(KITTY_GRAPHICS_PROBE_QUERY);
      } catch {
        resolve(false);
      }
    });
  } catch {
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (listener !== null) stdin.off('data', listener);
    if (!wasRaw) {
      try {
        stdin.setRawMode(false);
      } catch {
        /* ignore — raw mode restoration best-effort */
      }
    }
  }
}

/**
 * Runtime probe outcome: `true`/`false` once probed, `null` when the probe
 * was skipped (override set, env already decisive, CI, non-TTY, multiplexer).
 */
let probedKittyGraphics: boolean | null = null;

/**
 * Effective inline image protocol for the render path:
 *   1. `SUPERLIORA_IMAGE_PROTOCOL` override (kitty | iterm2 | none) wins;
 *   2. env detection (`detectNativeTerminalImageProtocol`);
 *   3. a positive runtime probe upgrades anything but `kitty` to `kitty`.
 */
export function resolveImageProtocol(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): RendererInlineImageProtocol {
  const override = env[IMAGE_PROTOCOL_OVERRIDE_ENV];
  if (override === 'kitty' || override === 'iterm2' || override === 'none') return override;
  const base = detectNativeTerminalImageProtocol(env);
  if (base !== 'kitty' && probedKittyGraphics === true) return 'kitty';
  return base;
}

/** Runtime probe outcome for diagnostics (`null` = probe not run). */
export function getProbedKittyGraphics(): boolean | null {
  return probedKittyGraphics;
}

export interface ImageProtocolProbeDeps {
  readonly env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  readonly probe?: typeof probeKittyGraphicsSupport;
  /** Overrides the `process.stdin/stdout.isTTY` check (tests). */
  readonly isInteractive?: boolean;
}

/**
 * Run the runtime probe once at boot, before the TUI grabs stdin. Skipped —
 * leaving state `null` — when the answer cannot change the effective
 * protocol or probing is pointless: explicit override, env detection already
 * says kitty, CI/dumb, non-TTY, or inside a multiplexer (tmux/zellij do not
 * pass the graphics protocol through by default).
 */
export async function initImageProtocolProbe(deps?: ImageProtocolProbeDeps): Promise<void> {
  const env = deps?.env ?? process.env;
  const override = env[IMAGE_PROTOCOL_OVERRIDE_ENV];
  if (override !== undefined && override !== '') return;
  if (detectNativeTerminalImageProtocol(env) === 'kitty') return;
  if (isCi(env) || isDumb(env)) return;
  if (hasEnv(env, 'TMUX') || hasEnv(env, 'ZELLIJ')) return;
  const interactive =
    deps?.isInteractive ??
    ((process.stdin.isTTY ?? false) && (process.stdout.isTTY ?? false));
  if (!interactive) return;

  const probe = deps?.probe ?? probeKittyGraphicsSupport;
  probedKittyGraphics = await probe();
}

export function resetImageProtocolProbeForTests(): void {
  probedKittyGraphics = null;
}

export function setProbedKittyGraphicsForTests(value: boolean | null): void {
  probedKittyGraphics = value;
}

function hasEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>, name: string): boolean {
  const value = env[name];
  return value !== undefined && value.length > 0;
}

function isDumb(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return (env['TERM'] ?? '').toLowerCase() === 'dumb';
}

function isCi(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  // Mirror the boot gate in `#/tui/theme/detect`: any CI value but ''/'0'.
  const value = env['CI'];
  return value !== undefined && value !== '' && value !== '0';
}

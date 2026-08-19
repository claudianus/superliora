import type { NativeTerminalEnvironment, NativeTerminalSynchronizedOutputSupport } from './features';

/**
 * Transport stability describes whether the terminal pipeline between the
 * renderer and the screen preserves frame atomicity. A `synchronized`
 * transport either honors DECSET 2026 or passes bytes through untouched, so
 * partial frames never tear. An `unstable` transport (classic Windows ConPTY)
 * re-serializes every write into its own console repaint: it strips 2026
 * semantics, splits writes, and strobes the cursor around each flush, so any
 * write can become visible flicker. On unstable transports the app must
 * minimize write count instead of relying on sync markers.
 */
export type RendererTransportStability = 'synchronized' | 'unstable';

/**
 * Frame-rate floor (ms) applied to non-interactive frames on unstable
 * transports. Classic ConPTY re-serializes every write into its own console
 * repaint with a cursor strobe, so the only way to keep streaming output from
 * strobing is to render less often. ~80ms (~12fps) keeps the spinner and
 * stream reveal legible while cutting repaint rate ~5x versus 60fps.
 * Interactive causes (input/resize) bypass the floor and stay immediate.
 */
export const UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS = 80;

export interface RendererTransportStabilityOptions {
  readonly platform?: string;
  readonly environment?: NativeTerminalEnvironment;
  readonly synchronizedOutputSupport?: NativeTerminalSynchronizedOutputSupport;
  readonly synchronizedOutputProbeTimedOut?: boolean;
}

/**
 * True when a DECRQM 2026 "supported" answer can be trusted to mean the
 * bytes between the renderer and the screen stay atomic. Windows Terminal
 * implements 2026 and holds frames, so it is trusted. Legacy conhost has no
 * synchronized-output support at all and re-serializes every write into its
 * own console repaint, so a "supported" answer there can only have come from
 * something in between and cannot be trusted.
 */
export function isTrustedWindowsSynchronizedHost(
  environment: NativeTerminalEnvironment = defaultEnvironment(),
  platform: string = defaultPlatform(),
): boolean {
  if (platform !== 'win32') return true;
  return (environment['WT_SESSION'] ?? '').trim().length > 0;
}

/**
 * Classify the transport. The DECRQM probe result is the ground truth only
 * when the host actually delivers atomic frames. On Windows, ConPTY can
 * answer "supported" from the outer emulator (Windows Terminal, xterm.js)
 * while still tearing every write — those stay `unstable`. When the probe
 * has no answer, Windows is presumed unstable; POSIX stays `synchronized`.
 */
export function resolveRendererTransportStability(
  options: RendererTransportStabilityOptions = {},
): RendererTransportStability {
  const environment = options.environment ?? defaultEnvironment();
  const override = transportStabilityOverride(environment);
  if (override !== undefined) return override;
  if (options.synchronizedOutputSupport === 'unsupported') return 'unstable';
  const platform = options.platform ?? defaultPlatform();
  if (options.synchronizedOutputSupport === 'supported') {
    return isTrustedWindowsSynchronizedHost(environment, platform)
      ? 'synchronized'
      : 'unstable';
  }
  return platform === 'win32' ? 'unstable' : 'synchronized';
}

/**
 * Resolve the unstable-transport frame floor. Defaults to
 * {@link UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS}; `0` / a negative value disables
 * the floor (restores full-rate pacing on unstable transports). Override via
 * `TUI_RENDERER_UNSTABLE_FRAME_INTERVAL_MS` for tuning.
 */
export function resolveUnstableTransportFrameIntervalMs(
  environment: NativeTerminalEnvironment = defaultEnvironment(),
): number {
  const raw =
    environment['TUI_RENDERER_UNSTABLE_FRAME_INTERVAL_MS'] ??
    environment['HARNESS_TUI_UNSTABLE_FRAME_INTERVAL_MS'];
  if (raw === undefined || raw.trim() === '') return UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS;
  return parsed;
}

function transportStabilityOverride(
  environment: NativeTerminalEnvironment,
): RendererTransportStability | undefined {
  const raw =
    environment['TUI_RENDERER_TRANSPORT_STABILITY'] ??
    environment['HARNESS_TUI_TRANSPORT_STABILITY'];
  const value = raw?.trim().toLowerCase();
  if (value === 'unstable') return 'unstable';
  if (value === 'synchronized') return 'synchronized';
  return undefined;
}

function defaultPlatform(): string {
  return typeof process !== 'undefined' ? process.platform : 'linux';
}

function defaultEnvironment(): NativeTerminalEnvironment {
  return typeof process !== 'undefined' ? process.env : {};
}

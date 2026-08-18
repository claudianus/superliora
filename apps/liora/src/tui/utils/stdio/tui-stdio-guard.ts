import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { join } from 'pathe';

import { isDebugSession } from '#/utils/debug-session';
import { getLogDir } from '#/utils/paths';

/** Reset the persist file once it grows past this so debug sessions cannot fill the disk. */
export const TUI_STDIO_LOG_MAX_BYTES = 1024 * 1024;

let stdioLogMaxBytes = TUI_STDIO_LOG_MAX_BYTES;

export function setTuiStdioLogMaxBytesForTest(bytes: number | undefined): void {
  stdioLogMaxBytes = bytes ?? TUI_STDIO_LOG_MAX_BYTES;
}

export type TuiStdioWrite = typeof process.stdout.write;

export interface TuiStdioGuard {
  readonly logPath: string;
  readonly captured: { stdout: number; stderr: number };
  /** Bound original stdout.write — pass this to the TUI renderer. */
  readonly ttyWrite: TuiStdioWrite;
  setOnDivert(hook: ((stream: 'stdout' | 'stderr', chunk: string) => void) | undefined): void;
  restore(): void;
}

export interface InstallTuiStdioGuardOptions {
  readonly logPath?: string;
  readonly onDivert?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

let mountedGuard: TuiStdioGuard | undefined;

/**
 * Install once while the TUI owns the screen. Subsequent calls return the
 * same guard so renderer + shutdown share one restore. A later `onDivert`
 * (status line) attaches without re-wrapping writes.
 */
export function ensureMountedTuiStdioGuard(
  options: InstallTuiStdioGuardOptions = {},
): TuiStdioGuard {
  if (mountedGuard !== undefined) {
    if (options.onDivert !== undefined) mountedGuard.setOnDivert(options.onDivert);
    return mountedGuard;
  }
  const installed = installTuiStdioGuard(options);
  mountedGuard = {
    ...installed,
    restore() {
      installed.restore();
      if (mountedGuard === this) mountedGuard = undefined;
    },
  };
  return mountedGuard;
}

export function restoreMountedTuiStdioGuard(): void {
  mountedGuard?.restore();
}

function chunkToString(chunk: unknown, encoding?: BufferEncoding): string {
  if (typeof chunk === 'string') return chunk;
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString(encoding ?? 'utf8');
  }
  return String(chunk);
}

function appendLog(
  logPath: string,
  stream: 'stdout' | 'stderr',
  text: string,
  state: { bytes: number },
): void {
  mkdirSync(dirname(logPath), { recursive: true });
  const line = `[${stream}] ${text}`;
  const nextBytes = state.bytes + Buffer.byteLength(line, 'utf8');
  if (state.bytes > 0 && nextBytes > stdioLogMaxBytes) {
    writeFileSync(logPath, line, 'utf8');
    state.bytes = Buffer.byteLength(line, 'utf8');
    return;
  }
  appendFileSync(logPath, line, 'utf8');
  state.bytes = nextBytes;
}

/** Persist diverted writes only when the caller asked or SuperLiora is in debug. */
function shouldPersistStdio(options: InstallTuiStdioGuardOptions): boolean {
  return options.logPath !== undefined || isDebugSession();
}

/**
 * Detach process.stdout / stderr from the TTY while the TUI owns the screen.
 * Writes go to an optional session log (debug or explicit `logPath`) and an
 * optional one-line status hook instead of painting over the editor cells.
 */
export function installTuiStdioGuard(options: InstallTuiStdioGuardOptions = {}): TuiStdioGuard {
  const logPath = options.logPath ?? join(getLogDir(), 'tui-stdio.log');
  const persist = shouldPersistStdio(options);
  const captured = { stdout: 0, stderr: 0 };
  const persistState = { bytes: 0 };
  const originalStdout = process.stdout.write.bind(process.stdout) as TuiStdioWrite;
  const originalStderr = process.stderr.write.bind(process.stderr) as TuiStdioWrite;
  let onDivert = options.onDivert;

  const divert =
    (stream: 'stdout' | 'stderr'): TuiStdioWrite =>
    ((chunk: unknown, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
      const enc = typeof encoding === 'function' ? undefined : encoding;
      const done = typeof encoding === 'function' ? encoding : cb;
      const text = chunkToString(chunk, enc);
      captured[stream] += 1;
      if (persist) {
        try {
          appendLog(logPath, stream, text.endsWith('\n') ? text : `${text}\n`, persistState);
        } catch {
          // Logging must never throw back into the TUI input path.
        }
      }
      onDivert?.(stream, text);
      done?.(null);
      return true;
    }) as TuiStdioWrite;

  process.stdout.write = divert('stdout');
  process.stderr.write = divert('stderr');

  return {
    logPath,
    captured,
    ttyWrite: originalStdout,
    setOnDivert(hook) {
      onDivert = hook;
    },
    restore() {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    },
  };
}

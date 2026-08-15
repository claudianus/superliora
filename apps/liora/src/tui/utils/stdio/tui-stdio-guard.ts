import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { join } from 'pathe';

import { getDataDir } from '#/utils/paths';

export type TuiStdioWrite = typeof process.stdout.write;

export interface TuiStdioGuard {
  readonly logPath: string;
  readonly captured: { stdout: number; stderr: number };
  restore(): void;
}

export interface InstallTuiStdioGuardOptions {
  readonly logPath?: string;
  readonly onDivert?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

function chunkToString(chunk: unknown, encoding?: BufferEncoding): string {
  if (typeof chunk === 'string') return chunk;
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString(encoding ?? 'utf8');
  }
  return String(chunk);
}

function appendLog(logPath: string, stream: 'stdout' | 'stderr', text: string): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `[${stream}] ${text}`, 'utf8');
}

/**
 * Detach process.stdout / stderr from the TTY while the TUI owns the screen.
 * Writes go to a session log (and an optional one-line status hook) instead of
 * painting over the editor cells.
 */
export function installTuiStdioGuard(options: InstallTuiStdioGuardOptions = {}): TuiStdioGuard {
  const logPath = options.logPath ?? join(getDataDir(), 'logs', 'tui-stdio.log');
  const captured = { stdout: 0, stderr: 0 };
  const originalStdout = process.stdout.write.bind(process.stdout) as TuiStdioWrite;
  const originalStderr = process.stderr.write.bind(process.stderr) as TuiStdioWrite;

  const divert =
    (stream: 'stdout' | 'stderr'): TuiStdioWrite =>
    ((chunk: unknown, encoding?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
      const enc = typeof encoding === 'function' ? undefined : encoding;
      const done = typeof encoding === 'function' ? encoding : cb;
      const text = chunkToString(chunk, enc);
      captured[stream] += 1;
      try {
        appendLog(logPath, stream, text.endsWith('\n') ? text : `${text}\n`);
      } catch {
        // Logging must never throw back into the TUI input path.
      }
      options.onDivert?.(stream, text);
      done?.(null);
      return true;
    }) as TuiStdioWrite;

  process.stdout.write = divert('stdout');
  process.stderr.write = divert('stderr');

  return {
    logPath,
    captured,
    restore() {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    },
  };
}

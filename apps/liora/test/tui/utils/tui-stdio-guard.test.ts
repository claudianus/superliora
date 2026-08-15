import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureMountedTuiStdioGuard,
  installTuiStdioGuard,
  restoreMountedTuiStdioGuard,
} from '#/tui/utils/stdio/tui-stdio-guard';

describe('tui-stdio-guard', () => {
  const dirs: string[] = [];

  afterEach(() => {
    restoreMountedTuiStdioGuard();
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('diverts stdout/stderr to a log and leaves ttyWrite as the real TTY write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tui-stdio-'));
    dirs.push(dir);
    const logPath = join(dir, 'tui-stdio.log');
    const ttyChunks: string[] = [];
    const originalStdout = process.stdout.write;
    process.stdout.write = ((chunk: unknown) => {
      ttyChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const guard = installTuiStdioGuard({ logPath });
      const draftBefore = 'keep-editor-value';

      process.stderr.write('forced-stderr-leak\n');
      process.stdout.write('forced-stdout-leak\n');
      guard.ttyWrite('renderer-frame\n');

      expect(draftBefore).toBe('keep-editor-value');
      expect(ttyChunks.join('')).toContain('renderer-frame');
      expect(ttyChunks.join('')).not.toContain('forced-stderr-leak');
      expect(ttyChunks.join('')).not.toContain('forced-stdout-leak');

      const logged = readFileSync(logPath, 'utf8');
      expect(logged).toContain('[stderr] forced-stderr-leak');
      expect(logged).toContain('[stdout] forced-stdout-leak');
      expect(guard.captured.stderr).toBeGreaterThan(0);
      expect(guard.captured.stdout).toBeGreaterThan(0);

      guard.restore();
    } finally {
      process.stdout.write = originalStdout;
    }
  });

  it('reuses one mounted guard and attaches onDivert later', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tui-stdio-'));
    dirs.push(dir);
    const logPath = join(dir, 'tui-stdio.log');
    const first = ensureMountedTuiStdioGuard({ logPath });
    const diverted: string[] = [];
    const second = ensureMountedTuiStdioGuard({
      onDivert: (_stream, chunk) => diverted.push(chunk),
    });

    expect(second).toBe(first);
    process.stderr.write('late-hook\n');
    expect(diverted.some((chunk) => chunk.includes('late-hook'))).toBe(true);
  });
});

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SUPERLIORA_DEBUG_ENV, SUPERLIORA_HOME_ENV } from '#/constant/app';
import { NativeTUIEditor } from '#/tui/components/editor/native-tui-editor';
import { createTerminalRenderer } from '#/tui/renderer/lifecycle';
import {
  ensureMountedTuiStdioGuard,
  installTuiStdioGuard,
  restoreMountedTuiStdioGuard,
  setTuiStdioLogMaxBytesForTest,
} from '#/tui/utils/stdio/tui-stdio-guard';

describe('tui-stdio-guard', () => {
  const dirs: string[] = [];

  afterEach(() => {
    restoreMountedTuiStdioGuard();
    setTuiStdioLogMaxBytesForTest(undefined);
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

  it('keeps process.stdout.write guarded after createTerminalRenderer and leaves the editor draft', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tui-stdio-'));
    dirs.push(dir);
    const logPath = join(dir, 'tui-stdio.log');
    const ttyChunks: string[] = [];
    const originalStdout = process.stdout.write;
    process.stdout.write = ((chunk: unknown) => {
      ttyChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    let renderer: ReturnType<typeof createTerminalRenderer> | undefined;
    try {
      const guard = ensureMountedTuiStdioGuard({ logPath });
      renderer = createTerminalRenderer();
      const editor = new NativeTUIEditor();
      editor.setText('keep-editor-value');

      process.stdout.write(
        'Error: compileUnsafe boom\n    at Module._load (node:internal/modules/cjs/loader:1:1)\n',
      );
      process.stderr.write(
        'Error: compileUnsafe boom\n    at Module._load (node:internal/modules/cjs/loader:1:1)\n',
      );

      expect(process.stdout.write).not.toBe(guard.ttyWrite);
      expect(ttyChunks.join('')).not.toContain('compileUnsafe');
      expect(readFileSync(logPath, 'utf8')).toContain('[stdout] Error: compileUnsafe');
      expect(editor.getText()).toBe('keep-editor-value');
    } finally {
      renderer?.stop();
      restoreMountedTuiStdioGuard();
      process.stdout.write = originalStdout;
    }
  });

  it('does not persist diverted writes unless debug or an explicit logPath is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tui-stdio-'));
    dirs.push(dir);
    const previousHome = process.env[SUPERLIORA_HOME_ENV];
    const previousDebug = process.env[SUPERLIORA_DEBUG_ENV];
    process.env[SUPERLIORA_HOME_ENV] = dir;
    delete process.env[SUPERLIORA_DEBUG_ENV];
    try {
      const guard = installTuiStdioGuard();
      process.stderr.write('no-persist\n');
      expect(existsSync(join(dir, 'logs', 'tui-stdio.log'))).toBe(false);
      expect(guard.captured.stderr).toBeGreaterThan(0);
      guard.restore();
    } finally {
      if (previousHome === undefined) delete process.env[SUPERLIORA_HOME_ENV];
      else process.env[SUPERLIORA_HOME_ENV] = previousHome;
      if (previousDebug === undefined) delete process.env[SUPERLIORA_DEBUG_ENV];
      else process.env[SUPERLIORA_DEBUG_ENV] = previousDebug;
    }
  });

  it('leaves renderer frame trace off unless SUPERLIORA_DEBUG is set', () => {
    const previousDebug = process.env[SUPERLIORA_DEBUG_ENV];
    delete process.env[SUPERLIORA_DEBUG_ENV];
    let renderer: ReturnType<typeof createTerminalRenderer> | undefined;
    try {
      renderer = createTerminalRenderer();
      expect(renderer.nativeRuntime.traceSnapshot.enabled).toBe(false);
    } finally {
      renderer?.stop();
      if (previousDebug === undefined) delete process.env[SUPERLIORA_DEBUG_ENV];
      else process.env[SUPERLIORA_DEBUG_ENV] = previousDebug;
    }
  });

  it('resets the persist file once it grows past the cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tui-stdio-'));
    dirs.push(dir);
    const logPath = join(dir, 'tui-stdio.log');
    setTuiStdioLogMaxBytesForTest(40);
    const guard = installTuiStdioGuard({ logPath });
    process.stderr.write('keep-this-first-line\n');
    process.stderr.write('reset-after-cap\n');
    const logged = readFileSync(logPath, 'utf8');
    expect(logged).not.toContain('keep-this-first-line');
    expect(logged).toContain('[stderr] reset-after-cap');
    guard.restore();
  });
});

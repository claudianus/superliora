/**
 * PATH lookup details that a naive stat-per-candidate loop gets wrong, all of
 * which end in a spawn the caller cannot recover from: a non-executable file
 * accepted on POSIX, a quoted PATH entry joined as literal characters, and a
 * Windows `.cmd`/`.bat` shim that only PATHEXT resolution finds.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { whichExecutable } from '../../src/utils/which';

let root: string | undefined;

function makeDir(name: string): string {
  const dir = join(root!, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFile(path: string, mode?: number): string {
  writeFileSync(path, '#!/bin/sh\n');
  if (mode !== undefined) chmodSync(path, mode);
  return path;
}

function withRoot(): string {
  root = mkdtempSync(join(tmpdir(), 'liora-which-'));
  return root;
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('whichExecutable', () => {
  it.skipIf(process.platform === 'win32')(
    'skips a non-executable file with the binary name and takes the runnable one',
    async () => {
      withRoot();
      const dataDir = makeDir('data');
      const binDir = makeDir('bin');
      // A data file that merely carries the name would turn every later spawn
      // into EACCES. Windows has no execute bit, so this rule is POSIX-only.
      makeFile(join(dataDir, 'rg'), 0o644);
      const runnable = makeFile(join(binDir, 'rg'), 0o755);

      const found = await whichExecutable('rg', { pathEnv: [dataDir, binDir].join(':') });

      expect(found).toBe(runnable);
    },
  );

  it('resolves a quoted PATH entry whose directory contains spaces', async () => {
    withRoot();
    const spaced = makeDir('Program Files/Git/cmd');
    const runnable = makeFile(join(spaced, process.platform === 'win32' ? 'rg.exe' : 'rg'), 0o755);

    const found = await whichExecutable('rg', { pathEnv: `"${spaced}"` });

    expect(found).toBe(runnable);
  });

  it('finds a Windows command shim through PATHEXT', async () => {
    withRoot();
    const shimDir = makeDir('npm');
    const shim = makeFile(join(shimDir, 'rg.cmd'));

    const found = await whichExecutable('rg', {
      platform: 'win32',
      pathEnv: shimDir,
      pathExt: '.cmd',
    });

    expect(found).toBe(shim);
  });

  it('returns null when the executable is not on PATH', async () => {
    withRoot();
    const empty = makeDir('empty');

    expect(await whichExecutable('rg', { pathEnv: empty })).toBeNull();
  });
});
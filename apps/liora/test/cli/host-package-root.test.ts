import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { handleBrowserUseCommand } from '#/cli/sub/browser-use';
import {
  hostPackageJsonSearchRoots,
  resolveHostPackageJsonPath,
} from '#/cli/version';
describe('host package root fallbacks', () => {
  it('finds bin/package.json from execPath when module dir has no manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'liora-host-pkg-'));
    const moduleDir = join(tmp, 'empty-module');
    const binDir = join(tmp, 'bin');
    mkdirSync(moduleDir);
    mkdirSync(binDir);
    const pkgPath = join(binDir, 'package.json');
    writeFileSync(pkgPath, '{"name":"superliora-host","private":true}\n');

    const roots = hostPackageJsonSearchRoots({
      moduleDir,
      execPath: join(binDir, 'liora.exe'),
      argv0: join(binDir, 'liora.exe'),
    });
    expect(resolveHostPackageJsonPath(roots)).toBe(pkgPath);
  });

  it('resolveHostPackageJsonPath returns undefined when search roots are empty', () => {
    expect(resolveHostPackageJsonPath([])).toBeUndefined();
  });
});

describe('handleBrowserUseCommand packaged host', () => {
  it('doctor tells the operator to restart from the source GUI when packageRoot is missing', async () => {
    const info = vi.fn();
    const stderr: string[] = [];

    await expect(handleBrowserUseCommand('doctor', {
      stdout: { write: () => true },
      stderr: { write: (chunk: string) => { stderr.push(chunk); return true; } },
      packageRoot: () => undefined,
      info,
    })).resolves.toBe(1);

    expect(info).not.toHaveBeenCalled();
    expect(stderr.join('')).toMatch(/source GUI|소스 GUI/i);
  });
});

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  loadPlaywrightCore,
  resolvePlaywrightCoreImportUrls,
} from '../src/browser/playwright-core-resolver';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pw-resolver-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function installFakePlaywrightCore(nodeModulesRoot: string, entryName = 'index.js'): string {
  const pkgRoot = join(nodeModulesRoot, 'playwright-core');
  mkdirSync(pkgRoot, { recursive: true });
  const entry = join(pkgRoot, entryName);
  writeFileSync(entry, 'export const chromium = {}; export const firefox = {};\n');
  return entry;
}

describe('playwright-core disk resolver', () => {
  it('finds playwright-core next to the installed binary layout', () => {
    const root = makeTempRoot();
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });
    const entry = installFakePlaywrightCore(join(root, 'node_modules'));

    const urls = resolvePlaywrightCoreImportUrls({
      execPath: join(binDir, 'liora.exe'),
      cwd: root,
    });
    expect(urls).toContain(pathToFileURL(entry).href);
  });

  it('finds playwright-core in the source workspace layout (cwd/packages/gui-use)', () => {
    const root = makeTempRoot();
    const entry = installFakePlaywrightCore(join(root, 'packages', 'gui-use', 'node_modules'));

    const urls = resolvePlaywrightCoreImportUrls({
      execPath: join(root, 'bin', 'liora.exe'),
      cwd: root,
    });
    expect(urls).toContain(pathToFileURL(entry).href);
  });

  it('loads the resolved module and surfaces chromium', async () => {
    const root = makeTempRoot();
    const entry = installFakePlaywrightCore(join(root, 'node_modules'));
    const seenUrls: string[] = [];

    const mod = await loadPlaywrightCore({
      execPath: join(root, 'bin', 'liora.exe'),
      cwd: root,
      importModule: async (url) => {
        seenUrls.push(url);
        return { chromium: {}, firefox: {} };
      },
    });
    expect(seenUrls).toEqual([pathToFileURL(entry).href]);
    expect(mod.chromium).toEqual({});
  });

  it('reports every tried root with a repair hint when missing', async () => {
    const root = makeTempRoot();
    await expect(
      loadPlaywrightCore({
        execPath: join(root, 'bin', 'liora.exe'),
        cwd: root,
        importModule: async () => {
          throw new Error('unreachable');
        },
      }),
    ).rejects.toThrow(/browser-use install/);
  });
});

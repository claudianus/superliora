import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  pickLaunch,
  resolveCloakBrowserLaunch,
  resolveCloakbrowserImportUrls,
} from '../src/browser/cloak-browser-launch';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('pickLaunch', () => {
  it('reads named launch export', () => {
    const launch = async () => undefined;
    expect(pickLaunch({ launch })).toBe(launch);
  });

  it('reads default.launch when named export is missing', () => {
    const launch = async () => undefined;
    expect(pickLaunch({ default: { launch } })).toBe(launch);
  });

  it('returns undefined for the SEA broken shape (empty namespace)', () => {
    expect(pickLaunch({})).toBeUndefined();
    expect(pickLaunch({ launch: undefined })).toBeUndefined();
    expect(pickLaunch(undefined)).toBeUndefined();
  });
});

describe('resolveCloakbrowserImportUrls', () => {
  it('finds cloakbrowser next to a fake install bin layout', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-cloak-launch-'));
    tempDirs.push(root);
    const binDir = join(root, 'bin');
    const packageRoot = join(root, 'node_modules', 'cloakbrowser');
    await mkdir(binDir, { recursive: true });
    await mkdir(join(packageRoot, 'dist'), { recursive: true });
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'cloakbrowser',
        type: 'module',
        exports: { '.': { import: './dist/index.js' } },
      }),
      'utf8',
    );
    await writeFile(
      join(packageRoot, 'dist', 'index.js'),
      'export async function launch() { return undefined; }\n',
      'utf8',
    );

    const urls = resolveCloakbrowserImportUrls({
      execPath: join(binDir, 'liora.exe'),
      cwd: join(root, 'unrelated-cwd'),
    });

    expect(urls).toContain(pathToFileURL(join(packageRoot, 'dist', 'index.js')).href);
  });
});

describe('resolveCloakBrowserLaunch', () => {
  it('loads launch from a fake SEA install layout via installRoot', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-cloak-launch-'));
    tempDirs.push(root);
    const binDir = join(root, 'bin');
    const packageRoot = join(root, 'node_modules', 'cloakbrowser');
    await mkdir(binDir, { recursive: true });
    await mkdir(join(packageRoot, 'dist'), { recursive: true });
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({
        name: 'cloakbrowser',
        type: 'module',
        exports: { '.': { import: './dist/index.js' } },
      }),
      'utf8',
    );
    await writeFile(
      join(packageRoot, 'dist', 'index.js'),
      'export async function launch() { return { ok: true }; }\n',
      'utf8',
    );

    const launch = await resolveCloakBrowserLaunch({
      execPath: join(binDir, 'liora.exe'),
      cwd: join(root, 'unrelated-cwd'),
      installRoot: root,
    });
    await expect(launch({} as never)).resolves.toEqual({ ok: true });
  });

  it('throws a diagnostic error when no launch binding exists', async () => {
    await expect(
      resolveCloakBrowserLaunch({
        importUrls: [],
        importModule: async () => ({}),
      }),
    ).rejects.toThrow(/cloakbrowser\.launch is unavailable/);
  });
});

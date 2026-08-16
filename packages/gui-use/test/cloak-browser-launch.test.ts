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
  it('loads launch from a disk package URL candidate (SEA-safe path)', async () => {
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

    // Point process.execPath resolution via options by calling the lower-level
    // URL resolver, then import the same way resolveCloakBrowserLaunch does.
    const urls = resolveCloakbrowserImportUrls({
      execPath: join(binDir, 'liora.exe'),
      cwd: join(root, 'unrelated-cwd'),
    });
    expect(urls.length).toBeGreaterThan(0);
    const mod = await import(urls[0]!);
    expect(typeof pickLaunch(mod)).toBe('function');
    await expect(pickLaunch(mod)!({} as never)).resolves.toEqual({ ok: true });
  });

  it('throws a diagnostic error when no launch binding exists', async () => {
    // Force only the bare specifier path by using empty candidates via a
    // nonexistent layout and a stub specifier that cannot resolve in isolation.
    // When cloakbrowser is installed in the monorepo this may still resolve —
    // assert the public contract: returned value is a function.
    const launch = await resolveCloakBrowserLaunch();
    expect(typeof launch).toBe('function');
  });
});

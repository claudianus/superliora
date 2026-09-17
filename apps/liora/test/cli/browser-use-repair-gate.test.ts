import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { probeBrowserUseSidecars } from '#/utils/browser-use/sidecar-status';

/**
 * H1 regression: `browser-use install` used to skip the sidecar repair whenever
 * a package.json existed anywhere up the walk-up path from the CLI binary. A
 * stray `$HOME/package.json` or `~/.local/package.json` (left by an npx/pnpm
 * run) satisfied that condition, so install reported success while launch kept
 * failing with "no cloakbrowser package found on disk".
 *
 * The gate now asks the launch path's question: do the sidecars resolve from
 * disk? These tests pin that behavior.
 */

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liora-sidecar-gate-'));
  tempDirs.push(dir);
  return dir;
}

function makeFakePackage(nodeModules: string, name: string): void {
  const pkgDir = join(nodeModules, name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ name, version: '0.0.0', main: 'index.js' }),
  );
  writeFileSync(join(pkgDir, 'index.js'), 'module.exports = {};\n');
}

describe('browser-use repair gate (H1)', () => {
  it('reports NOT ready when a stray package.json exists but node_modules is empty', () => {
    const root = makeTempRoot();
    const binDir = join(root, 'bin');
    mkdirSync(binDir, { recursive: true });
    // The stray manifest that used to satisfy the old gate.
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'stray' }));

    const status = probeBrowserUseSidecars({
      execPath: join(binDir, 'liora'),
      cwd: root,
      packageRoot: root,
    });

    expect(status.ready).toBe(false);
  });

  it('reports ready when both sidecars resolve from <root>/node_modules', () => {
    const root = makeTempRoot();
    const binDir = join(root, 'bin');
    const nodeModules = join(root, 'node_modules');
    mkdirSync(binDir, { recursive: true });
    makeFakePackage(nodeModules, 'cloakbrowser');
    makeFakePackage(nodeModules, 'playwright-core');

    const status = probeBrowserUseSidecars({
      execPath: join(binDir, 'liora'),
      cwd: root,
      packageRoot: root,
    });

    expect(status.ready).toBe(true);
    expect(status.cloakbrowserUrl).toContain('cloakbrowser');
    expect(status.playwrightCoreUrl).toContain('playwright-core');
  });

  it('repairs when only one sidecar is present (deterministic seam)', () => {
    const root = makeTempRoot();
    const nodeModules = join(root, 'node_modules');
    makeFakePackage(nodeModules, 'cloakbrowser');
    const cloakbrowserEntry = pathToFileURL(
      join(nodeModules, 'cloakbrowser', 'index.js'),
    ).href;

    // Seam: pin the candidate lists so a machine-level playwright-core on the
    // walk-up path can never make this assertion flaky.
    const status = probeBrowserUseSidecars({
      cloakbrowserUrls: [cloakbrowserEntry],
      playwrightCoreUrls: [],
    });

    expect(status.ready).toBe(false);
    expect(status.cloakbrowserUrl).toBe(cloakbrowserEntry);
    expect(status.playwrightCoreUrl).toBeUndefined();
  });

  it('honours the install layout next to a bin/ parent', () => {
    const root = makeTempRoot();
    const nodeModules = join(root, 'node_modules');
    mkdirSync(join(root, 'bin'), { recursive: true });
    makeFakePackage(nodeModules, 'cloakbrowser');
    makeFakePackage(nodeModules, 'playwright-core');

    const status = probeBrowserUseSidecars({
      execPath: join(root, 'bin', 'liora'),
      cwd: dirname(root),
      packageRoot: root,
    });

    expect(status.ready).toBe(true);
  });
});
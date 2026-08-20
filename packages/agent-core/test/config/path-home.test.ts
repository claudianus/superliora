import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultLioraHomePointerDir,
  isLioraHomePopulated,
  parseHomeRedirectText,
  readLioraHomeRedirect,
  resolveLioraHome,
  sameHomePath,
  writeLioraHomeRedirect,
} from '../../src/config/path';

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liora-home-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseHomeRedirectText', () => {
  it('skips comments and requires an absolute path', () => {
    expect(parseHomeRedirectText('# hi\n\n/data/SuperLiora\n')).toBe('/data/SuperLiora');
    expect(parseHomeRedirectText('relative/path')).toBeUndefined();
    expect(parseHomeRedirectText('')).toBeUndefined();
  });
});

describe('resolveLioraHome', () => {
  it('prefers explicit home, then SUPERLIORA_HOME, then redirect, then pointer dir', () => {
    const osHome = tempDir();
    const pointer = defaultLioraHomePointerDir(osHome);
    const relocated = join(osHome, 'data-drive', 'SuperLiora');
    writeLioraHomeRedirect(relocated, osHome);

    expect(resolveLioraHome('/explicit', { osHome, env: {} })).toBe('/explicit');
    expect(
      resolveLioraHome(undefined, { osHome, env: { SUPERLIORA_HOME: '/from-env' } }),
    ).toBe('/from-env');
    expect(sameHomePath(resolveLioraHome(undefined, { osHome, env: {} }), relocated)).toBe(true);
    writeLioraHomeRedirect(pointer, osHome);
    expect(resolveLioraHome(undefined, { osHome, env: {} })).toBe(pointer);
  });
});

describe('read/write home.redirect', () => {
  it('ignores a redirect that points at the pointer dir', () => {
    const osHome = tempDir();
    const pointer = defaultLioraHomePointerDir(osHome);
    writeLioraHomeRedirect(pointer, osHome);
    expect(readLioraHomeRedirect(pointer)).toBeUndefined();
  });
});

describe('isLioraHomePopulated', () => {
  it('treats config.toml as populated and an empty pointer as empty', () => {
    const home = tempDir();
    expect(isLioraHomePopulated(home)).toBe(false);
    writeFileSync(join(home, 'config.toml'), 'x', 'utf8');
    expect(isLioraHomePopulated(home)).toBe(true);
  });

  it('treats a sessions directory with entries as populated', () => {
    const home = tempDir();
    mkdirSync(join(home, 'sessions', 'wd'), { recursive: true });
    expect(isLioraHomePopulated(home)).toBe(true);
  });
});

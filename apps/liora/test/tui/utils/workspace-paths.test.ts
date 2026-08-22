import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  displayWorkspacePath,
  expandUserPath,
  isGenericLaunchDir,
  listWorkspaceChildren,
  looksLikeProjectRoot,
  resolveExistingWorkspaceDir,
  sameWorkspaceDir,
} from '#/tui/utils/workspace/paths';
import { uniqueRecentWorkDirs } from '#/tui/utils/workspace/recents';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liora-ws-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('workspace path helpers', () => {
  it('treats home / Desktop / Documents as generic launch dirs unless they look like a project', () => {
    const home = makeTempDir();
    const desktop = join(home, 'Desktop');
    const documents = join(home, 'Documents');
    mkdirSync(desktop);
    mkdirSync(documents);
    const other = makeTempDir();
    expect(isGenericLaunchDir(home, { home, exists: () => false })).toBe(true);
    expect(isGenericLaunchDir(desktop, { home, exists: () => false })).toBe(true);
    expect(isGenericLaunchDir(documents, { home, exists: () => false })).toBe(true);
    expect(isGenericLaunchDir(other, { home, exists: () => false })).toBe(false);
    expect(
      isGenericLaunchDir(home, {
        home,
        exists: (path) => path.replaceAll('\\', '/').endsWith('/.git'),
      }),
    ).toBe(false);
  });

  it('detects project markers', () => {
    const root = makeTempDir();
    expect(looksLikeProjectRoot(root)).toBe(false);
    writeFileSync(join(root, 'package.json'), '{}\n');
    expect(looksLikeProjectRoot(root)).toBe(true);
  });

  it('expands ~ and aliases home in display paths', () => {
    const home = makeTempDir();
    const nested = join(home, 'code');
    mkdirSync(nested);
    expect(expandUserPath('~/code', home)).toBe(join(home, 'code'));
    expect(displayWorkspacePath(nested, home).replaceAll('\\', '/')).toBe('~/code');
    expect(sameWorkspaceDir(nested, join(home, 'code', '..', 'code'))).toBe(true);
  });

  it('resolves existing directories and rejects files', () => {
    const root = makeTempDir();
    const file = join(root, 'readme.txt');
    writeFileSync(file, 'hi\n');
    expect(resolveExistingWorkspaceDir(root)).toEqual({ ok: true, path: root });
    expect(resolveExistingWorkspaceDir(file)).toMatchObject({ ok: false, reason: 'not-dir' });
    expect(resolveExistingWorkspaceDir(join(root, 'missing'))).toMatchObject({
      ok: false,
      reason: 'missing',
    });
    expect(resolveExistingWorkspaceDir('  ')).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('lists child directories and ranks unique recents', () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'alpha'));
    mkdirSync(join(root, 'beta'));
    mkdirSync(join(root, 'node_modules'));
    const children = listWorkspaceChildren(root).map((path) => path.replaceAll('\\', '/'));
    expect(children.some((path) => path.endsWith('/alpha'))).toBe(true);
    expect(children.some((path) => path.endsWith('/beta'))).toBe(true);
    expect(children.some((path) => path.endsWith('/node_modules'))).toBe(false);

    const a = join(root, 'a');
    const b = join(root, 'b');
    const c = join(root, 'c');
    mkdirSync(a);
    mkdirSync(b);
    mkdirSync(c);
    expect(
      uniqueRecentWorkDirs(
        [
          { workDir: b, updatedAt: 2 },
          { workDir: a, updatedAt: 5 },
          { workDir: a, updatedAt: 9 },
          { workDir: c, updatedAt: 1 },
        ],
        { exclude: c, limit: 2 },
      ),
    ).toEqual([a, b]);
  });
});

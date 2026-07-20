/* eslint-disable import/first -- vi.mock setup must run before the imports it stubs out. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
}));

import {
  buildFileTree,
  filterFileTree,
  flattenVisibleTree,
  listProjectFiles,
} from '#/utils/fs/file-tree';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'liora-file-tree-'));
}

describe('buildFileTree', () => {
  it('returns [] for empty or blank input', () => {
    expect(buildFileTree([])).toEqual([]);
    expect(buildFileTree(['', '/', '//'])).toEqual([]);
  });

  it('nests deep slash-separated paths', () => {
    const tree = buildFileTree(['src/nested/deep/gamma.ts']);
    expect(tree).toHaveLength(1);
    const src = tree[0]!;
    expect(src).toMatchObject({ name: 'src', path: 'src', kind: 'directory' });
    const nested = src.children?.[0];
    expect(nested).toMatchObject({ name: 'nested', path: 'src/nested', kind: 'directory' });
    const deep = nested?.children?.[0];
    expect(deep).toMatchObject({ name: 'deep', path: 'src/nested/deep', kind: 'directory' });
    const file = deep?.children?.[0];
    expect(file).toMatchObject({
      name: 'gamma.ts',
      path: 'src/nested/deep/gamma.ts',
      kind: 'file',
    });
    expect(file?.children).toBeUndefined();
  });

  it('sorts directories first, then case-insensitive name order', () => {
    const tree = buildFileTree([
      'src/beta.ts',
      'src/alpha.ts',
      'README.md',
      'src/nested/gamma.ts',
      'Zeta.md',
    ]);
    // Top level: the directory comes first, then files case-insensitively.
    expect(tree.map((n) => n.name)).toEqual(['src', 'README.md', 'Zeta.md']);
    expect(tree.map((n) => n.kind)).toEqual(['directory', 'file', 'file']);
    // Within src: directory first, then files alphabetically.
    const src = tree[0]!;
    expect(src.children?.map((n) => n.name)).toEqual(['nested', 'alpha.ts', 'beta.ts']);
  });

  it('is case-insensitive regardless of input order', () => {
    const tree = buildFileTree(['b.ts', 'A.ts', 'c.ts']);
    expect(tree.map((n) => n.name)).toEqual(['A.ts', 'b.ts', 'c.ts']);
  });

  it('promotes a file to a directory when a deeper path needs it', () => {
    const tree = buildFileTree(['pkg', 'pkg/index.ts']);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'pkg', kind: 'directory' });
    expect(tree[0]?.children?.map((n) => n.name)).toEqual(['index.ts']);
  });
});

describe('flattenVisibleTree', () => {
  const tree = buildFileTree(['a/b.ts', 'a/c.ts', 'd.ts']);

  it('lists only top-level rows when everything is collapsed', () => {
    const rows = flattenVisibleTree(tree, () => false);
    expect(rows.map((r) => r.node.path)).toEqual(['a', 'd.ts']);
    expect(rows.map((r) => r.depth)).toEqual([0, 0]);
  });

  it('descends into expanded directories with incremented depth', () => {
    const rows = flattenVisibleTree(tree, (path) => path === 'a');
    expect(rows.map((r) => r.node.path)).toEqual(['a', 'a/b.ts', 'a/c.ts', 'd.ts']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0]);
  });
});

describe('filterFileTree', () => {
  const tree = buildFileTree(['src/app.ts', 'src/util/helper.ts', 'README.md', 'package.json']);

  it('returns the input nodes and total file count for an empty or blank query', () => {
    expect(filterFileTree(tree, '')).toEqual({ nodes: tree, matchCount: 4 });
    expect(filterFileTree(tree, '   ')).toEqual({ nodes: tree, matchCount: 4 });
    // The original array is passed through unchanged (same reference).
    expect(filterFileTree(tree, '').nodes).toBe(tree);
  });

  it('keeps ancestor directories of a matching file path', () => {
    const result = filterFileTree(tree, 'helper');
    expect(result.nodes.map((n) => n.name)).toEqual(['src']);
    const src = result.nodes[0]!;
    expect(src.children?.map((n) => n.name)).toEqual(['util']);
    expect(src.children?.[0]?.children?.map((n) => n.name)).toEqual(['helper.ts']);
    expect(result.matchCount).toBe(1);
  });

  it('keeps all children when a directory name matches', () => {
    const docs = buildFileTree(['docs/guide.md', 'docs/api/reference.md', 'src/index.ts']);
    const result = filterFileTree(docs, 'docs');
    expect(result.nodes.map((n) => n.name)).toEqual(['docs']);
    const kept = result.nodes[0]!;
    expect(kept.children?.map((n) => n.name)).toEqual(['api', 'guide.md']);
    expect(kept.children?.find((n) => n.name === 'api')?.children?.map((n) => n.name)).toEqual([
      'reference.md',
    ]);
    // Both files live under the matched directory; directories never count.
    expect(result.matchCount).toBe(2);
  });

  it('counts matching files only, never directories', () => {
    // "src" matches the directory name and the file paths under it.
    const result = filterFileTree(tree, 'src');
    expect(result.nodes.map((n) => n.name)).toEqual(['src']);
    expect(result.matchCount).toBe(2); // app.ts + helper.ts, not the src dir
  });

  it('matches case-insensitively and trims the query', () => {
    expect(filterFileTree(tree, 'README').matchCount).toBe(1);
    expect(filterFileTree(tree, ' readme ').nodes.map((n) => n.name)).toEqual(['README.md']);
    expect(filterFileTree(tree, '  PACKAGE  ').matchCount).toBe(1);
  });

  it('returns empty nodes and zero matches when nothing matches', () => {
    const result = filterFileTree(tree, 'zzz');
    expect(result.nodes).toEqual([]);
    expect(result.matchCount).toBe(0);
  });

  it('preserves the original sort order without re-sorting', () => {
    const ordered = buildFileTree(['b/2.ts', 'b/1.ts', 'a/z.ts', 'a/y.ts']);
    const result = filterFileTree(ordered, '.ts');
    expect(result.nodes.map((n) => n.name)).toEqual(['a', 'b']);
    expect(result.nodes[0]?.children?.map((n) => n.name)).toEqual(['y.ts', 'z.ts']);
    expect(result.nodes[1]?.children?.map((n) => n.name)).toEqual(['1.ts', '2.ts']);
    expect(result.matchCount).toBe(4);
  });
});

describe('listProjectFiles', () => {
  beforeEach(() => {
    mocks.execFileSync.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('parses NUL-separated git ls-files output and sorts it', () => {
    mocks.execFileSync.mockReturnValue('src/b.ts\0src/a.ts\0README.md\0');
    const result = listProjectFiles('/some/repo');
    expect(result.source).toBe('git');
    expect(result.truncated).toBe(false);
    expect(result.paths).toEqual(['README.md', 'src/a.ts', 'src/b.ts']);
    // Invokes git ls-files (tracked + untracked, gitignore-respecting, -z).
    const [cmd, args] = mocks.execFileSync.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('git');
    expect(args).toContain('ls-files');
    expect(args).toContain('-z');
    expect(args).toContain('--others');
  });

  it('caps git results at maxEntries and flags truncated', () => {
    mocks.execFileSync.mockReturnValue('c\0a\0b\0');
    const result = listProjectFiles('/some/repo', { maxEntries: 2 });
    expect(result.source).toBe('git');
    expect(result.truncated).toBe(true);
    expect(result.paths).toEqual(['a', 'b']);
  });

  it('falls back to a pruned walk when git fails', () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    const dir = makeTempDir();
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
      mkdirSync(join(dir, '.git'), { recursive: true });
      mkdirSync(join(dir, '.github'), { recursive: true });
      mkdirSync(join(dir, '.secret'), { recursive: true });
      writeFileSync(join(dir, 'src', 'index.ts'), 'x');
      writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'x');
      writeFileSync(join(dir, '.git', 'config'), 'x');
      writeFileSync(join(dir, '.github', 'workflow.yml'), 'x');
      writeFileSync(join(dir, '.secret', 'key'), 'x');
      writeFileSync(join(dir, '.npmrc'), 'x');
      writeFileSync(join(dir, 'README.md'), 'x');

      const result = listProjectFiles(dir);
      expect(result.source).toBe('walk');
      expect(result.truncated).toBe(false);
      expect(result.paths).toContain('src/index.ts');
      expect(result.paths).toContain('README.md');
      expect(result.paths).toContain('.npmrc'); // hidden files are kept
      expect(result.paths).toContain('.github/workflow.yml'); // .github is kept
      expect(result.paths).not.toContain('node_modules/pkg/index.js');
      expect(result.paths).not.toContain('.git/config');
      expect(result.paths).not.toContain('.secret/key'); // hidden dirs pruned
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caps the walk at maxEntries and flags truncated', () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('git missing');
    });
    const dir = makeTempDir();
    try {
      for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${String(i)}.txt`), 'x');
      const result = listProjectFiles(dir, { maxEntries: 3 });
      expect(result.source).toBe('walk');
      expect(result.truncated).toBe(true);
      expect(result.paths).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

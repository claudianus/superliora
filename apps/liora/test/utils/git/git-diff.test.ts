import { describe, expect, it } from 'vitest';

import { MAX_FILE_LINES, MAX_TOTAL_LINES, parseUnifiedDiff } from '#/utils/git/git-diff';

function addedFileDiff(path: string, count: number): string {
  const lines = [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    'index 0000000..1111111 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${String(count)} @@`,
  ];
  for (let i = 1; i <= count; i++) lines.push(`+line ${String(i)}`);
  return lines.join('\n');
}

describe('parseUnifiedDiff', () => {
  it('returns [] for empty or whitespace-only input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('  \n\n  ')).toEqual([]);
  });

  it('parses an added file as fully-added lines', () => {
    const [file] = parseUnifiedDiff(addedFileDiff('src/new.ts', 3));
    expect(file?.path).toBe('src/new.ts');
    expect(file?.status).toBe('added');
    expect(file?.added).toBe(3);
    expect(file?.deleted).toBe(0);
    expect(file?.lines.map((l) => l.kind)).toEqual(['add', 'add', 'add']);
    expect(file?.lines.map((l) => l.lineNum)).toEqual([1, 2, 3]);
    expect(file?.lines[0]?.code).toBe('line 1');
  });

  it('parses a modified file with context, add, and delete lines', () => {
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1234567..abcdefg 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,3 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const B = 2;',
      ' const c = 3;',
    ].join('\n');
    const [file] = parseUnifiedDiff(diff);
    expect(file?.path).toBe('src/app.ts');
    expect(file?.status).toBe('modified');
    expect(file?.added).toBe(1);
    expect(file?.deleted).toBe(1);
    expect(file?.lines.map((l) => l.kind)).toEqual(['context', 'delete', 'add', 'context']);
    // context/add numbered on the new side, delete on the old side.
    expect(file?.lines.map((l) => l.lineNum)).toEqual([1, 2, 2, 3]);
    expect(file?.lines[1]?.code).toBe('const b = 2;');
    expect(file?.lines[2]?.code).toBe('const B = 2;');
  });

  it('parses a deleted file', () => {
    const diff = [
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      'index abcdef0..0000000 100644',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line one',
      '-line two',
    ].join('\n');
    const [file] = parseUnifiedDiff(diff);
    expect(file?.path).toBe('old.ts');
    expect(file?.status).toBe('deleted');
    expect(file?.added).toBe(0);
    expect(file?.deleted).toBe(2);
    expect(file?.lines.map((l) => l.kind)).toEqual(['delete', 'delete']);
    expect(file?.lines.map((l) => l.lineNum)).toEqual([1, 2]);
  });

  it('parses a renamed file with oldPath preserved', () => {
    const diff = [
      'diff --git a/old-name.ts b/new-name.ts',
      'similarity index 95%',
      'rename from old-name.ts',
      'rename to new-name.ts',
      'index abcdef0..1234567 100644',
      '--- a/old-name.ts',
      '+++ b/new-name.ts',
      '@@ -1,1 +1,1 @@',
      '-const old = 1;',
      '+const renamed = 1;',
    ].join('\n');
    const [file] = parseUnifiedDiff(diff);
    expect(file?.path).toBe('new-name.ts');
    expect(file?.oldPath).toBe('old-name.ts');
    expect(file?.status).toBe('renamed');
    expect(file?.added).toBe(1);
    expect(file?.deleted).toBe(1);
  });

  it('parses a binary file as a line-less entry', () => {
    const diff = [
      'diff --git a/assets/img.png b/assets/img.png',
      'index abcdef0..1234567 100644',
      'Binary files a/assets/img.png and b/assets/img.png differ',
    ].join('\n');
    const [file] = parseUnifiedDiff(diff);
    expect(file?.path).toBe('assets/img.png');
    expect(file?.status).toBe('binary');
    expect(file?.lines).toEqual([]);
    expect(file?.added).toBe(0);
    expect(file?.deleted).toBe(0);
  });

  it('parses multiple hunks in one file and skips @@ headers', () => {
    const diff = [
      'diff --git a/big.ts b/big.ts',
      'index abcdef0..1234567 100644',
      '--- a/big.ts',
      '+++ b/big.ts',
      '@@ -1,3 +1,3 @@ function top()',
      ' a',
      '-b',
      '+B',
      ' c',
      '@@ -10,3 +10,3 @@ function bottom()',
      ' x',
      '-y',
      '+Y',
      ' z',
    ].join('\n');
    const [file] = parseUnifiedDiff(diff);
    expect(file?.added).toBe(2);
    expect(file?.deleted).toBe(2);
    // No @@ header rows leak into the body.
    expect(file?.lines.every((l) => l.kind === 'context' || l.kind === 'add' || l.kind === 'delete')).toBe(true);
    expect(file?.lines).toHaveLength(8);
    // Second hunk restarts numbering at the new start (10).
    expect(file?.lines[4]?.lineNum).toBe(10);
  });

  it('skips the "no newline" marker', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      'index abcdef0..1234567 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
    ].join('\n');
    const [file] = parseUnifiedDiff(diff);
    expect(file?.lines.map((l) => l.kind)).toEqual(['delete', 'add']);
  });

  it('caps per-file lines but keeps true added/deleted counts', () => {
    const [file] = parseUnifiedDiff(addedFileDiff('big.ts', 25), { maxFileLines: 10 });
    expect(file?.lines).toHaveLength(10);
    expect(file?.added).toBe(25);
  });

  it('applies the default per-file cap', () => {
    const [file] = parseUnifiedDiff(addedFileDiff('big.ts', MAX_FILE_LINES + 50));
    expect(file?.lines).toHaveLength(MAX_FILE_LINES);
    expect(file?.added).toBe(MAX_FILE_LINES + 50);
  });

  it('caps total lines across files once the budget is exhausted', () => {
    const text = `${addedFileDiff('a.ts', 10)}\n${addedFileDiff('b.ts', 10)}`;
    const files = parseUnifiedDiff(text, { maxFileLines: 100, maxTotalLines: 15 });
    expect(files).toHaveLength(2);
    expect(files[0]?.lines).toHaveLength(10);
    expect(files[1]?.lines).toHaveLength(5);
    // Stats stay accurate even when the body is truncated.
    expect(files[1]?.added).toBe(10);
  });

  it('respects the default total cap constant', () => {
    expect(MAX_TOTAL_LINES).toBeGreaterThan(MAX_FILE_LINES);
  });
});

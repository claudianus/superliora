import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CodeIndexer } from '#/codemap/indexer';

describe('CodeIndexer (explicit file list)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'code-indexer-'));
    writeFileSync(join(dir, 'a.ts'), 'export function alpha() {}\nfunction hidden() {}\n');
    writeFileSync(join(dir, 'b.ts'), 'export const beta = 1;\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const makeIndexer = (files: string[]): CodeIndexer =>
    new CodeIndexer({ root: dir, dbPath: ':memory:', files });

  it('indexes all files on the first pass and answers queries', () => {
    const indexer = makeIndexer(['a.ts', 'b.ts']);
    const report = indexer.update();
    expect(report).toMatchObject({ scanned: 2, indexed: 2, skipped: 0, removed: 0 });
    expect(report.symbols).toBeGreaterThanOrEqual(3);
    expect(indexer.find('alpha')[0]).toMatchObject({ kind: 'function', line: 1, exported: true });
    expect(indexer.find('hidden')[0]).toMatchObject({ exported: false });
    expect(indexer.find('beta')[0]).toMatchObject({ kind: 'variable', exported: true });
    indexer.close();
  });

  it('skips unchanged files and re-indexes edited ones', () => {
    const indexer = makeIndexer(['a.ts', 'b.ts']);
    indexer.update();
    const noop = indexer.update();
    expect(noop).toMatchObject({ scanned: 2, indexed: 0, skipped: 2 });
    writeFileSync(join(dir, 'b.ts'), 'export const beta = 2;\nexport const gamma = 3;\n');
    const incremental = indexer.update();
    expect(incremental).toMatchObject({ scanned: 2, indexed: 1, skipped: 1 });
    expect(indexer.find('gamma')).toHaveLength(1);
    indexer.close();
  });

  it('prunes files dropped from the traversal set', () => {
    const indexer = makeIndexer(['a.ts', 'b.ts']);
    indexer.update();
    const pruned = new CodeIndexer({ root: dir, dbPath: ':memory:', files: ['a.ts'] });
    // Fresh :memory: store has nothing to prune; verify pruning via the same store path instead.
    pruned.close();
    const dirDb = join(dir, 'index.sqlite');
    const persistent = new CodeIndexer({ root: dir, dbPath: dirDb, files: ['a.ts', 'b.ts'] });
    persistent.update();
    const narrowed = new CodeIndexer({ root: dir, dbPath: dirDb, files: ['a.ts'] });
    const report = narrowed.update();
    expect(report.removed).toBe(1);
    expect(narrowed.find('beta')).toEqual([]);
    narrowed.close();
    persistent.close();
  });
});

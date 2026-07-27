import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { IndexedSymbol } from '#/codemap/extract';
import { SymbolIndexStore } from '#/codemap/store';

function sym(name: string, line: number, exported = true): IndexedSymbol {
  return { name, kind: 'function', line, exported, defaultExport: false };
}

describe('SymbolIndexStore', () => {
  const tempDirs: string[] = [];
  const makeStore = (memory = true): SymbolIndexStore => {
    if (memory) return new SymbolIndexStore(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'symbol-index-store-'));
    tempDirs.push(dir);
    return new SymbolIndexStore(join(dir, 'index.sqlite'));
  };

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop() as string, { recursive: true, force: true });
    }
  });

  it('round-trips symbols and reports counts', () => {
    const store = makeStore();
    store.upsertFile('/a.ts', 'h1', [sym('alpha', 3), sym('beta', 7, false)]);
    expect(store.fileCount()).toBe(1);
    expect(store.symbolCount()).toBe(2);
    expect(store.findByName('alpha')).toEqual([
      { path: '/a.ts', name: 'alpha', kind: 'function', line: 3, exported: true, defaultExport: false },
    ]);
    expect(store.findByName('missing')).toEqual([]);
    store.close();
  });

  it('replaces symbols on re-index of the same path', () => {
    const store = makeStore();
    store.upsertFile('/a.ts', 'h1', [sym('alpha', 3), sym('gone', 9)]);
    store.upsertFile('/a.ts', 'h2', [sym('alpha', 4)]);
    expect(store.getFileHash('/a.ts')).toBe('h2');
    expect(store.symbolCount()).toBe(1);
    expect(store.findByName('gone')).toEqual([]);
    expect(store.findByName('alpha')[0]?.line).toBe(4);
    store.close();
  });

  it('removes files and prunes absent paths', () => {
    const store = makeStore();
    store.upsertFile('/a.ts', 'h1', [sym('alpha', 1)]);
    store.upsertFile('/b.ts', 'h2', [sym('beta', 1)]);
    expect(store.removeFile('/a.ts')).toBe(true);
    expect(store.removeFile('/a.ts')).toBe(false);
    expect(store.removeAbsentFiles(new Set(['/b.ts']))).toBe(0);
    expect(store.removeAbsentFiles(new Set<string>())).toBe(1);
    expect(store.fileCount()).toBe(0);
    expect(store.symbolCount()).toBe(0);
    store.close();
  });

  it('persists across close and reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'symbol-index-persist-'));
    tempDirs.push(dir);
    const dbPath = join(dir, 'index.sqlite');
    const first = new SymbolIndexStore(dbPath);
    first.upsertFile('/a.ts', 'h1', [sym('alpha', 2)]);
    first.close();
    const second = new SymbolIndexStore(dbPath);
    expect(second.getFileHash('/a.ts')).toBe('h1');
    expect(second.findByName('alpha')).toHaveLength(1);
    second.close();
  });
});

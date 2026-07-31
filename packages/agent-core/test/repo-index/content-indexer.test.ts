import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONTENT_INDEX_MAX_BYTES,
  CONTENT_INDEX_MAX_FILES,
  ContentIndexer,
  escapeFts5Token,
} from '#/repo-index/content-indexer';

describe('ContentIndexer (explicit file list)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'content-indexer-'));
    writeFileSync(join(dir, 'sample.ts'), 'const UniqueFtsProbeToken = 42;\nexport function demo() {}\n');
    writeFileSync(join(dir, 'notes.md'), '# docs\nUniqueFtsProbeToken appears here too.\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const makeIndexer = (files: string[]): ContentIndexer =>
    new ContentIndexer({ root: dir, dbPath: ':memory:', files });

  it('indexes lines and returns path:Lline body hits', () => {
    const indexer = makeIndexer(['sample.ts', 'notes.md']);
    const report = indexer.update();
    expect(report).toMatchObject({ scanned: 2, indexed: 2 });
    expect(report.lines).toBeGreaterThanOrEqual(3);

    const hits = indexer.query('UniqueFtsProbeToken', undefined, 10);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]).toMatch(/^sample\.ts:L\d+ /);
    expect(hits[0]).toContain('UniqueFtsProbeToken');

    indexer.close();
  });

  it('scopes hits by path prefix', () => {
    const indexer = makeIndexer(['sample.ts', 'notes.md']);
    indexer.update();

    const scoped = indexer.query('UniqueFtsProbeToken', 'notes', 10);
    expect(scoped.length).toBeGreaterThanOrEqual(1);
    expect(scoped[0]).toMatch(/^notes\.md:L/);

    const miss = indexer.query('UniqueFtsProbeToken', 'missing', 10);
    expect(miss).toEqual([]);

    indexer.close();
  });

  it('respects file and byte caps', () => {
    for (let i = 0; i < CONTENT_INDEX_MAX_FILES + 5; i++) {
      writeFileSync(join(dir, `f${String(i)}.txt`), `token${String(i)}\n`);
    }
    const indexer = new ContentIndexer({
      root: dir,
      dbPath: ':memory:',
      maxFiles: 3,
      maxBytes: 64,
    });
    const report = indexer.update();
    expect(report.indexed).toBeLessThanOrEqual(3);
    expect(report.bytes).toBeLessThanOrEqual(64);
    indexer.close();
  });

  it('escapeFts5Token rejects empty and unsafe queries', () => {
    expect(escapeFts5Token('')).toBeNull();
    expect(escapeFts5Token('  ')).toBeNull();
    expect(escapeFts5Token('foo bar')).toBeNull();
    expect(escapeFts5Token('needle')).toBe('"needle"');
  });

  it('exports safety caps for callers', () => {
    expect(CONTENT_INDEX_MAX_FILES).toBe(500);
    expect(CONTENT_INDEX_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

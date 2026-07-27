import { mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { persistCompactionSidecar } from '../../../src/agent/compaction/sidecar';

describe('persistCompactionSidecar', () => {
  it('writes the body under the given dir and returns the path', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sidecar-')), 'compaction');
    const file = persistCompactionSidecar(dir, 'archive-ids', 'a\nb\n');
    expect(file).toBeDefined();
    expect(readFileSync(file as string, 'utf8')).toBe('a\nb\n');
  });

  it('keeps at most 32 sidecars per kind', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sidecar-prune-'));
    for (let i = 0; i < 40; i += 1) {
      const file = join(dir, `evidence-ids-stale${String(i)}.txt`);
      writeFileSync(file, `stale-${String(i)}`);
      const when = new Date(i * 1000);
      utimesSync(file, when, when);
    }
    persistCompactionSidecar(dir, 'evidence-ids', 'fresh');
    const remaining = readdirSync(dir).filter((name) => name.startsWith('evidence-ids-'));
    expect(remaining).toHaveLength(32);
    expect(remaining.some((name) => name.includes('stale0.'))).toBe(false);
  });

  it('returns undefined when the target cannot be created', () => {
    const blocker = join(mkdtempSync(join(tmpdir(), 'sidecar-fail-')), 'blocker');
    writeFileSync(blocker, 'not a directory');
    expect(
      persistCompactionSidecar(join(blocker, 'nested'), 'archive-ids', 'x'),
    ).toBeUndefined();
  });
});

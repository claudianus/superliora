import { describe, expect, it, vi } from 'vitest';

import {
  FileSnapshotStore,
  MAX_SNAPSHOT_RETAINED_TURNS,
} from '../../src/session/file-snapshot';
import { createFakeKaos } from '../tools/fixtures/fake-kaos';

describe('FileSnapshotStore (unit-rewind)', () => {
  it('captures before content and restores on rewind', async () => {
    const files = new Map<string, string>([['/workspace/a.ts', 'v1']]);
    const kaos = createFakeKaos({
      readText: vi.fn(async (path: string) => {
        const v = files.get(path);
        if (v === undefined) {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return v;
      }),
      writeAtomic: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
      unlink: vi.fn(async (path: string) => {
        files.delete(path);
      }),
      mkdir: vi.fn(async () => undefined),
    });

    const store = new FileSnapshotStore({ kaos });
    await store.captureBeforeWrite('turn-1', '/workspace/a.ts');
    await store.captureBeforeWrite('turn-1', '/workspace/new.ts'); // did not exist
    // Simulate agent mutation
    files.set('/workspace/a.ts', 'v2-bad');
    files.set('/workspace/new.ts', 'created');
    store.commitTurn('turn-1');

    const result = await store.restoreTurn('turn-1');
    expect(result.restored).toContain('/workspace/a.ts');
    expect(result.deleted).toContain('/workspace/new.ts');
    expect(files.get('/workspace/a.ts')).toBe('v1');
    expect(files.has('/workspace/new.ts')).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it('skips sensitive files without storing content', async () => {
    const readText = vi.fn(async () => 'SECRET=1');
    const kaos = createFakeKaos({ readText });
    const store = new FileSnapshotStore({ kaos });
    const entry = await store.captureBeforeWrite('t', '/workspace/.env');
    expect(entry.skippedSensitive).toBe(true);
    expect(entry.content).toBeNull();
    expect(readText).not.toHaveBeenCalled();

    store.commitTurn('t');
    const result = await store.restoreTurn('t');
    expect(result.skippedSensitive).toContain('/workspace/.env');
    expect(result.restored).toEqual([]);
  });

  it('first capture wins within a turn', async () => {
    let reads = 0;
    const kaos = createFakeKaos({
      readText: vi.fn(async () => {
        reads += 1;
        return `v${String(reads)}`;
      }),
    });
    const store = new FileSnapshotStore({ kaos });
    const a = await store.captureBeforeWrite('t', '/workspace/f.ts');
    const b = await store.captureBeforeWrite('t', '/workspace/f.ts');
    expect(a.content).toBe('v1');
    expect(b.content).toBe('v1');
    expect(reads).toBe(1);
  });

  it('discardFrom removes the turn and later turns', async () => {
    const kaos = createFakeKaos({
      readText: vi.fn(async () => 'x'),
    });
    const store = new FileSnapshotStore({ kaos });
    await store.captureBeforeWrite('t1', '/workspace/a.ts');
    store.commitTurn('t1', 1);
    await store.captureBeforeWrite('t2', '/workspace/b.ts');
    store.commitTurn('t2', 2);
    store.discardFrom('t1');
    expect(store.getTurn('t1')).toBeUndefined();
    expect(store.getTurn('t2')).toBeUndefined();
  });

  it('evicts the oldest turns beyond the retention cap', async () => {
    const kaos = createFakeKaos({
      readText: vi.fn(async () => 'snapshot content'),
    });
    const store = new FileSnapshotStore({ kaos });
    const total = MAX_SNAPSHOT_RETAINED_TURNS + 8;
    for (let i = 0; i < total; i += 1) {
      const turnId = `t${String(i)}`;
      await store.captureBeforeWrite(turnId, `/workspace/f${String(i)}.ts`);
      store.commitTurn(turnId, i);
    }
    const retained = store.listTurns();
    expect(retained).toHaveLength(MAX_SNAPSHOT_RETAINED_TURNS);
    // Oldest turns are evicted; newest survives.
    expect(retained[0]?.turnId).toBe(`t${String(total - MAX_SNAPSHOT_RETAINED_TURNS)}`);
    expect(retained.at(-1)?.turnId).toBe(`t${String(total - 1)}`);
    // Rewind to an evicted turn is a no-op, like an unknown turn id.
    const result = await store.restoreTurn('t0');
    expect(result.restored).toEqual([]);
  });
});

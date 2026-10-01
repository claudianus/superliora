/**
 * The snapshot capture used to read the target a second time on every
 * mutation: Edit/Write/ApplyPatch had already read the file to perform the
 * edit, so each call paid two reads. `captureBeforeWrite` now accepts the
 * caller's read (`knownContent`), and each tool hands its own read over.
 *
 * These pin the handoff end to end: one readText per mutation AND the
 * snapshot still recording the true before-state.
 */
import { describe, expect, it, vi } from 'vitest';

import { FileSnapshotStore } from '../../src/session/file-snapshot';
import { ApplyPatchTool } from '../../src/tools/builtin/file/apply-patch';
import { EditTool } from '../../src/tools/builtin/file/edit';
import { WriteTool } from '../../src/tools/builtin/file/write';
import { createFakeKaos, PERMISSIVE_WORKSPACE } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function committedEntry(store: FileSnapshotStore, turnId: string) {
  const snapshot = store.commitTurn(turnId, 1);
  return snapshot.entries;
}

describe('mutation tools share their read with the rewind snapshot', () => {
  it('Edit reads the target once and the snapshot still gets the before-content', async () => {
    const readText = vi.fn(async () => 'alpha beta');
    const writeAtomic = vi.fn(async () => undefined);
    const kaos = createFakeKaos({ readText, writeAtomic });
    const store = new FileSnapshotStore({ kaos });
    const tool = new EditTool(kaos, PERMISSIVE_WORKSPACE, {
      fileSnapshots: store,
      turnId: 't-edit',
    });

    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'c_edit',
      args: { path: '/workspace/f.txt', old_string: 'alpha', new_string: 'omega' },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(readText).toHaveBeenCalledTimes(1);
    expect(writeAtomic).toHaveBeenCalledWith('/workspace/f.txt', 'omega beta');
    expect(committedEntry(store, 't-edit')).toEqual([
      { path: '/workspace/f.txt', content: 'alpha beta', existed: true, skippedSensitive: false },
    ]);
  });

  it('Write shares one read between provenance and the snapshot', async () => {
    const readText = vi.fn(async () => 'old content');
    const writeAtomic = vi.fn(async () => undefined);
    const kaos = createFakeKaos({ readText, writeAtomic });
    const store = new FileSnapshotStore({ kaos });
    const record = vi.fn();
    const tool = new WriteTool(kaos, PERMISSIVE_WORKSPACE, {
      fileSnapshots: store,
      turnId: 't-write',
      provenance: { record },
    });

    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'c_write',
      args: { path: '/workspace/f.txt', content: 'new content' },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(readText).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'overwrite', before: 'old content' }),
    );
    expect(committedEntry(store, 't-write')).toEqual([
      { path: '/workspace/f.txt', content: 'old content', existed: true, skippedSensitive: false },
    ]);
  });

  it('Write without provenance still reads once — the capture keeps its own', async () => {
    const readText = vi.fn(async () => 'old content');
    const writeAtomic = vi.fn(async () => undefined);
    const kaos = createFakeKaos({ readText, writeAtomic });
    const store = new FileSnapshotStore({ kaos });
    const tool = new WriteTool(kaos, PERMISSIVE_WORKSPACE, {
      fileSnapshots: store,
      turnId: 't-bare',
    });

    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'c_bare',
      args: { path: '/workspace/f.txt', content: 'new content' },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(readText).toHaveBeenCalledTimes(1);
    expect(committedEntry(store, 't-bare')[0]?.content).toBe('old content');
  });

  it('ApplyPatch reads an updated target once and the snapshot gets the before-content', async () => {
    const readText = vi.fn(async () => 'alpha\nbeta\n');
    const writeAtomic = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    const kaos = createFakeKaos({ readText, writeAtomic, mkdir });
    const store = new FileSnapshotStore({ kaos });
    const tool = new ApplyPatchTool(kaos, PERMISSIVE_WORKSPACE, {
      fileSnapshots: store,
      getTurnId: () => 't-patch',
    });

    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'c_patch',
      args: {
        patch: [
          '*** Begin Patch',
          '*** Update File: /workspace/one.ts',
          '@@',
          '-alpha',
          '+ALPHA',
          '*** End Patch',
        ].join('\n'),
      },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(readText).toHaveBeenCalledTimes(1);
    expect(committedEntry(store, 't-patch')).toEqual([
      { path: '/workspace/one.ts', content: 'alpha\nbeta\n', existed: true, skippedSensitive: false },
    ]);
  });
});

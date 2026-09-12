import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplyPatchTool } from '../../src/tools/builtin/file/apply-patch';
import { EditTool } from '../../src/tools/builtin/file/edit';
import { WriteTool } from '../../src/tools/builtin/file/write';
import { createFileProvenanceHook } from '../../src/agent/tool/builtin-tools';
import {
  FileProvenanceRecorder,
  type FileProvenanceHook,
  type FileProvenanceRecord,
} from '../../src/session/file-provenance';
import type { Agent } from '../../src/agent';
import { createFakeKaos, PERMISSIVE_WORKSPACE, toolContentString } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

/** Full Kaos StatResult stub — the interface has more required fields than tools read. */
function statResult(stMode: number): {
  stMode: number;
  stIno: number;
  stDev: number;
  stNlink: number;
  stUid: number;
  stGid: number;
  stSize: number;
  stAtime: number;
  stMtime: number;
  stCtime: number;
} {
  return {
    stMode,
    stIno: 1,
    stDev: 1,
    stNlink: 1,
    stUid: 0,
    stGid: 0,
    stSize: 0,
    stAtime: 0,
    stMtime: 0,
    stCtime: 0,
  };
}

function hookFor(recorder: FileProvenanceRecorder): FileProvenanceHook {
  const agent = {
    fileProvenance: recorder,
    type: 'main',
    config: { modelAlias: 'test-model' },
    turn: { currentId: 1 },
  } as unknown as Agent;
  const hook = createFileProvenanceHook(agent);
  if (hook === undefined) throw new TypeError('expected a provenance hook');
  return hook;
}

describe('file tool provenance hooks', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'provenance-tools-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function recorder(): FileProvenanceRecorder {
    return new FileProvenanceRecorder({ filePath: join(dir, 'provenance.ndjson') });
  }

  function hook(): FileProvenanceHook {
    return hookFor(recorder());
  }

  function records(): readonly FileProvenanceRecord[] {
    const raw = readFileSync(join(dir, 'provenance.ndjson'), 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.startsWith('{"v"'))
      .map((line) => JSON.parse(line) as FileProvenanceRecord);
  }

  function memoryKaos(files: Map<string, string>) {
    return createFakeKaos({
      readText: vi.fn(async (path: string) => {
        const value = files.get(path);
        if (value === undefined) {
          const error = new Error('ENOENT') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          throw error;
        }
        return value;
      }),
      writeAtomic: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
      writeText: vi.fn(async (path: string, content: string) => {
        files.set(path, (files.get(path) ?? '') + content);
        return Buffer.byteLength(content, 'utf8');
      }),
      unlink: vi.fn(async (path: string) => {
        files.delete(path);
      }),
      mkdir: vi.fn(async () => undefined),
      stat: vi.fn(async (path: string) =>
        statResult(path.replaceAll('\\', '/').endsWith('.ts') ? 0o100644 : 0o040755),
      ),
    });
  }

  it('Write records create and overwrite with line ranges', async () => {
    const provenance = hook();
    const files = new Map<string, string>([['/ws/existing.ts', 'old line\n']]);
    const tool = new WriteTool(memoryKaos(files), PERMISSIVE_WORKSPACE, { provenance });

    const created = await executeTool(tool, {
      turnId: '1',
      toolCallId: 'c1',
      signal: new AbortController().signal,
      args: { path: '/ws/new.ts', content: 'a\nb\n' },
    });
    expect(created.isError).toBeUndefined();
    const overwritten = await executeTool(tool, {
      turnId: '1',
      toolCallId: 'c2',
      signal: new AbortController().signal,
      args: { path: '/ws/existing.ts', content: 'x\ny\nz\n' },
    });
    expect(overwritten.isError).toBeUndefined();

    const [createRecord, overwriteRecord] = records();
    expect(createRecord).toMatchObject({
      tool: 'Write',
      op: 'create',
      path: '/ws/new.ts',
      added: [{ start: 1, end: 2 }],
    });
    expect(overwriteRecord).toMatchObject({
      tool: 'Write',
      op: 'overwrite',
      path: '/ws/existing.ts',
      added: [{ start: 1, end: 3 }],
      removedLines: 1,
    });
  });

  it('Write does not record a failed mutation', async () => {
    const provenance = hook();
    const kaos = createFakeKaos({
      stat: vi.fn(async () => statResult(0o100644)),
      writeAtomic: vi.fn(async () => {
        throw new Error('disk exploded');
      }),
    });
    const tool = new WriteTool(kaos, PERMISSIVE_WORKSPACE, { provenance });
    const result = await executeTool(tool, {
      turnId: '1',
      toolCallId: 'c1',
      signal: new AbortController().signal,
      args: { path: '/ws/new.ts', content: 'a\n' },
    });
    expect(result.isError).toBe(true);
    expect(() => records()).toThrowError(/ENOENT|provenance/);
  });

  it('Edit records the replaced range with the written bytes hashed', async () => {
    const provenance = hook();
    const files = new Map<string, string>([['/ws/a.ts', 'one\ntwo\nthree\n']]);
    const tool = new EditTool(memoryKaos(files), PERMISSIVE_WORKSPACE, { provenance });

    const result = await executeTool(tool, {
      turnId: '2',
      toolCallId: 'e1',
      signal: new AbortController().signal,
      args: { path: '/ws/a.ts', old_string: 'two', new_string: 'TWO' },
    });
    expect(result.isError).toBeUndefined();

    const [record] = records();
    expect(record).toMatchObject({
      tool: 'Edit',
      op: 'edit',
      path: '/ws/a.ts',
      added: [{ start: 2, end: 2 }],
      removedLines: 1,
    });
    expect(record?.contentHash).toBe(
      (await import('node:crypto'))
        .createHash('sha256')
        .update('one\nTWO\nthree\n', 'utf8')
        .digest('hex'),
    );
  });

  it('ApplyPatch records create, patch, and delete operations', async () => {
    const provenance = hook();
    const files = new Map<string, string>([['/ws/upd.ts', 'alpha\nbeta\ngamma\n']]);
    const tool = new ApplyPatchTool(memoryKaos(files), PERMISSIVE_WORKSPACE, { provenance });

    const result = await executeTool(tool, {
      turnId: '3',
      toolCallId: 'p1',
      signal: new AbortController().signal,
      args: {
        patch: `*** Begin Patch
*** Add File: /ws/new.ts
+line1
+line2
*** Update File: /ws/upd.ts
@@
-beta
+BETA
*** Delete File: /ws/gone.ts
*** End Patch`,
      },
    });
    expect(result.isError).toBeUndefined();

    const ops = records().map((record) => [record.op, record.path, record.addedLines] as const);
    expect(ops).toContainEqual(['create', '/ws/new.ts', 2]);
    expect(ops).toContainEqual(['patch', '/ws/upd.ts', 1]);
    expect(ops).toContainEqual(['delete', '/ws/gone.ts', 0]);
    const update = records().find((record) => record.path === '/ws/upd.ts');
    expect(update?.added).toEqual([{ start: 2, end: 2 }]);
  });

  it('toolContentString stays usable for results (fixture sanity)', async () => {
    const files = new Map<string, string>([['/ws/a.ts', 'one\ntwo\n']]);
    const tool = new WriteTool(memoryKaos(files), PERMISSIVE_WORKSPACE);
    const result = await executeTool(tool, {
      turnId: '9',
      toolCallId: 's1',
      signal: new AbortController().signal,
      args: { path: '/ws/a.ts', content: 'x\n', mode: 'append' },
    });
    expect(toolContentString(result)).toContain('Appended 2 bytes');
  });
});

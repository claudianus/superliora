import { afterEach, describe, expect, it } from 'vitest';

import {
  getDefaultSwarmFileLeaseRegistry,
  resetDefaultSwarmFileLeaseRegistry,
} from '../../src/collaboration/swarm-file-lease';
import { EditTool } from '../../src/tools/builtin/file/edit';
import { WriteTool } from '../../src/tools/builtin/file/write';
import { createFakeKaos, PERMISSIVE_WORKSPACE } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

afterEach(() => {
  resetDefaultSwarmFileLeaseRegistry();
});

describe('Edit/Write swarm file lease integration', () => {
  it('no-ops when lease context is absent (normal edits still work)', async () => {
    const kaos = createFakeKaos({
      readText: async () => 'hello world',
      writeAtomic: async () => undefined,
    });
    const tool = new EditTool(kaos, PERMISSIVE_WORKSPACE);
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_edit',
      signal,
      args: {
        path: '/tmp/a.ts',
        old_string: 'hello',
        new_string: 'hi',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(String(result.output)).toContain('Replaced 1 occurrence');
  });

  it('returns error when another owner holds the path lease', async () => {
    const registry = getDefaultSwarmFileLeaseRegistry();
    registry.claim('/tmp/conflict.ts', 'owner-a', 'run-1');

    const kaos = createFakeKaos({
      readText: async () => 'hello world',
      writeAtomic: async () => {
        throw new Error('should not write on lease conflict');
      },
    });
    const tool = new EditTool(kaos, PERMISSIVE_WORKSPACE, {
      getSwarmLease: () => ({ ownerId: 'owner-b', runId: 'run-1' }),
    });
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_edit',
      signal,
      args: {
        path: '/tmp/conflict.ts',
        old_string: 'hello',
        new_string: 'hi',
      },
    });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('File lease conflict');
    expect(String(result.output)).toContain('owner-a');
  });

  it('Write returns error when another owner holds the path lease', async () => {
    const registry = getDefaultSwarmFileLeaseRegistry();
    registry.claim('/tmp/write-conflict.ts', 'owner-a', 'run-1');

    const kaos = createFakeKaos({
      stat: async () => ({ stMode: 0o040000 } as never),
      writeAtomic: async () => {
        throw new Error('should not write on lease conflict');
      },
    });
    const tool = new WriteTool(kaos, PERMISSIVE_WORKSPACE, {
      getSwarmLease: () => ({ ownerId: 'owner-b', runId: 'run-1' }),
    });
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_write_conflict',
      signal,
      args: {
        path: '/tmp/write-conflict.ts',
        content: 'new body',
      },
    });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('File lease conflict');
    expect(String(result.output)).toContain('owner-a');
  });

  it('allows claim by the same owner and proceeds with Write', async () => {
    const registry = getDefaultSwarmFileLeaseRegistry();
    registry.claim('/tmp/owned.ts', 'owner-a', 'run-1');

    let written: string | undefined;
    const kaos = createFakeKaos({
      stat: async () => ({ stMode: 0o040000 } as never),
      writeAtomic: async (_path, data) => {
        written = typeof data === 'string' ? data : data.toString('utf8');
      },
    });
    const tool = new WriteTool(kaos, PERMISSIVE_WORKSPACE, {
      getSwarmLease: () => ({ ownerId: 'owner-a', runId: 'run-1' }),
    });
    const result = await executeTool(tool, {
      turnId: '0',
      toolCallId: 'call_write',
      signal,
      args: {
        path: '/tmp/owned.ts',
        content: 'payload',
      },
    });
    expect(result.isError).toBeFalsy();
    expect(written).toBe('payload');
  });
});

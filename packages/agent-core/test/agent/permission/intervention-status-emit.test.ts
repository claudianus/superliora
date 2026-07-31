import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../../src/agent';
import { PermissionManager } from '../../../src/agent/permission';
import { ToolAccesses } from '../../../src/loop';
import { createFakeKaos } from '../../tools/fixtures/fake-kaos';

describe('PermissionManager intervention status emit', () => {
  it('emits status when an approval is queued and after it resolves', async () => {
    const emitStatusUpdated = vi.fn();
    const requestApproval = vi.fn(async () => ({ decision: 'approved' as const }));
    const agent = {
      type: 'main',
      config: { cwd: '/workspace' },
      kaos: createFakeKaos(),
      getAdditionalDirs: () => [],
      records: { logRecord: vi.fn() },
      replayBuilder: { push: vi.fn() },
      telemetry: { track: vi.fn() },
      emitStatusUpdated,
      rpc: { requestApproval },
      hooks: { fireAndForgetTrigger: vi.fn(), triggerBlock: vi.fn(async () => undefined) },
      planMode: { isActive: false },
      swarmMode: { isActive: false },
    } as unknown as Agent;
    const manager = new PermissionManager(agent);
    Object.assign(agent, { permission: manager });
    manager.setMode('manual');

    await expect(
      manager.beforeToolCall({
        turnId: '0',
        stepNumber: 1,
        signal: new AbortController().signal,
        llm: {} as never,
        toolCall: {
          type: 'function',
          id: 'call_write',
          name: 'Write',
          arguments: JSON.stringify({ path: '/tmp/outside.md', content: 'x' }),
        },
        toolCalls: [],
        args: { path: '/tmp/outside.md', content: 'x' },
        execution: {
          description: 'write file',
          display: { kind: 'file_io', operation: 'write', path: '/tmp/outside.md' },
          accesses: ToolAccesses.none(),
          approvalRule: 'Write(/tmp/outside.md)',
          execute: async () => ({ output: '' }),
        },
      }),
    ).resolves.toBeUndefined();

    expect(manager.interventionQueue.pendingCount()).toBe(0);
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(emitStatusUpdated.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

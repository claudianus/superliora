/**
 * Permission policy chain coverage for H4 high-risk Bash guard opt-in.
 * Complements unit tests in high-risk-guard-mode-parity.test.ts with
 * PermissionManager beforeToolCall integration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../../../src/agent';
import {
  PermissionManager,
  PERMISSION_HIGH_RISK_GUARD_ENV,
  type ApprovalResponse,
} from '../../../../src/agent/permission';
import { ToolAccesses } from '../../../../src/loop';
import { createFakeKaos } from '../../../tools/fixtures/fake-kaos';

function makePermissionManager(
  handleApproval: (request: unknown) => Promise<ApprovalResponse>,
): {
  manager: PermissionManager;
  requestApproval: ReturnType<typeof vi.fn>;
  telemetryTrack: ReturnType<typeof vi.fn>;
} {
  let manager!: PermissionManager;
  const requestApproval = vi.fn(handleApproval);
  const telemetryTrack = vi.fn();
  const agent = {
    type: 'main',
    config: { cwd: '/workspace' },
    kaos: createFakeKaos(),
    getAdditionalDirs: () => [],
    records: { logRecord: vi.fn() },
    replayBuilder: { push: vi.fn() },
    emitStatusUpdated: vi.fn(),
    telemetry: { track: telemetryTrack },
    hooks: { fireAndForgetTrigger: vi.fn(), triggerBlock: vi.fn(async () => undefined) },
    rpc: { requestApproval },
    planMode: { isActive: false },
    askMode: { isActive: false },
  } as unknown as Agent;
  manager = new PermissionManager(agent);
  Object.assign(agent, { permission: manager });
  return { manager, requestApproval, telemetryTrack };
}

function bashHookContext(command: string) {
  return {
    turnId: '0',
    stepNumber: 1,
    signal: new AbortController().signal,
    llm: {} as never,
    toolCall: {
      type: 'function',
      id: 'call_rm_rf',
      name: 'Bash',
      arguments: JSON.stringify({ command }),
    },
    toolCalls: [],
    args: { command },
    execution: {
      description: `Running: ${command}`,
      display: { kind: 'command', command, cwd: '/tmp', language: 'bash' },
      accesses: ToolAccesses.none(),
      approvalRule: 'Bash(*)',
      execute: async () => ({ output: '' }),
    },
  } as never;
}

afterEach(() => {
  delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
});

describe('Permission policy chain — H4 high-risk Bash guard', () => {
  it('does not ask for destructive Bash under yolo when the guard is off', async () => {
    delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
    const { manager, requestApproval, telemetryTrack } = makePermissionManager(async () => ({
      decision: 'approved',
    }));
    manager.mode = 'yolo';

    await expect(
      manager.beforeToolCall(bashHookContext('rm -rf /tmp/workspace-build')),
    ).resolves.toBeUndefined();

    expect(requestApproval).not.toHaveBeenCalled();
    expect(telemetryTrack).not.toHaveBeenCalledWith(
      'permission_policy_decision',
      expect.objectContaining({ policy_name: 'yolo-high-risk-ask' }),
    );
  });

  it('asks for destructive Bash under yolo when SUPERLIORA_PERMISSION_HIGH_RISK_GUARD=1', async () => {
    process.env[PERMISSION_HIGH_RISK_GUARD_ENV] = '1';
    try {
      const { manager, requestApproval, telemetryTrack } = makePermissionManager(async () => ({
        decision: 'approved',
      }));
      manager.mode = 'yolo';

      await expect(
        manager.beforeToolCall(bashHookContext('rm -rf /tmp/workspace-build')),
      ).resolves.toBeUndefined();

      expect(requestApproval).toHaveBeenCalled();
      expect(telemetryTrack).toHaveBeenCalledWith(
        'permission_policy_decision',
        expect.objectContaining({
          policy_name: 'yolo-high-risk-ask',
          permission_mode: 'yolo',
          decision: 'ask',
          yolo_high_risk: true,
        }),
      );
    } finally {
      delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
    }
  });
});

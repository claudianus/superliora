import type { ToolCall } from '@superliora/kosong';
import * as posixPath from 'node:path/posix';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  PermissionManager,
  PERMISSION_HIGH_RISK_GUARD_ENV,
  type ApprovalResponse,
  type PermissionPolicyContext,
} from '../../src/agent/permission';
import { createPermissionDecisionPolicies } from '../../src/agent/permission/policies';
import { ToolAccesses } from '../../src/loop';
import type { ToolInputDisplay } from '../../src/tools/display';
import { literalRulePattern, matchesPathRuleSubject, matchesGlobRuleSubject } from '../../src/tools/support/rule-match';
import { createFakeKaos } from '../tools/fixtures/fake-kaos';

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
    emitStatusUpdated: vi.fn(),
    records: { logRecord: vi.fn() },
    replayBuilder: { push: vi.fn() },
    rpc: { requestApproval },
    telemetry: { track: telemetryTrack },
    planMode: {
      get isActive() { return false; },
      get planFilePath() { return null; },
      get isUltraMode() { return false; },
      get phase() { return 'interview'; },
      incrementInterviewRound: vi.fn(),
      data: vi.fn(async () => null),
      exit: vi.fn(),
    },
    askMode: {
      get isActive() { return false; },
    },
  } as unknown as Agent;
  manager = new PermissionManager(agent);
  Object.assign(agent, { permission: manager });
  return { manager, requestApproval, telemetryTrack };
}

function stringArg(args: Record<string, unknown>, key: string, fallback = ''): string {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

function canonicalTestPath(path: string): string {
  return posixPath.isAbsolute(path) ? posixPath.normalize(path) : posixPath.resolve('/workspace', path);
}

function testRuleSubject(toolName: string, args: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case 'Bash':
      return stringArg(args, 'command');
    case 'Read':
    case 'Write':
    case 'Edit':
      return canonicalTestPath(stringArg(args, 'path', '/workspace/file.txt'));
    default:
      return undefined;
  }
}

function testExecution(toolName: string, args: Record<string, unknown>): PermissionPolicyContext['execution'] {
  const ruleSubject = testRuleSubject(toolName, args);
  const path = typeof args['path'] === 'string' ? args['path'] : '/workspace/file.txt';
  let display: ToolInputDisplay;
  if (toolName === 'Bash') {
    display = { kind: 'command', command: typeof args['command'] === 'string' ? args['command'] : '' };
  } else if (toolName === 'Write') {
    display = { kind: 'file_io', operation: 'write', path };
  } else if (toolName === 'Read') {
    display = { kind: 'file_io', operation: 'read', path };
  } else {
    display = { kind: 'generic', summary: 'Approve tool', detail: {} };
  }
  let accesses = ToolAccesses.none();
  if (toolName === 'Write' && typeof args['path'] === 'string') {
    accesses = ToolAccesses.writeFile(canonicalTestPath(args['path']));
  }
  return {
    description: toolName === 'Bash' ? 'run command' : `call ${toolName}`,
    display,
    accesses,
    approvalRule: ruleSubject === undefined ? toolName : literalRulePattern(toolName, ruleSubject),
    matchesRule:
      ruleSubject === undefined
        ? undefined
        : (ruleArgs) =>
            toolName === 'Bash'
              ? matchesGlobRuleSubject(ruleArgs, ruleSubject)
              : matchesPathRuleSubject(ruleArgs, ruleSubject),
    execute: async () => ({ output: '' }),
  };
}

function hookContext(input: {
  readonly id: string;
  readonly toolName?: string | undefined;
  readonly args?: Record<string, unknown> | undefined;
}): PermissionPolicyContext {
  const toolName = input.toolName ?? 'Bash';
  const args = input.args ?? { command: 'printf first', timeout: 60 };
  const toolCall: ToolCall = {
    type: 'function',
    id: input.id,
    name: toolName,
    arguments: JSON.stringify(args),
  };
  return {
    turnId: '0',
    stepNumber: 1,
    signal: new AbortController().signal,
    llm: {} as PermissionPolicyContext['llm'],
    toolCall,
    toolCalls: [toolCall],
    args,
    execution: testExecution(toolName, args),
  };
}

describe('Permission policy chain (H4 high-risk guard)', () => {
  it('keeps built-in policies in document order', () => {
    expect(createPermissionDecisionPolicies({} as Agent).map((policy) => policy.name)).toEqual([
      'pre-tool-call-hook',
      'auto-mode-ask-user-question-deny',
      'ask-mode-guard-deny',
      'plan-mode-guard-deny',
      'user-configured-deny',
      'gui-use-safety',
      'sensitive-file-access-deny',
      'auto-mode-approve',
      'session-approval-history',
      'user-configured-ask',
      'user-configured-allow',
      'exit-plan-mode-review-ask',
      'goal-start-review-ask',
      'plan-mode-tool-approve',
      'sensitive-file-access-ask',
      'git-control-path-access-ask',
      'yolo-high-risk-ask',
      'yolo-mode-approve',
      'default-tool-approve',
      'git-cwd-write-approve',
      'fallback-ask',
    ]);
  });

  it('does not ask for destructive Bash under yolo mode when high-risk guard is off', async () => {
    delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
    const { manager, requestApproval, telemetryTrack } = makePermissionManager(async () => ({
      decision: 'approved',
    }));
    manager.mode = 'yolo';

    await expect(
      manager.beforeToolCall(
        hookContext({
          id: 'call_rm_rf_unguarded',
          toolName: 'Bash',
          args: { command: 'rm -rf /tmp/workspace-build' },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(requestApproval).not.toHaveBeenCalled();
    expect(telemetryTrack).not.toHaveBeenCalledWith(
      'permission_policy_decision',
      expect.objectContaining({
        policy_name: 'yolo-high-risk-ask',
      }),
    );
  });

  it('asks for destructive Bash under yolo mode when high-risk guard is enabled', async () => {
    process.env[PERMISSION_HIGH_RISK_GUARD_ENV] = '1';
    try {
      const { manager, requestApproval, telemetryTrack } = makePermissionManager(async () => ({
        decision: 'approved',
      }));
      manager.mode = 'yolo';

      await expect(
        manager.beforeToolCall(
          hookContext({
            id: 'call_rm_rf',
            toolName: 'Bash',
            args: { command: 'rm -rf /tmp/workspace-build' },
          }),
        ),
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

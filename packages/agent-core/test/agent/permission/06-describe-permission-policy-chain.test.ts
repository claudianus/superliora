import type { Kaos } from '@superliora/kaos';
import type { ToolCall } from '@superliora/kosong';
import * as posixPath from 'node:path/posix';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../../src/agent';
import { PermissionModeInjector } from '../../../src/agent/injection/permission-mode';
import {
  PermissionManager,
  PERMISSION_HIGH_RISK_GUARD_ENV,
  type ApprovalResponse,
  type PermissionMode,
  type PermissionPolicyContext,
  type PermissionRule,
} from '../../../src/agent/permission';
import {
  matchPermissionRule,
  parsePattern,
  type PermissionRuleMatchExecution,
} from '../../../src/agent/permission/matches-rule';
import { AutoModeApprovePermissionPolicy } from '../../../src/agent/permission/policies/auto-mode-approve';
import { AutoModeAskUserQuestionDenyPermissionPolicy } from '../../../src/agent/permission/policies/auto-mode-ask-user-question-deny';
import { FallbackAskPermissionPolicy } from '../../../src/agent/permission/policies/fallback-ask';
import { createPermissionDecisionPolicies } from '../../../src/agent/permission/policies';
import { YoloModeApprovePermissionPolicy } from '../../../src/agent/permission/policies/yolo-mode-approve';
import { ToolAccesses } from '../../../src/loop';
import type { ToolInputDisplay } from '../../../src/tools/display';
import {
  literalRulePattern,
  matchesPathRuleSubject,
  matchesGlobRuleSubject,
} from '../../../src/tools/support/rule-match';
import { createFakeKaos } from '../../tools/fixtures/fake-kaos';
import { createCommandKaos, testAgent } from '../harness/agent';

import {
  bashCall,
  makePermissionManager,
  makePlanPermissionManager,
  hookContext,
  toolCall,
  permissionRule,
  ruleMatches,
  genericDisplay,
  planReviewExecution,
  testExecution,
  testRuleSubject,
  testMatchesRuleSubject,
  testDescription,
  stringArg,
  testDisplay,
  testAccesses,
  canonicalTestPath,
} from './helpers';

describe('Permission policy chain', () => {
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

  it('denies sensitive-file access under auto mode before auto-mode approval', async () => {
    const { manager, requestApproval, telemetryTrack } = makePermissionManager(async () => ({
      decision: 'approved',
    }));
    manager.mode = 'auto';

    await expect(
      manager.beforeToolCall(
        hookContext({
          id: 'call_write_env',
          toolName: 'Write',
          args: { path: '.env', content: 'SECRET=1' },
        }),
      ),
    ).resolves.toMatchObject({
      block: true,
      reason: expect.stringContaining('sensitive file'),
    });

    expect(requestApproval).not.toHaveBeenCalled();
    expect(telemetryTrack).toHaveBeenCalledWith(
      'permission_policy_decision',
      expect.objectContaining({
        policy_name: 'sensitive-file-access-deny',
        permission_mode: 'auto',
        decision: 'deny',
        sensitive_path: true,
      }),
    );
  });

  it('asks for sensitive-file access under yolo mode before yolo-mode approval', async () => {
    const { manager, requestApproval, telemetryTrack } = makePermissionManager(async () => ({
      decision: 'approved',
    }));
    manager.mode = 'yolo';

    await expect(
      manager.beforeToolCall(
        hookContext({
          id: 'call_ssh_config',
          toolName: 'Read',
          args: { path: '/home/user/.ssh/config' },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(requestApproval).toHaveBeenCalled();
    expect(telemetryTrack).toHaveBeenCalledWith(
      'permission_policy_decision',
      expect.objectContaining({
        policy_name: 'sensitive-file-access-ask',
        permission_mode: 'yolo',
        decision: 'ask',
      }),
    );
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

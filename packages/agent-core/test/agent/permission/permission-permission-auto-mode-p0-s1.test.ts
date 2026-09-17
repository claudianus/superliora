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

import * as H from './suite-helpers';
// re-bind common helpers used unqualified in suite
const {
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
} = H;

describe('Permission auto mode', () => {
  it.each(
    (['manual', 'yolo'] as const).flatMap((mode) =>
      [
        [mode, 'Read', { path: '/tmp/notes.md' }],
        [mode, 'ReadMediaFile', { path: '/tmp/image.png' }],
        [mode, 'Grep', { pattern: 'TODO', path: '/tmp' }],
      ] as const,
    ),
  )(
    'does not ask in %s mode for %s outside the cwd (read/search are not write)',
    async (mode, toolName, args) => {
      const { manager, requestApproval } = makePermissionManager(async () => ({
        decision: 'approved',
      }));
      manager.setMode(mode);

      await expect(
        manager.beforeToolCall(hookContext({ id: `call_${toolName}_${mode}`, toolName, args })),
      ).resolves.toBeUndefined();

      expect(requestApproval).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['Read', { path: '/tmp/notes.md' }],
    ['ReadMediaFile', { path: '/tmp/image.png' }],
    ['Write', { path: '/tmp/notes.md', content: 'x' }],
    ['Edit', { path: '/tmp/notes.md', old_string: 'a', new_string: 'b' }],
  ] as const)('approves %s outside the cwd in auto mode', async (toolName, args) => {
    const { manager, requestApproval, telemetryTrack } = makePermissionManager(async () => ({
      decision: 'approved',
    }));
    manager.setMode('auto');

    await expect(
      manager.beforeToolCall(hookContext({ id: `call_${toolName}`, toolName, args })),
    ).resolves.toBeUndefined();

    expect(requestApproval).not.toHaveBeenCalled();
    expect(telemetryTrack).toHaveBeenCalledWith(
      'permission_policy_decision',
      expect.objectContaining({
        policy_name: 'auto-mode-approve',
        tool_name: toolName,
        permission_mode: 'auto',
        decision: 'approve',
      }),
    );
  });

  it.each([
    ['Read', { path: '/workspace/notes.md' }],
    ['ReadMediaFile', { path: '/workspace/image.png' }],
    ['Write', { path: '/workspace/notes.md', content: 'x' }],
    ['Edit', { path: '/workspace/notes.md', old_string: 'a', new_string: 'b' }],
    ['Grep', { pattern: 'TODO', path: '/workspace' }],
  ] as const)(
    'does not request approval for %s inside the workspace in yolo mode',
    async (toolName, args) => {
      const { manager, requestApproval } = makePermissionManager(async () => ({
        decision: 'approved',
      }));
      manager.setMode('yolo');

      await expect(
        manager.beforeToolCall(hookContext({ id: `call_${toolName}`, toolName, args })),
      ).resolves.toBeUndefined();

      expect(requestApproval).not.toHaveBeenCalled();
    },
  );

});

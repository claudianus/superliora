import { describe, expect, it } from 'vitest';

import { createPermissionDecisionPolicies } from '#/agent/permission/policies/index';
import type { Agent } from '#/agent';

const makeAgent = (): Agent => ({}) as Agent;

describe('agent/permission/policies — createPermissionDecisionPolicies', () => {
  it('returns the documented ordering of permission policies', () => {
    const policies = createPermissionDecisionPolicies(makeAgent());
    const names = policies.map((p) => p.constructor.name);
    expect(names).toEqual([
      'PreToolCallHookPermissionPolicy',
      'AgentSwarmExclusiveDenyPermissionPolicy',
      'AutoModeAskUserQuestionDenyPermissionPolicy',
      'PlanModeGuardDenyPermissionPolicy',
      'UserConfiguredDenyPermissionPolicy',
      'GuiUseSafetyPermissionPolicy',
      'SensitiveFileAccessDenyPermissionPolicy',
      'AutoModeApprovePermissionPolicy',
      'SessionApprovalHistoryPermissionPolicy',
      'UserConfiguredAskPermissionPolicy',
      'UserConfiguredAllowPermissionPolicy',
      'ExitPlanModeReviewAskPermissionPolicy',
      'GoalStartReviewAskPermissionPolicy',
      'PlanModeToolApprovePermissionPolicy',
      'SensitiveFileAccessAskPermissionPolicy',
      'GitControlPathAccessAskPermissionPolicy',
      'YoloHighRiskAskPermissionPolicy',
      'YoloModeApprovePermissionPolicy',
      'SwarmModeAgentSwarmApprovePermissionPolicy',
      'DefaultToolApprovePermissionPolicy',
      'GitCwdWriteApprovePermissionPolicy',
      'FallbackAskPermissionPolicy',
    ]);
  });

  it('returns a fresh list on every call (no shared state)', () => {
    const a = createPermissionDecisionPolicies(makeAgent());
    const b = createPermissionDecisionPolicies(makeAgent());
    expect(a).not.toBe(b);
    expect(a).toHaveLength(b.length);
  });

  it('places hard-deny rules before the auto-mode approval rule', () => {
    const policies = createPermissionDecisionPolicies(makeAgent());
    const autoApprove = policies.findIndex((p) => p.constructor.name === 'AutoModeApprovePermissionPolicy');
    const beforeAutoApprove = policies
      .slice(0, autoApprove)
      .map((p) => p.constructor.name);
    expect(beforeAutoApprove).toContain('PreToolCallHookPermissionPolicy');
    expect(beforeAutoApprove).toContain('AgentSwarmExclusiveDenyPermissionPolicy');
    expect(beforeAutoApprove).toContain('PlanModeGuardDenyPermissionPolicy');
    expect(beforeAutoApprove).toContain('UserConfiguredDenyPermissionPolicy');
    expect(beforeAutoApprove).toContain('SensitiveFileAccessDenyPermissionPolicy');
  });

  it('places the user-configured ask rule ahead of the user-configured allow rule', () => {
    const policies = createPermissionDecisionPolicies(makeAgent());
    const ask = policies.findIndex((p) => p.constructor.name === 'UserConfiguredAskPermissionPolicy');
    const allow = policies.findIndex((p) => p.constructor.name === 'UserConfiguredAllowPermissionPolicy');
    expect(ask).toBeGreaterThanOrEqual(0);
    expect(allow).toBeGreaterThanOrEqual(0);
    expect(ask).toBeLessThan(allow);
  });

  it('puts the fallback ask policy last in the chain', () => {
    const policies = createPermissionDecisionPolicies(makeAgent());
    expect(policies.at(-1)?.constructor.name).toBe('FallbackAskPermissionPolicy');
  });
});

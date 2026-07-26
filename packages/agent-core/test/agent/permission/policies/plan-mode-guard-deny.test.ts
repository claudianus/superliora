import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { PlanModeGuardDenyPermissionPolicy } from '#/agent/permission/policies/plan-mode-guard-deny';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const ctx = (name: string): PermissionPolicyContext => {
  const controller = new AbortController();
  return {
    toolCall: { id: 't1', name, arguments: {} },
    signal: controller.signal,
  } as PermissionPolicyContext;
};

describe('agent/permission/policies/plan-mode-guard-deny — name', () => {
  it('uses the documented policy name', () => {
    const policy = new PlanModeGuardDenyPermissionPolicy({} as Agent);
    expect(policy.name).toBe('plan-mode-guard-deny');
  });
});

describe('agent/permission/policies/plan-mode-guard-deny — evaluate', () => {
  it('returns undefined when plan mode is inactive', () => {
    const policy = new PlanModeGuardDenyPermissionPolicy({
      planMode: { isActive: false, isUltraMode: false, phase: null, planFilePath: null },
    } as unknown as Agent);
    expect(policy.evaluate(ctx('Write'))).toBeUndefined();
    expect(policy.evaluate(ctx('Edit'))).toBeUndefined();
  });

  it('denies CronCreate in plan mode', () => {
    const policy = new PlanModeGuardDenyPermissionPolicy({
      planMode: { isActive: true, isUltraMode: false, phase: null, planFilePath: null },
    } as unknown as Agent);
    const result = policy.evaluate(ctx('CronCreate'));
    expect(result).toEqual({
      kind: 'deny',
      message:
        'CronCreate is not available in plan mode because it would mutate scheduled work that runs after plan exit. Call ExitPlanMode first.',
    });
  });

  it('denies CronDelete in plan mode', () => {
    const policy = new PlanModeGuardDenyPermissionPolicy({
      planMode: { isActive: true, isUltraMode: false, phase: null, planFilePath: null },
    } as unknown as Agent);
    const result = policy.evaluate(ctx('CronDelete'));
    expect(result?.kind).toBe('deny');
  });
});

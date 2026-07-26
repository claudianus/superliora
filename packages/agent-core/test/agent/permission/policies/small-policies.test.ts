import { describe, expect, it } from 'vitest';

import { AutoModeApprovePermissionPolicy } from '#/agent/permission/policies/auto-mode-approve';
import { FallbackAskPermissionPolicy } from '#/agent/permission/policies/fallback-ask';
import type { Agent } from '#/agent';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const makeAgent = (mode: 'auto' | 'approve-asks' | 'yolo' | 'plan' = 'auto'): Agent =>
  ({ permission: { mode } }) as unknown as Agent;

const makeContext = (): PermissionPolicyContext =>
  ({ toolCall: { id: 't1', name: 'Bash', arguments: {} } }) as PermissionPolicyContext;

describe('agent/permission/policies/auto-mode-approve', () => {
  it('approves when the agent permission mode is "auto"', () => {
    const policy = new AutoModeApprovePermissionPolicy(makeAgent('auto'));
    expect(policy.evaluate()).toEqual({ kind: 'approve' });
  });

  it('returns undefined when the agent permission mode is not "auto"', () => {
    for (const mode of ['approve-asks', 'yolo', 'plan'] as const) {
      const policy = new AutoModeApprovePermissionPolicy(makeAgent(mode));
      expect(policy.evaluate()).toBeUndefined();
    }
  });

  it('uses the documented policy name', () => {
    const policy = new AutoModeApprovePermissionPolicy(makeAgent('auto'));
    expect(policy.name).toBe('auto-mode-approve');
  });
});

describe('agent/permission/policies/fallback-ask', () => {
  it('always asks regardless of the supplied context', () => {
    const policy = new FallbackAskPermissionPolicy();
    expect(policy.evaluate(makeContext())).toEqual({ kind: 'ask' });
  });

  it('ignores the context (does not throw on undefined)', () => {
    const policy = new FallbackAskPermissionPolicy();
    expect(policy.evaluate(undefined as never)).toEqual({ kind: 'ask' });
  });

  it('uses the documented policy name', () => {
    const policy = new FallbackAskPermissionPolicy();
    expect(policy.name).toBe('fallback-ask');
  });
});

import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { PreToolCallHookPermissionPolicy } from '#/agent/permission/policies/pre-tool-call-hook';
import { SessionApprovalHistoryPermissionPolicy } from '#/agent/permission/policies/session-approval-history';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const ctx = (name: string): PermissionPolicyContext => {
  const controller = new AbortController();
  return {
    toolCall: { id: 't1', name, arguments: {} },
    signal: controller.signal,
  } as PermissionPolicyContext;
};

describe('agent/permission/policies/pre-tool-call-hook — name', () => {
  it('uses the documented policy name', () => {
    const policy = new PreToolCallHookPermissionPolicy({} as Agent);
    expect(policy.name).toBe('pre-tool-call-hook');
  });
});

describe('agent/permission/policies/pre-tool-call-hook — evaluate', () => {
  it('returns undefined when agent.hooks is undefined', async () => {
    const policy = new PreToolCallHookPermissionPolicy({} as Agent);
    const result = await policy.evaluate(ctx('Bash'));
    expect(result).toBeUndefined();
  });

  it('returns undefined when the hook returns undefined', async () => {
    const policy = new PreToolCallHookPermissionPolicy({
      hooks: { triggerBlock: async () => undefined },
    } as unknown as Agent);
    const result = await policy.evaluate(ctx('Bash'));
    expect(result).toBeUndefined();
  });

  it('returns a deny decision when the hook returns a reason', async () => {
    const policy = new PreToolCallHookPermissionPolicy({
      hooks: { triggerBlock: async () => ({ reason: 'blocked by hook' }) },
    } as unknown as Agent);
    const result = await policy.evaluate(ctx('Bash'));
    expect(result).toEqual({ kind: 'deny', message: 'blocked by hook' });
  });
});

describe('agent/permission/policies/session-approval-history — name', () => {
  it('uses the documented policy name', () => {
    const policy = new SessionApprovalHistoryPermissionPolicy({} as Agent);
    expect(policy.name).toBe('session-approval-history');
  });

  it('returns undefined on an empty rule list', () => {
    const policy = new SessionApprovalHistoryPermissionPolicy({
      permission: { sessionApprovalRulePatterns: [] },
    } as unknown as Agent);
    expect(policy.evaluate(ctx('Bash'))).toBeUndefined();
  });
});

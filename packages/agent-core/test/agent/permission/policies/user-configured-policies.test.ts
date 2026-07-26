import { describe, expect, it } from 'vitest';

import {
  UserConfiguredAllowPermissionPolicy,
  UserConfiguredAskPermissionPolicy,
  UserConfiguredDenyPermissionPolicy,
} from '#/agent/permission/policies/user-configured-rules';
import type { Agent } from '#/agent';
import type { PermissionPolicyContext, PermissionRule } from '#/agent/permission/types';

const makeAgent = (rules: PermissionRule[], type: Agent['type'] = 'main'): Agent =>
  ({
    type,
    permission: {
      data: () => ({ rules } as never),
    },
  }) as unknown as Agent;

const makeContext = (name: string): PermissionPolicyContext =>
  ({ toolCall: { id: 't1', name, arguments: {} } }) as PermissionPolicyContext;

const rule = (over: Partial<PermissionRule> & Pick<PermissionRule, 'pattern'>): PermissionRule =>
  ({
    action: 'allow',
    scope: 'project',
    ...over,
  }) as PermissionRule;

describe('agent/permission/policies/user-configured-rules — deny', () => {
  it('returns undefined when no deny rule matches the tool', () => {
    const policy = new UserConfiguredDenyPermissionPolicy(
      makeAgent([rule({ pattern: 'Read', decision: 'allow' })]),
    );
    expect(policy.evaluate(makeContext('Bash'))).toBeUndefined();
  });

  it('denies when a project-scope deny rule matches', () => {
    const policy = new UserConfiguredDenyPermissionPolicy(
      makeAgent([rule({ pattern: 'Bash', decision: 'deny', reason: 'no shell' })]),
    );
    const decision = policy.evaluate(makeContext('Bash'));
    expect(decision).toMatchObject({ kind: 'deny' });
    expect((decision as { message?: string }).message).toContain('"Bash"');
    expect((decision as { message?: string }).message).toContain('no shell');
  });

  it('uses the sub-agent message variant when agent.type === "sub"', () => {
    const policy = new UserConfiguredDenyPermissionPolicy(
      makeAgent([rule({ pattern: 'Bash', decision: 'deny', reason: 'no shell' })], 'sub'),
    );
    const decision = policy.evaluate(makeContext('Bash'));
    expect((decision as { message?: string }).message).toContain('Try a different approach');
  });

  it('ignores rules with non-allowable scopes (e.g. session, repo)', () => {
    const policy = new UserConfiguredDenyPermissionPolicy(
      makeAgent([rule({ pattern: 'Bash', decision: 'deny', scope: 'session' as never })]),
    );
    expect(policy.evaluate(makeContext('Bash'))).toBeUndefined();
  });

  it('uses the documented policy name', () => {
    const policy = new UserConfiguredDenyPermissionPolicy(makeAgent([]));
    expect(policy.name).toBe('user-configured-deny');
  });
});

describe('agent/permission/policies/user-configured-rules — allow', () => {
  it('approves when an allow rule matches the tool', () => {
    const policy = new UserConfiguredAllowPermissionPolicy(
      makeAgent([rule({ pattern: 'Read', decision: 'allow' })]),
    );
    const decision = policy.evaluate(makeContext('Read'));
    expect(decision).toMatchObject({ kind: 'approve' });
  });

  it('returns undefined when no allow rule matches', () => {
    const policy = new UserConfiguredAllowPermissionPolicy(
      makeAgent([rule({ pattern: 'Bash', decision: 'allow' })]),
    );
    expect(policy.evaluate(makeContext('Read'))).toBeUndefined();
  });

  it('uses the documented policy name', () => {
    expect(new UserConfiguredAllowPermissionPolicy(makeAgent([])).name).toBe(
      'user-configured-allow',
    );
  });
});

describe('agent/permission/policies/user-configured-rules — ask', () => {
  it('asks when an ask rule matches the tool', () => {
    const policy = new UserConfiguredAskPermissionPolicy(
      makeAgent([rule({ pattern: 'Bash', decision: 'ask' })]),
    );
    const decision = policy.evaluate(makeContext('Bash'));
    expect(decision).toMatchObject({ kind: 'ask' });
  });

  it('returns undefined when no ask rule matches', () => {
    const policy = new UserConfiguredAskPermissionPolicy(
      makeAgent([rule({ pattern: 'Read', decision: 'ask' })]),
    );
    expect(policy.evaluate(makeContext('Bash'))).toBeUndefined();
  });

  it('uses the documented policy name', () => {
    expect(new UserConfiguredAskPermissionPolicy(makeAgent([])).name).toBe('user-configured-ask');
  });
});

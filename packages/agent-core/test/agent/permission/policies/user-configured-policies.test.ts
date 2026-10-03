import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import {
  UserConfiguredAllowPermissionPolicy,
  UserConfiguredAskPermissionPolicy,
  UserConfiguredDenyPermissionPolicy,
} from '#/agent/permission/policies/user-configured-rules';
import type { PermissionPolicyContext, PermissionRule } from '#/agent/permission/types';

const agent = (rules: PermissionRule[]): Agent => ({
  permission: { data: () => ({ rules }) },
}) as unknown as Agent;

const context = (name = 'Bash'): PermissionPolicyContext => ({
  toolCall: { id: 'native', name, arguments: '{}' },
  execution: {},
}) as PermissionPolicyContext;

const rule = (decision: PermissionRule['decision'], pattern = 'Bash', scope: PermissionRule['scope'] = 'project'): PermissionRule => ({
  decision, pattern, scope, reason: 'Operator rule',
});

describe('Native configured rules', () => {
  it.each(['turn-override', 'project', 'user'] as const)('honors deny and its operator reason in %s scope', (scope) => {
    const policy = new UserConfiguredDenyPermissionPolicy(agent([rule('deny', 'Bash', scope)]));
    expect(policy.evaluate(context())).toMatchObject({ kind: 'deny', message: expect.stringContaining('Operator rule') });
  });

  it('keeps session-runtime grants out of static configured policy decisions', () => {
    const policy = new UserConfiguredDenyPermissionPolicy(agent([rule('deny', 'Bash', 'session-runtime')]));
    expect(policy.evaluate(context())).toBeUndefined();
  });

  it('does not apply a rule for a different native tool', () => {
    const policy = new UserConfiguredDenyPermissionPolicy(agent([rule('deny', 'SessionControl')]));
    expect(policy.evaluate(context())).toBeUndefined();
  });

  it('allows SessionControl only when a configured allow matches', () => {
    const policy = new UserConfiguredAllowPermissionPolicy(agent([rule('allow', 'SessionControl')]));
    expect(policy.evaluate(context('SessionControl'))).toMatchObject({ kind: 'approve' });
    expect(policy.evaluate(context())).toBeUndefined();
  });

  it('asks only when a configured ask matches', () => {
    const policy = new UserConfiguredAskPermissionPolicy(agent([rule('ask')]));
    expect(policy.evaluate(context())).toMatchObject({ kind: 'ask' });
    expect(policy.evaluate(context('SessionControl'))).toBeUndefined();
  });
});

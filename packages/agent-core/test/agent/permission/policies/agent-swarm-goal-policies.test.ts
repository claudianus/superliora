import { describe, expect, it } from 'vitest';

import { AgentSwarmExclusiveDenyPermissionPolicy } from '#/agent/permission/policies/agent-swarm-exclusive-deny';
import { GoalStartReviewAskPermissionPolicy } from '#/agent/permission/policies/goal-start-review-ask';
import type { Agent } from '#/agent';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const ctx = (name: string): PermissionPolicyContext =>
  ({ toolCall: { id: 't1', name, arguments: {} } }) as PermissionPolicyContext;

describe('agent/permission/policies/agent-swarm-exclusive-deny', () => {
  it('uses the documented policy name', () => {
    const policy = new AgentSwarmExclusiveDenyPermissionPolicy();
    expect(policy.name).toBe('agent-swarm-exclusive-deny');
  });
});

describe('agent/permission/policies/goal-start-review-ask', () => {
  it('uses the documented policy name', () => {
    const policy = new GoalStartReviewAskPermissionPolicy({} as Agent);
    expect(policy.name).toBe('goal-start-review-ask');
  });
});

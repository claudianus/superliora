import { describe, expect, it } from 'vitest';

import { GoalStartReviewAskPermissionPolicy } from '#/agent/permission/policies/goal-start-review-ask';
import type { Agent } from '#/agent';

describe('agent/permission/policies/goal-start-review-ask', () => {
  it('uses the documented policy name', () => {
    const policy = new GoalStartReviewAskPermissionPolicy({} as Agent);
    expect(policy.name).toBe('goal-start-review-ask');
  });
});

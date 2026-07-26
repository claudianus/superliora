import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { ExitPlanModeReviewAskPermissionPolicy } from '#/agent/permission/policies/exit-plan-mode-review-ask';
import { GuiUseSafetyPermissionPolicy } from '#/agent/permission/policies/gui-use-safety';

describe('agent/permission/policies/exit-plan-mode-review-ask — name', () => {
  it('uses the documented policy name', () => {
    const policy = new ExitPlanModeReviewAskPermissionPolicy({} as Agent);
    expect(policy.name).toBe('exit-plan-mode-review-ask');
  });
});

describe('agent/permission/policies/gui-use-safety — name', () => {
  it('uses the documented policy name', () => {
    const policy = new GuiUseSafetyPermissionPolicy({} as Agent);
    expect(policy.name).toBe('gui-use-safety');
  });
});

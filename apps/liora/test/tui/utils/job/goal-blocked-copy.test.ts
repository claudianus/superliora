import { describe, expect, it } from 'vitest';

import { formatGoalBlockedCopy } from '#/tui/utils/job/goal-blocked-copy';

describe('formatGoalBlockedCopy', () => {
  it('humanizes role-chain model spawn failures', () => {
    const copy = formatGoalBlockedCopy(
      'no live worker model for goal-driver (tried opencode/kimi-k2.5, opencode/glm-5) — pin a live model',
    );
    expect(copy.headline).toMatch(/no live worker model \(tried /);
    expect(copy.next).toMatch(/\/model/);
    expect(copy.next).toMatch(/\/goal resume/);
  });

  it('keeps arbitrary blockers but still offers resume', () => {
    const copy = formatGoalBlockedCopy('waiting on user approval');
    expect(copy.headline).toBe('waiting on user approval');
    expect(copy.next).toMatch(/\/goal resume/);
  });
});

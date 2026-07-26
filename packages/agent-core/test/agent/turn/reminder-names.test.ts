import { describe, expect, it } from 'vitest';

import { GOAL_BLOCKED_REMINDER_NAME, GOAL_COMPLETION_REMINDER_NAME } from '../../../src/agent/turn/reminder-names';

describe('agent/turn/reminder-names.ts — constants', () => {
  it('pins the documented goal reminder names so the goal injector stays in sync', () => {
    expect(GOAL_COMPLETION_REMINDER_NAME).toBe('goal_completion');
    expect(GOAL_BLOCKED_REMINDER_NAME).toBe('goal_blocked');
    // The two names must not collide (TUI filtering by name relies on it).
    expect(GOAL_COMPLETION_REMINDER_NAME).not.toBe(GOAL_BLOCKED_REMINDER_NAME);
  });
});

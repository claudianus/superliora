import { describe, expect, it } from 'vitest';

import {
  GOAL_COMPLETE_REJECT_COOLDOWN_TURNS,
  GOAL_NO_PROGRESS_STREAK_K,
} from '#/agent/goal/index';
import { __testing as dedupTesting } from '#/agent/turn/tool-dedup';

describe('agent/goal/index — constants', () => {
  it('exposes the documented goal rejection cooldown', () => {
    expect(GOAL_COMPLETE_REJECT_COOLDOWN_TURNS).toBe(3);
  });

  it('exposes the documented no-progress streak K value', () => {
    expect(GOAL_NO_PROGRESS_STREAK_K).toBe(6);
  });
});

describe('agent/turn/tool-dedup — reminder text constants', () => {
  it('REMINDER_TEXT_1 mentions repeating tool calls', () => {
    expect(dedupTesting.REMINDER_TEXT_1).toContain('repeating');
  });

  it('REMINDER_TEXT_3 explicitly mentions stopping the loop', () => {
    expect(dedupTesting.REMINDER_TEXT_3).toMatch(/stop|doom|abort/i);
  });

  it('DOOM_LOOP_HARD_STOP_TEXT is non-empty and instructs to stop', () => {
    expect(dedupTesting.DOOM_LOOP_HARD_STOP_TEXT.length).toBeGreaterThan(0);
    expect(dedupTesting.DOOM_LOOP_HARD_STOP_TEXT).toMatch(/stop|hard|abort|doom/i);
  });

  it('REPEAT_FORCE_STOP_STREAK is a positive integer', () => {
    expect(Number.isInteger(dedupTesting.REPEAT_FORCE_STOP_STREAK)).toBe(true);
    expect(dedupTesting.REPEAT_FORCE_STOP_STREAK).toBeGreaterThan(0);
  });

  it('makeReminderText2 returns a non-empty string', () => {
    const result = dedupTesting.makeReminderText2('Bash', 3);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('Bash');
    expect(result).toContain('3');
  });
});

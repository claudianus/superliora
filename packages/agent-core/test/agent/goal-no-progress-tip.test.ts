import { describe, expect, it } from 'vitest';

import {
  GOAL_NO_PROGRESS_SENSOR_ORIGIN,
  GOAL_NO_PROGRESS_STREAK_K,
  formatGoalNoProgressTip,
} from '../../src/agent/goal';

describe('formatGoalNoProgressTip (Loop31a)', () => {
  it('includes stable prefix, streak, and threshold', () => {
    const tip = formatGoalNoProgressTip(6);
    expect(tip.startsWith('GOAL_NO_PROGRESS:')).toBe(true);
    expect(tip).toContain('6 consecutive');
    expect(tip).toContain(`K=${String(GOAL_NO_PROGRESS_STREAK_K)}`);
    expect(tip).toContain('UpdateGoal(blocked)');
  });

  it('embeds progress signature when provided', () => {
    const tip = formatGoalNoProgressTip(7, 6, 'sig:abc');
    expect(tip).toContain('Signature: sig:abc');
  });

  it('exports stable wire origin code', () => {
    expect(GOAL_NO_PROGRESS_SENSOR_ORIGIN).toBe('goal-no-progress-sensor');
  });
});

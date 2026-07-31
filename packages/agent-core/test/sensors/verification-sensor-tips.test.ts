import { describe, expect, it } from 'vitest';

import {
  VERIFICATION_SENSOR_GOAL_DONE_TIP,
  VERIFICATION_SENSOR_GOAL_DONE_TIP_KO,
} from '../../src/sensors/verification-sensor-ledger';

describe('verification sensor W6 tips', () => {
  it('documents soft done warning for recent failures', () => {
    expect(VERIFICATION_SENSOR_GOAL_DONE_TIP).toContain('W6 soft sensor');
    expect(VERIFICATION_SENSOR_GOAL_DONE_TIP).toContain('RunProjectChecks');
    expect(VERIFICATION_SENSOR_GOAL_DONE_TIP).toContain('not a hard block');
  });

  it('summarizes in Korean', () => {
    expect(VERIFICATION_SENSOR_GOAL_DONE_TIP_KO).toContain('W6');
    expect(VERIFICATION_SENSOR_GOAL_DONE_TIP_KO).toContain('소프트');
    expect(VERIFICATION_SENSOR_GOAL_DONE_TIP_KO).toContain('하드 차단 아님');
  });
});

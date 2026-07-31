import { describe, expect, it } from 'vitest';

import {
  MISSION_RESUME_SMOKE_PAUSE_STAGE,
  simulateMissionResumeSmoke,
} from '../../src/ultrawork/mission-resume-grade';

describe('mission-resume-grade', () => {
  it('passes green path against run-store checkpoint contract', () => {
    const grade = simulateMissionResumeSmoke({ pauseAtStage: MISSION_RESUME_SMOKE_PAUSE_STAGE });

    expect(grade.ok, grade.detail).toBe(true);
    expect(grade.checkpointValid).toBe(true);
    expect(grade.finalStatus).toBe('done');
    expect(grade.detail).toContain('smoke passed');
  });
});

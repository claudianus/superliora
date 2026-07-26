import { describe, expect, it } from 'vitest';

import {
  INTERVIEW_PERSPECTIVE_DESCRIPTIONS,
  getInterviewPerspectiveDescription,
} from '#/agent/plan/ultra-plan-perspective';
import type { InterviewPerspective } from '#/agent/plan/ultra-plan-mode';

describe('ultra-plan-perspective — INTERVIEW_PERSPECTIVE_DESCRIPTIONS', () => {
  it('covers every InterviewPerspective with a non-empty description', () => {
    const perspectives: InterviewPerspective[] = [
      'researcher',
      'simplifier',
      'architect',
      'breadth-keeper',
      'seed-closer',
    ];
    for (const p of perspectives) {
      expect(INTERVIEW_PERSPECTIVE_DESCRIPTIONS[p].length).toBeGreaterThan(0);
    }
  });

  it('pins the "researcher" copy', () => {
    expect(INTERVIEW_PERSPECTIVE_DESCRIPTIONS.researcher).toContain('benchmarks');
  });

  it('pins the "seed-closer" copy', () => {
    expect(INTERVIEW_PERSPECTIVE_DESCRIPTIONS['seed-closer']).toContain('measurable');
  });
});

describe('ultra-plan-perspective — getInterviewPerspectiveDescription', () => {
  it('returns the same string as the record lookup', () => {
    const perspectives: InterviewPerspective[] = [
      'researcher',
      'simplifier',
      'architect',
      'breadth-keeper',
      'seed-closer',
    ];
    for (const p of perspectives) {
      expect(getInterviewPerspectiveDescription(p)).toBe(INTERVIEW_PERSPECTIVE_DESCRIPTIONS[p]);
    }
  });
});

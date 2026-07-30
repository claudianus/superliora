import { describe, expect, it } from 'vitest';

import { assessContextPressure, assessTurnBudget } from '#/ultrawork/stage-progress-health';

describe('stage-progress-health', () => {
  it('assesses context pressure bands', () => {
    expect(assessContextPressure(0.4).level).toBe('low');
    expect(assessContextPressure(0.9).level).toBe('critical');
  });

  it('assesses turn budget status', () => {
    expect(assessTurnBudget(10, 100).status).toBe('ok');
    expect(assessTurnBudget(100, 100).status).toBe('exhausted');
  });
});

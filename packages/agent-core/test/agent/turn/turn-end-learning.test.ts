import { describe, expect, it, vi } from 'vitest';

import { scheduleTurnEndLearning } from '../../../src/agent/turn/turn-end-learning';

describe('scheduleTurnEndLearning', () => {
  it('no-ops for subagents', () => {
    const dream = { maybeSchedule: vi.fn() };
    const refine = { maybeAutoRefine: vi.fn() };
    const skillify = { maybeSchedule: vi.fn() };
    scheduleTurnEndLearning({
      type: 'sub',
      dream,
      refine,
      skillify,
    } as never);
    expect(dream.maybeSchedule).not.toHaveBeenCalled();
    expect(refine.maybeAutoRefine).not.toHaveBeenCalled();
    expect(skillify.maybeSchedule).not.toHaveBeenCalled();
  });

  it('fires dream, refine, and skillify once from a single hook', () => {
    const dream = { maybeSchedule: vi.fn() };
    const refine = { maybeAutoRefine: vi.fn() };
    const skillify = { maybeSchedule: vi.fn() };
    scheduleTurnEndLearning({
      type: 'main',
      dream,
      refine,
      skillify,
    } as never);
    expect(dream.maybeSchedule).toHaveBeenCalledOnce();
    expect(refine.maybeAutoRefine).toHaveBeenCalledExactlyOnceWith('turn');
    expect(skillify.maybeSchedule).toHaveBeenCalledOnce();
  });
});

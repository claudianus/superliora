import { describe, expect, it } from 'vitest';
import { createMotionBeatController } from '#/tui/utils/motion-beats';

describe('motion-beats', () => {
  it('keeps only one transition beat (replace)', () => {
    const c = createMotionBeatController();
    c.play({ name: 'compaction_start', seed: 'a', title: 'A', nowMs: 0 });
    const second = c.play({ name: 'mode_enter', seed: 'b', title: 'B', nowMs: 50 });
    expect(second?.name).toBe('mode_enter');
    expect(c.active(60)?.name).toBe('mode_enter');
  });

  it('suppresses transitions while theatreActive', () => {
    const c = createMotionBeatController();
    expect(
      c.play({
        name: 'status_open',
        seed: 's',
        title: 'Status',
        nowMs: 0,
        theatreActive: true,
      }),
    ).toBeUndefined();
  });

  it('throttles stream tool_settle beats within 300ms', () => {
    const c = createMotionBeatController();
    expect(
      c.play({ name: 'tool_settle', seed: 't1', title: 't', nowMs: 0, streamThrottle: true }),
    ).toBeTruthy();
    expect(
      c.play({ name: 'tool_settle', seed: 't2', title: 't', nowMs: 100, streamThrottle: true }),
    ).toBeUndefined();
    expect(
      c.play({ name: 'tool_settle', seed: 't3', title: 't', nowMs: 350, streamThrottle: true }),
    ).toBeTruthy();
  });

  it('expires beat after enter duration', () => {
    const c = createMotionBeatController();
    c.play({ name: 'session_resume', seed: 'r', title: 'Resuming', nowMs: 0 });
    expect(c.active(100)).toBeTruthy();
    expect(c.active(900)).toBeUndefined();
  });
});

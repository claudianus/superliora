import { describe, expect, it } from 'vitest';
import {
  createMotionBeatController,
  isMotionTheatreActive,
} from '#/tui/utils/motion-beats';

describe('motion-beats', () => {
  it('treats mode_enter as enter and mode_exit as exit', () => {
    const c = createMotionBeatController();
    expect(
      c.play({ name: 'mode_enter', seed: 'mode:yolo', title: 'yolo', nowMs: 0 }),
    ).toMatchObject({ name: 'mode_enter', kind: 'enter' });
    expect(
      c.play({ name: 'mode_exit', seed: 'mode:yolo', title: 'yolo', nowMs: 50 }),
    ).toMatchObject({ name: 'mode_exit', kind: 'exit' });
    expect(c.active(100)?.name).toBe('mode_exit');
    expect(c.active(800)).toBeUndefined();
  });

  it('isMotionTheatreActive matches ultrawork or swarm-armed', () => {
    expect(isMotionTheatreActive({ ultraworkMode: true, swarmMode: false })).toBe(true);
    expect(isMotionTheatreActive({ ultraworkMode: false, swarmMode: true })).toBe(true);
    expect(isMotionTheatreActive({ ultraworkMode: false, swarmMode: false })).toBe(false);
  });

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

  it('plays session_resume as an enter beat with the resume seed', () => {
    const c = createMotionBeatController();
    const snap = c.play({
      name: 'session_resume',
      seed: 'resume',
      title: 'Resuming session',
      nowMs: 10,
    });
    expect(snap).toMatchObject({
      name: 'session_resume',
      seed: 'resume',
      title: 'Resuming session',
      kind: 'enter',
      startedAtMs: 10,
    });
    expect(c.active(50)?.name).toBe('session_resume');
  });

  it('treats plan_enter as enter and plan_exit as exit with the plan seed', () => {
    const c = createMotionBeatController();
    expect(
      c.play({ name: 'plan_enter', seed: 'plan', title: 'plan', nowMs: 0 }),
    ).toMatchObject({ name: 'plan_enter', seed: 'plan', kind: 'enter' });
    expect(
      c.play({ name: 'plan_exit', seed: 'plan', title: 'plan', nowMs: 50 }),
    ).toMatchObject({ name: 'plan_exit', seed: 'plan', kind: 'exit' });
  });

  it('plays status_open as an enter beat', () => {
    const c = createMotionBeatController();
    const snap = c.play({
      name: 'status_open',
      seed: 'status',
      title: 'Status',
      nowMs: 0,
    });
    expect(snap).toMatchObject({
      name: 'status_open',
      seed: 'status',
      kind: 'enter',
    });
  });
});

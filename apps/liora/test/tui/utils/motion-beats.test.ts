import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  ENTER_BEAT_MS,
  EXIT_BEAT_MS,
  enterBeatDurationMs,
  exitBeatDurationMs,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import {
  createMotionBeatController,
  isMotionTheatreActive,
} from '#/tui/utils/motion-beats';

const premiumAppearance = {
  ...DEFAULT_APPEARANCE_PREFERENCES,
  profile: 'premium' as const,
  particles: 'premium' as const,
};

const subtleAppearance = {
  ...DEFAULT_APPEARANCE_PREFERENCES,
  profile: 'subtle' as const,
  particles: 'ambient' as const,
};

describe('motion-beats', () => {
  beforeEach(() => {
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences(premiumAppearance);
  });

  afterEach(() => {
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

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
    c.play({ name: 'mode_enter', seed: 'a', title: 'A', nowMs: 0 });
    const second = c.play({ name: 'plan_enter', seed: 'b', title: 'plan', nowMs: 50 });
    expect(second?.name).toBe('plan_enter');
    expect(c.active(60)?.name).toBe('plan_enter');
  });

  it('ignores ghost beats without replacing the active slot', () => {
    const c = createMotionBeatController();
    c.play({ name: 'mode_enter', seed: 'mode:yolo', title: 'yolo', nowMs: 0 });
    for (const name of [
      'thinking_enter',
      'tool_settle',
      'status_open',
      'compaction_start',
      'compaction_done',
      'goal_complete',
    ] as const) {
      expect(
        c.play({ name, seed: 'ghost', title: 'ghost', nowMs: 40, streamThrottle: true }),
      ).toBeUndefined();
    }
    expect(c.active(50)?.name).toBe('mode_enter');
  });

  it('suppresses transitions while theatreActive', () => {
    const c = createMotionBeatController();
    expect(
      c.play({
        name: 'mode_enter',
        seed: 'mode:yolo',
        title: 'yolo',
        nowMs: 0,
        theatreActive: true,
      }),
    ).toBeUndefined();
  });

  it('expires beat after enter duration (premium)', () => {
    const c = createMotionBeatController();
    c.play({ name: 'session_resume', seed: 'r', title: 'Resuming', nowMs: 0 });
    expect(enterBeatDurationMs(premiumAppearance)).toBe(ENTER_BEAT_MS);
    expect(c.active(100)).toBeTruthy();
    expect(c.active(ENTER_BEAT_MS)).toBeUndefined();
  });

  it('keeps enter/exit beats alive through subtle duration', () => {
    setActiveAppearancePreferences(subtleAppearance);
    expect(enterBeatDurationMs(subtleAppearance)).toBe(ENTER_BEAT_MS * 1.2);
    expect(exitBeatDurationMs(subtleAppearance)).toBe(EXIT_BEAT_MS * 1.2);

    const enter = createMotionBeatController();
    enter.play({ name: 'session_resume', seed: 'r', title: 'Resuming', nowMs: 0 });
    // Past base ENTER_BEAT_MS but still inside subtle stretch — must stay live.
    expect(enter.active(ENTER_BEAT_MS + 40)?.name).toBe('session_resume');
    expect(enter.active(ENTER_BEAT_MS * 1.2)).toBeUndefined();

    const exit = createMotionBeatController();
    exit.play({ name: 'mode_exit', seed: 'mode:yolo', title: 'yolo', nowMs: 0 });
    expect(exit.active(EXIT_BEAT_MS + 40)?.name).toBe('mode_exit');
    expect(exit.active(EXIT_BEAT_MS * 1.2)).toBeUndefined();
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
});

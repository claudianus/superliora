import { describe, expect, it } from 'vitest';

import {
  calmAmbientClockMs,
  capAmbientIntervalForCalmTransport,
  hasRunningConductorWorkers,
  isAmbientCalmIdle,
  resolveUnstableIdleClockGridMs,
  shapeAmbientFrameClockMs,
  UNSTABLE_IDLE_CLOCK_GRID_MS,
  UNSTABLE_IDLE_TICK_CAP_MS,
  type AmbientCalmSignals,
} from '#/tui/features/appearance/ambient-calm';

function idleSignals(overrides: Partial<AmbientCalmSignals> = {}): AmbientCalmSignals {
  return {
    streamingPhase: 'idle',
    compacting: false,
    liveGoal: false,
    fullscreenTakeover: false,
    streamRevealArmed: false,
    backgroundWork: false,
    ...overrides,
  };
}

describe('isAmbientCalmIdle', () => {
  it('is idle only when no activity signal is raised', () => {
    expect(isAmbientCalmIdle(idleSignals())).toBe(true);
    expect(isAmbientCalmIdle(idleSignals({ streamingPhase: 'composing' }))).toBe(false);
    expect(isAmbientCalmIdle(idleSignals({ streamingPhase: 'waiting' }))).toBe(false);
    // Active thinking is a streamingPhase value; the appState.thinking boolean
    // is a model preference and must not block calm.
    expect(isAmbientCalmIdle(idleSignals({ streamingPhase: 'thinking' }))).toBe(false);
    expect(isAmbientCalmIdle(idleSignals({ compacting: true }))).toBe(false);
    expect(isAmbientCalmIdle(idleSignals({ liveGoal: true }))).toBe(false);
    expect(isAmbientCalmIdle(idleSignals({ fullscreenTakeover: true }))).toBe(false);
    expect(isAmbientCalmIdle(idleSignals({ streamRevealArmed: true }))).toBe(false);
    // Background Conductor/Mission Control work reads the shared clock, so it
    // must block calm (freezing it would stall worker elapsed labels/linger).
    expect(isAmbientCalmIdle(idleSignals({ backgroundWork: true }))).toBe(false);
  });

  it('treats a missing streaming phase as idle', () => {
    expect(isAmbientCalmIdle(idleSignals({ streamingPhase: undefined }))).toBe(true);
  });
});

describe('calmAmbientClockMs', () => {
  it('floors the clock onto the grid', () => {
    expect(calmAmbientClockMs(0, 250)).toBe(0);
    expect(calmAmbientClockMs(249, 250)).toBe(0);
    expect(calmAmbientClockMs(250, 250)).toBe(250);
    expect(calmAmbientClockMs(1123, 250)).toBe(1000);
    expect(calmAmbientClockMs(1123, 100)).toBe(1100);
  });

  it('passes through non-finite clocks and non-positive grids', () => {
    expect(calmAmbientClockMs(Number.NaN, 250)).toBeNaN();
    expect(calmAmbientClockMs(123, 0)).toBe(123);
    expect(calmAmbientClockMs(123, -5)).toBe(123);
  });
});

describe('shapeAmbientFrameClockMs', () => {
  it('keeps the raw clock on synchronized transports', () => {
    expect(shapeAmbientFrameClockMs(1123, 'synchronized', idleSignals())).toBe(1123);
  });

  it('keeps the raw clock while any activity runs, even when unstable', () => {
    expect(
      shapeAmbientFrameClockMs(1123, 'unstable', idleSignals({ streamingPhase: 'thinking' })),
    ).toBe(1123);
  });

  it('keeps the raw clock for background work, even when unstable and idle', () => {
    expect(shapeAmbientFrameClockMs(1123, 'unstable', idleSignals({ backgroundWork: true }))).toBe(
      1123,
    );
  });

  it('never pins the shared clock on unstable transports while idle', () => {
    // Decorative freeze is isolated to the starfield. Chrome indexes
    // appearanceAnimationNow(), so idle ConPTY must keep the raw stamp.
    expect(shapeAmbientFrameClockMs(1123, 'unstable', idleSignals())).toBe(1123);
    expect(shapeAmbientFrameClockMs(59_999, 'unstable', idleSignals())).toBe(59_999);
  });

  it('keeps the raw clock when stability is unknown', () => {
    expect(shapeAmbientFrameClockMs(1123, undefined, idleSignals())).toBe(1123);
  });
});

describe('hasRunningConductorWorkers', () => {
  it('is true only for a running card with a live worker', () => {
    expect(hasRunningConductorWorkers(undefined)).toBe(false);
    expect(hasRunningConductorWorkers(null)).toBe(false);
    expect(hasRunningConductorWorkers({ jobs: [] })).toBe(false);
    expect(hasRunningConductorWorkers({ jobs: [{ status: 'ok' }] })).toBe(false);
    // Running but no worker attached (e.g. queued) does not need the clock.
    expect(hasRunningConductorWorkers({ jobs: [{ status: 'running' }] })).toBe(false);
    expect(
      hasRunningConductorWorkers({ jobs: [{ status: 'running', workerAgentId: 'agent-1' }] }),
    ).toBe(true);
  });
});

describe('capAmbientIntervalForCalmTransport', () => {
  it('caps idle unstable ticks to the write-atomicity floor, not a freeze', () => {
    expect(UNSTABLE_IDLE_TICK_CAP_MS).toBe(80);
    expect(capAmbientIntervalForCalmTransport(16, 'unstable', true)).toBe(
      UNSTABLE_IDLE_TICK_CAP_MS,
    );
    expect(capAmbientIntervalForCalmTransport(33, 'unstable', true)).toBe(
      UNSTABLE_IDLE_TICK_CAP_MS,
    );
  });

  it('never shortens a slower cadence', () => {
    expect(capAmbientIntervalForCalmTransport(500, 'unstable', true)).toBe(500);
  });

  it('leaves the cadence alone when active or synchronized', () => {
    expect(capAmbientIntervalForCalmTransport(16, 'unstable', false)).toBe(16);
    expect(capAmbientIntervalForCalmTransport(16, 'synchronized', true)).toBe(16);
    expect(capAmbientIntervalForCalmTransport(16, undefined, true)).toBe(16);
  });

  it('passes through non-finite intervals', () => {
    expect(capAmbientIntervalForCalmTransport(Number.POSITIVE_INFINITY, 'unstable', true)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('resolveUnstableIdleClockGridMs', () => {
  it('defaults to the freeze grid', () => {
    expect(resolveUnstableIdleClockGridMs({})).toBe(UNSTABLE_IDLE_CLOCK_GRID_MS);
  });

  it('honors a positive integer override', () => {
    expect(
      resolveUnstableIdleClockGridMs({ SUPERLIORA_TUI_UNSTABLE_IDLE_QUANTUM_MS: '100' }),
    ).toBe(100);
  });

  it('rejects invalid overrides', () => {
    expect(
      resolveUnstableIdleClockGridMs({ SUPERLIORA_TUI_UNSTABLE_IDLE_QUANTUM_MS: 'abc' }),
    ).toBe(UNSTABLE_IDLE_CLOCK_GRID_MS);
    expect(
      resolveUnstableIdleClockGridMs({ SUPERLIORA_TUI_UNSTABLE_IDLE_QUANTUM_MS: '-10' }),
    ).toBe(UNSTABLE_IDLE_CLOCK_GRID_MS);
    expect(
      resolveUnstableIdleClockGridMs({ SUPERLIORA_TUI_UNSTABLE_IDLE_QUANTUM_MS: '' }),
    ).toBe(UNSTABLE_IDLE_CLOCK_GRID_MS);
  });
});

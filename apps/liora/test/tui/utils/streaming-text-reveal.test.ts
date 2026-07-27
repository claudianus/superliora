import { describe, expect, it } from 'vitest';

import {
  STREAM_REVEAL_BASE_CPS,
  STREAM_REVEAL_MAX_CPS,
} from '#/tui/constant/streaming';
import {
  advanceCodePointIndex,
  computeRevealAdvance,
  computeStagedLineReveal,
  countCodePoints,
  createStreamingTextRevealState,
  isRevealCaughtUp,
  resetRevealState,
  setRevealTarget,
  snapRevealToTarget,
  tickReveal,
  visibleText,
} from '#/tui/utils/streaming-text-reveal';

describe('countCodePoints / advanceCodePointIndex', () => {
  it('counts ASCII as one each', () => {
    expect(countCodePoints('hello')).toBe(5);
  });

  it('counts surrogate pairs as one code point', () => {
    expect(countCodePoints('👍a')).toBe(2);
    expect(countCodePoints('🌟b')).toBe(2);
  });

  it('advances past a surrogate pair in one step', () => {
    const text = '👍ab';
    const afterOne = advanceCodePointIndex(text, 0, 1);
    expect(afterOne).toBe(2); // thumbs-up is two UTF-16 units
    expect(text.slice(0, afterOne)).toBe('👍');
    const afterTwo = advanceCodePointIndex(text, afterOne, 1);
    expect(text.slice(0, afterTwo)).toBe('👍a');
  });
});

describe('setRevealTarget / snap / reset', () => {
  it('keeps visible prefix when target grows', () => {
    let state = createStreamingTextRevealState(1000);
    state = setRevealTarget(state, 'hello world', 1000);
    state = { ...state, visibleEnd: 5 }; // "hello"
    state = setRevealTarget(state, 'hello world!!!', 1100);
    expect(visibleText(state)).toBe('hello');
    expect(state.target).toBe('hello world!!!');
  });

  it('snaps when target is not a prefix extension', () => {
    let state = createStreamingTextRevealState(1000);
    state = setRevealTarget(state, 'hello', 1000);
    state = { ...state, visibleEnd: 3 };
    state = setRevealTarget(state, 'goodbye', 1100);
    expect(visibleText(state)).toBe('goodbye');
    expect(isRevealCaughtUp(state)).toBe(true);
  });

  it('snapRevealToTarget shows full target', () => {
    let state = createStreamingTextRevealState(1000);
    state = setRevealTarget(state, 'abcdef', 1000);
    state = { ...state, visibleEnd: 2 };
    state = snapRevealToTarget(state, 1200);
    expect(visibleText(state)).toBe('abcdef');
    expect(state.lastTickMs).toBe(1200);
  });

  it('resetRevealState clears target', () => {
    let state = createStreamingTextRevealState(1000);
    state = setRevealTarget(state, 'abc', 1000);
    state = resetRevealState(50);
    expect(state.target).toBe('');
    expect(state.visibleEnd).toBe(0);
    expect(state.lastTickMs).toBe(50);
  });
});

describe('computeRevealAdvance', () => {
  it('returns 0 when backlog is empty', () => {
    expect(
      computeRevealAdvance({ backlogCodePoints: 0, dtMs: 33 }),
    ).toBe(0);
  });

  it('advances at least min chars when lagging', () => {
    const advance = computeRevealAdvance({
      backlogCodePoints: 1,
      dtMs: 1,
      config: { baseCps: 1, maxCps: 10, minCharsPerTick: 1 },
    });
    expect(advance).toBe(1);
  });

  it('speeds up with larger backlog and clamps to max', () => {
    const small = computeRevealAdvance({
      backlogCodePoints: 5,
      dtMs: 100,
      config: {
        baseCps: STREAM_REVEAL_BASE_CPS,
        maxCps: STREAM_REVEAL_MAX_CPS,
        backlogGain: 6,
        maxLagMs: 10_000, // disable lag jump for this comparison
        minCharsPerTick: 1,
      },
    });
    const large = computeRevealAdvance({
      backlogCodePoints: 500,
      dtMs: 100,
      config: {
        baseCps: STREAM_REVEAL_BASE_CPS,
        maxCps: STREAM_REVEAL_MAX_CPS,
        backlogGain: 6,
        maxLagMs: 10_000,
        minCharsPerTick: 1,
      },
    });
    expect(large).toBeGreaterThan(small);
    // 100ms at MAX_CPS → at most maxCps/10 code points from speed alone
    expect(large).toBeLessThanOrEqual(Math.ceil(STREAM_REVEAL_MAX_CPS / 10) + 8);
  });

  it('jumps farther when lag exceeds maxLagMs', () => {
    const withoutCap = computeRevealAdvance({
      backlogCodePoints: 1000,
      dtMs: 16,
      config: {
        baseCps: 80,
        maxCps: 200,
        backlogGain: 0,
        maxLagMs: 60_000,
        minCharsPerTick: 1,
      },
    });
    const withCap = computeRevealAdvance({
      backlogCodePoints: 1000,
      dtMs: 16,
      config: {
        baseCps: 80,
        maxCps: 200,
        backlogGain: 0,
        maxLagMs: 50,
        minCharsPerTick: 1,
      },
    });
    expect(withCap).toBeGreaterThan(withoutCap);
  });
});

describe('tickReveal', () => {
  it('eventually reveals a short target across ticks', () => {
    let state = createStreamingTextRevealState(0);
    state = setRevealTarget(state, 'hi there', 0);
    expect(visibleText(state)).toBe('');

    // First tick uses nominal 16ms dt when lastTick was just set via setTarget
    // with lastTickMs preserved at 0 → effectiveDt 16.
    state = tickReveal(state, 16);
    expect(visibleText(state).length).toBeGreaterThan(0);

    for (let t = 50; t < 2000 && !isRevealCaughtUp(state); t += 33) {
      state = tickReveal(state, t);
    }
    expect(visibleText(state)).toBe('hi there');
    expect(isRevealCaughtUp(state)).toBe(true);
  });

  it('keeps partial progress when target grows mid-stream', () => {
    let state = createStreamingTextRevealState(0);
    state = setRevealTarget(state, 'abcdefghij', 0);
    state = tickReveal(state, 50);
    const partial = visibleText(state);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(10);

    state = setRevealTarget(state, 'abcdefghijKLMNOP', 50);
    expect(visibleText(state)).toBe(partial);

    state = tickReveal(state, 100);
    expect(visibleText(state).startsWith(partial)).toBe(true);
    expect(visibleText(state).length).toBeGreaterThanOrEqual(partial.length);
  });

  it('does not split a surrogate pair', () => {
    let state = createStreamingTextRevealState(0);
    state = setRevealTarget(state, '👍x', 0);
    // Force one code point per tick.
    state = tickReveal(state, 16, {
      baseCps: 1,
      maxCps: 1,
      backlogGain: 0,
      maxLagMs: 60_000,
      minCharsPerTick: 1,
    });
    const shown = visibleText(state);
    expect(shown).toBe('👍');
    expect(shown.length).toBe(2); // UTF-16 units
  });

  it('snap after partial then stays caught up', () => {
    let state = createStreamingTextRevealState(0);
    state = setRevealTarget(state, 'abcdef', 0);
    state = tickReveal(state, 16);
    state = snapRevealToTarget(state, 100);
    expect(isRevealCaughtUp(state)).toBe(true);
    state = tickReveal(state, 200);
    expect(visibleText(state)).toBe('abcdef');
  });
});

describe('computeStagedLineReveal', () => {
  it('shows a strict subset at t0+epsilon and every line after the cap', () => {
    const first = computeStagedLineReveal({ totalLines: 12, elapsedMs: 1, durationMs: 400 });
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThan(12);

    const mid = computeStagedLineReveal({ totalLines: 12, elapsedMs: 200, durationMs: 400 });
    expect(mid).toBeGreaterThan(first);
    expect(mid).toBeLessThan(12);

    expect(computeStagedLineReveal({ totalLines: 12, elapsedMs: 400, durationMs: 400 })).toBe(12);
    expect(computeStagedLineReveal({ totalLines: 12, elapsedMs: 10_000, durationMs: 400 })).toBe(12);
  });

  it('grows monotonically and lands exactly on the total', () => {
    let previous = 0;
    for (let elapsed = 0; elapsed <= 400; elapsed += 25) {
      const visible = computeStagedLineReveal({
        totalLines: 20,
        elapsedMs: elapsed,
        durationMs: 400,
      });
      expect(visible).toBeGreaterThanOrEqual(previous);
      previous = visible;
    }
    expect(previous).toBe(20);
  });

  it('shows everything immediately when motion is off (duration 0)', () => {
    expect(computeStagedLineReveal({ totalLines: 9, elapsedMs: 0, durationMs: 0 })).toBe(9);
  });

  it('handles empty and single-line blocks', () => {
    expect(computeStagedLineReveal({ totalLines: 0, elapsedMs: 0, durationMs: 400 })).toBe(0);
    expect(computeStagedLineReveal({ totalLines: 1, elapsedMs: 0, durationMs: 400 })).toBe(1);
  });
});

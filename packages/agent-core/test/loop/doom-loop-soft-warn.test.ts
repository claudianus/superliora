import { afterEach, describe, expect, it } from 'vitest';

import {
  DOOM_LOOP_WARN_PREFIX,
  REPETITION_HARD_STOP_THRESHOLD,
  REPETITION_WARN_THRESHOLD,
  formatDoomLoopWarnTip,
  getToolCallPatternCount,
  resetIdempotencyTracker,
  trackToolCallPattern,
} from '../../src/loop/tool-call-guards';

// trackToolCallPattern uses module-level state; clear via hard-stop path +
// re-import isolation is imperfect — we only assert pure tip + threshold math.

describe('formatDoomLoopWarnTip', () => {
  it('names the tool, count, and hard-stop ceiling', () => {
    const tip = formatDoomLoopWarnTip('Bash', REPETITION_WARN_THRESHOLD);
    expect(tip.startsWith(DOOM_LOOP_WARN_PREFIX)).toBe(true);
    expect(tip).toContain('Bash');
    expect(tip).toContain(String(REPETITION_WARN_THRESHOLD));
    expect(tip).toContain(String(REPETITION_HARD_STOP_THRESHOLD));
  });
});

describe('trackToolCallPattern soft-warn threshold', () => {
  afterEach(() => {
    // Pattern map is not fully public-reset; burn remaining calls to hard-stop
    // then leave module state as-is for the next case (each case uses unique args).
    resetIdempotencyTracker();
  });

  it('returns warn exactly once at REPETITION_WARN_THRESHOLD', () => {
    const args = { path: `soft-warn-${String(Date.now())}` };
    let warnHits = 0;
    let hardHits = 0;
    for (let i = 1; i <= REPETITION_HARD_STOP_THRESHOLD; i++) {
      const verdict = trackToolCallPattern('Read', args);
      if (verdict.action === 'warn') {
        warnHits += 1;
        expect(verdict.count).toBe(REPETITION_WARN_THRESHOLD);
      }
      if (verdict.action === 'hard_stop') {
        hardHits += 1;
        expect(verdict.code).toBe('DOOM_LOOP_HARD_STOP');
      }
    }
    expect(warnHits).toBe(1);
    expect(hardHits).toBe(1);
    expect(getToolCallPatternCount('Read', args)).toBe(REPETITION_HARD_STOP_THRESHOLD);
  });
});

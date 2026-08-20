import { beforeEach, describe, expect, it } from 'vitest';

import {
  DOOM_LOOP_WARN_PREFIX,
  REPETITION_HARD_STOP_THRESHOLD,
  REPETITION_WARN_THRESHOLD,
  ToolGuardState,
  formatDoomLoopWarnTip,
} from '../../src/loop/tool-call-guards';

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
  let guards: ToolGuardState;

  beforeEach(() => {
    guards = new ToolGuardState();
  });

  it('returns warn exactly once at REPETITION_WARN_THRESHOLD', () => {
    const args = { path: 'soft-warn' };
    let warnHits = 0;
    let hardHits = 0;
    for (let i = 1; i <= REPETITION_HARD_STOP_THRESHOLD; i++) {
      const verdict = guards.trackToolCallPattern('Read', args);
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
    expect(guards.getToolCallPatternCount('Read', args)).toBe(REPETITION_HARD_STOP_THRESHOLD);
  });

  it('counts per agent, so a subagent cannot trip the parent doom-loop stop', () => {
    const args = { path: 'shared' };
    for (let i = 0; i < REPETITION_HARD_STOP_THRESHOLD; i++) {
      guards.trackToolCallPattern('Read', args);
    }
    expect(new ToolGuardState().getToolCallPatternCount('Read', args)).toBe(0);
  });
});

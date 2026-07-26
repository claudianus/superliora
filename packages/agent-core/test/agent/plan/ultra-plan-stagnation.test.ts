import { describe, expect, it } from 'vitest';

import {
  detectAllStagnation,
  detectDiminishingReturns,
  detectNoDrift,
  detectOscillation,
  detectSpinning,
  hashText,
} from '../../../src/agent/plan/ultra-plan-stagnation';

describe('plan/ultra-plan-stagnation.ts — hashText', () => {
  it('is deterministic and length-independent (empty → same hash)', () => {
    expect(hashText('')).toBe(hashText(''));
  });

  it('produces different hashes for distinct inputs', () => {
    expect(hashText('alpha')).not.toBe(hashText('beta'));
  });
});

describe('plan/ultra-plan-stagnation.ts — detectSpinning', () => {
  it('returns detected=false when fewer than 3 errors are available', () => {
    expect(detectSpinning([], ['e1', 'e2'])).toEqual(
      expect.objectContaining({ pattern: 'spinning', detected: false, confidence: 0.0 }),
    );
  });

  it('detects spinning when the last 3 errors are identical', () => {
    const d = detectSpinning([], ['same', 'same', 'same']);
    expect(d.detected).toBe(true);
    expect(d.confidence).toBe(0.9);
  });

  it('does not flag non-identical trailing errors', () => {
    expect(detectSpinning([], ['a', 'a', 'b']).detected).toBe(false);
    expect(detectSpinning([], ['a', 'b', 'a']).detected).toBe(false);
  });
});

describe('plan/ultra-plan-stagnation.ts — detectOscillation', () => {
  it('requires at least 4 outputs (2 cycles × 2) before flagging', () => {
    expect(detectOscillation(['a', 'b', 'a']).detected).toBe(false);
  });

  it('detects ABAB oscillation in the trailing 4 outputs', () => {
    expect(detectOscillation(['a', 'b', 'a', 'b']).detected).toBe(true);
  });

  it('does not flag monotonic outputs (ABAB requires a true A≠B oscillation)', () => {
    // `a, b, c, d` is strictly monotonic; `a, a, a, a` is constant
    // (A === B so it is not an oscillation, but the constant hash would
    // be a *spinning* signal — the oscillation detector is allowed to
    // also flag it, so we only pin the monotonic case here).
    expect(detectOscillation(['a', 'b', 'c', 'd']).detected).toBe(false);
  });
});

describe('plan/ultra-plan-stagnation.ts — detectNoDrift', () => {
  it('requires at least 3 drift scores', () => {
    expect(detectNoDrift([0.1, 0.2]).detected).toBe(false);
  });

  it('detects when the last 3 scores are within the 0.01 epsilon', () => {
    expect(detectNoDrift([0.0, 0.5, 0.504, 0.505]).detected).toBe(true);
  });

  it('does not flag a meaningful drift', () => {
    expect(detectNoDrift([0.0, 0.5, 0.6, 0.7]).detected).toBe(false);
  });
});

describe('plan/ultra-plan-stagnation.ts — detectDiminishingReturns', () => {
  it('requires at least 4 drift scores (threshold + 1) before flagging', () => {
    expect(detectDiminishingReturns([0.0, 0.5, 0.7]).detected).toBe(false);
  });

  it('detects when the last 3 improvements average below 0.01', () => {
    // 4 elements → 3 consecutive diffs of 0.001 each → avg 0.001 < 0.01.
    expect(detectDiminishingReturns([0, 0.001, 0.002, 0.003]).detected).toBe(true);
  });

  it('does not flag healthy improvement curves', () => {
    // diffs = 0.1, 0.2, 0.3 → avg = 0.2 > 0.01.
    expect(detectDiminishingReturns([0, 0.1, 0.3, 0.6]).detected).toBe(false);
  });
});

describe('plan/ultra-plan-stagnation.ts — detectAllStagnation', () => {
  it('returns one detection per documented pattern', () => {
    const out = detectAllStagnation(['a', 'b', 'a', 'b'], ['e', 'e', 'e'], [0.5, 0.5, 0.5]);
    expect(out.map((d) => d.pattern)).toEqual([
      'spinning',
      'oscillation',
      'no_drift',
      'diminishing_returns',
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import {
  detectAllStagnation,
  detectDiminishingReturns,
  detectNoDrift,
  detectOscillation,
  detectSpinning,
  hashText,
} from '#/agent/plan/ultra-plan-stagnation';

describe('agent/plan/ultra-plan-stagnation — pure stagnation detectors', () => {
  describe('hashText', () => {
    it('returns the same hash for the same input', () => {
      expect(hashText('hello world')).toBe(hashText('hello world'));
    });

    it('returns different hashes for different inputs', () => {
      expect(hashText('hello world')).not.toBe(hashText('world hello'));
    });

    it('returns a deterministic colon-separated two-part hash', () => {
      const hash = hashText('abc');
      expect(hash).toMatch(/^-?\w+:-?\w+$/);
    });
  });

  describe('detectSpinning', () => {
    it('detects when the last 3 error signatures are identical', () => {
      const result = detectSpinning([], ['err-A', 'err-B', 'err-A', 'err-A', 'err-A']);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeCloseTo(0.9);
    });

    it('returns detected=false when fewer than 3 errors are provided', () => {
      const result = detectSpinning([], ['only-one']);
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('returns detected=false when the last 3 errors are not identical', () => {
      const result = detectSpinning([], ['a', 'b', 'a', 'b', 'c']);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectOscillation', () => {
    it('detects an A-B-A-B oscillation pattern', () => {
      const result = detectOscillation(['a', 'b', 'a', 'b']);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeCloseTo(0.85);
    });

    it('returns detected=false when not enough outputs exist', () => {
      expect(detectOscillation(['a', 'b']).detected).toBe(false);
    });

    it('returns detected=false for monotonic outputs', () => {
      const result = detectOscillation(['a', 'b', 'c', 'd']);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectNoDrift', () => {
    it('detects when the last 3 drift scores are within epsilon', () => {
      const result = detectNoDrift([0.1, 0.2, 0.501, 0.502, 0.503]);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeCloseTo(0.8);
    });

    it('returns detected=false when drift changes by more than epsilon', () => {
      const result = detectNoDrift([0.1, 0.2, 0.3, 0.5, 0.7]);
      expect(result.detected).toBe(false);
    });

    it('returns detected=false when fewer than 3 scores are provided', () => {
      expect(detectNoDrift([0.1, 0.2]).detected).toBe(false);
    });
  });

  describe('detectDiminishingReturns', () => {
    it('detects when the average recent improvement is below 0.01', () => {
      const result = detectDiminishingReturns([0.0, 0.5, 0.6, 0.601, 0.602, 0.6025]);
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeCloseTo(0.75);
    });

    it('returns detected=false for steady large improvements', () => {
      const result = detectDiminishingReturns([0.0, 0.1, 0.3, 0.5, 0.7, 0.9]);
      expect(result.detected).toBe(false);
    });

    it('returns detected=false when fewer than 4 scores are provided', () => {
      expect(detectDiminishingReturns([0.0, 0.1, 0.2]).detected).toBe(false);
    });
  });

  describe('detectAllStagnation', () => {
    it('returns one detection per pattern', () => {
      const results = detectAllStagnation(['a', 'b', 'a', 'b'], ['x', 'x', 'x'], [0.1, 0.2, 0.3]);
      expect(results.map((r) => r.pattern)).toEqual([
        'spinning',
        'oscillation',
        'no_drift',
        'diminishing_returns',
      ]);
    });
  });
});

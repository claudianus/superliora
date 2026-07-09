import { describe, expect, it } from 'vitest';

import {
  compressionResistance,
  gzipDensityScore,
  surpriseScore,
  tokenNormalizedDensity,
} from '../../../src/lean-context/gate/density';

describe('gzipDensityScore', () => {
  it('returns 0 for empty input', () => {
    expect(gzipDensityScore('')).toBe(0);
  });

  it('scores highly repetitive text lower than varied text', () => {
    const boilerplate = 'export default function noop() { return null; }\n'.repeat(100);
    const varied =
      'The quantum resolver dispatches payloads through a non-linear cache. ' +
      'Each fragment carries a unique signature derived from entangled state. ' +
      'Reconciliation merges these signatures via a merkle-dag accumulator.';

    expect(gzipDensityScore(boilerplate)).toBeLessThan(gzipDensityScore(varied));
  });

  it('returns a value in [0, 1]', () => {
    const score = gzipDensityScore('a b c d e f g h i j k l m n o p');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('tokenNormalizedDensity', () => {
  it('returns 0 for empty input', () => {
    expect(tokenNormalizedDensity('')).toBe(0);
  });

  it('is positive for non-empty text', () => {
    expect(tokenNormalizedDensity('some meaningful text with identifiers')).toBeGreaterThan(0);
  });
});

describe('surpriseScore', () => {
  it('scores repetitive boilerplate lower than project-specific code', () => {
    const boilerplate = '{ "name": "a", "version": "1.0.0" }\n'.repeat(50);
    const projectCode = [
      'export class QuantumResolver {',
      '  private reconcileFragment(frag: EntangledPayload): MerkleDag {',
      '    if (frag.signature.collidesWith(this.priorState)) {',
      '      return this.accumulator.fork(frag.lineage);',
      '    }',
      '    return this.accumulator.merge(frag.lineage);',
      '  }',
      '}',
    ].join('\n');

    expect(surpriseScore(boilerplate)).toBeLessThan(surpriseScore(projectCode));
  });

  it('returns a value in [0, 1]', () => {
    const score = surpriseScore('arbitrary content with some camelCase words');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('rises relative to a low baseline and falls relative to a high one', () => {
    const text = 'function computeScore() { return quantize(this.payload); }';
    // Text denser than the baseline scores higher; the baseline shifts the
    // reference point, so a low baseline (sparse repo) makes this dense
    // snippet stand out more.
    expect(surpriseScore(text, 0.2)).toBeGreaterThan(surpriseScore(text, 0.8));
  });
});

describe('compressionResistance', () => {
  it('tracks surpriseScore — boilerplate resists compression less', () => {
    const boilerplate = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const dense = 'QuantumResolver reconcileFragment MerkleDag entangledPayload forkLineage';
    expect(compressionResistance(boilerplate)).toBeLessThan(compressionResistance(dense));
  });
});

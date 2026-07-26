import { describe, expect, it } from 'vitest';

import {
  bounceRateForPath,
  getGateState,
  recordReadAccess,
  resolvePressureMode,
  shouldSkipCompressionForRead,
} from '../../../src/lean-context/gate/bounce';
import type { ToolStore } from '../../../src/tools/store';

function memoryStore(): ToolStore {
  const data = new Map<string, unknown>();
  return {
    get: (key: string) => data.get(key),
    set: (key: string, value: unknown) => {
      data.set(key, value);
    },
  } as unknown as ToolStore;
}

describe('lean-context gate bounce', () => {
  it('records read access and computes bounce rate', () => {
    const store = memoryStore();
    expect(bounceRateForPath(store, 'src/a.ts')).toBe(0);
    recordReadAccess(store, 'src/a.ts', 'compressed');
    recordReadAccess(store, 'src/a.ts', 'full');
    recordReadAccess(store, 'src/a.ts', 'compressed');
    recordReadAccess(store, 'src/a.ts', 'full');
    // bounces on transitions compressed→full: 2 of 3 transitions
    expect(bounceRateForPath(store, 'src/a.ts')).toBeCloseTo(2 / 3, 5);
    expect(getGateState(store).reads.length).toBe(4);
  });

  it('skips compression for windowed / lean LioraRead modes', () => {
    expect(shouldSkipCompressionForRead({ mode: 'signatures' })).toBe(true);
    expect(shouldSkipCompressionForRead({ mode: 'map' })).toBe(true);
    expect(shouldSkipCompressionForRead({ line_offset: 10, n_lines: 20 })).toBe(true);
    expect(shouldSkipCompressionForRead({ mode: 'full' })).toBe(false);
    expect(shouldSkipCompressionForRead({ mode: 'auto', raw: true })).toBe(false);
  });

  it('maps context usage into pressure modes', () => {
    expect(resolvePressureMode(undefined)).toBe('normal');
    expect(resolvePressureMode(0.4)).toBe('normal');
    expect(resolvePressureMode(0.75)).toBe('signatures');
    expect(resolvePressureMode(0.92)).toBe('aggressive');
  });
});

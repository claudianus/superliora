import { describe, expect, it } from 'vitest';
import { rendererAmbientIntervalMs } from '../src';

describe('rendererAmbientIntervalMs', () => {
  it('keeps premium at 33ms when healthy and full quality', () => {
    expect(
      rendererAmbientIntervalMs({
        requested: 'premium',
        quality: 'full',
        health: 'healthy',
        backpressure: false,
      }),
    ).toBe(33);
  });

  it('soft-degrades premium to subtle ms under pressure', () => {
    expect(
      rendererAmbientIntervalMs({
        requested: 'premium',
        quality: 'balanced',
        health: 'healthy',
      }),
    ).toBe(140);
    expect(
      rendererAmbientIntervalMs({
        requested: 'premium',
        quality: 'full',
        health: 'watch',
      }),
    ).toBe(140);
    expect(
      rendererAmbientIntervalMs({
        requested: 'premium',
        quality: 'full',
        health: 'healthy',
        backpressure: true,
      }),
    ).toBe(140);
  });

  it('returns Infinity for off without forcing callers to special-case', () => {
    expect(rendererAmbientIntervalMs({ requested: 'off' })).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps subtle at subtle ms even when healthy', () => {
    expect(
      rendererAmbientIntervalMs({
        requested: 'subtle',
        quality: 'full',
        health: 'healthy',
      }),
    ).toBe(140);
  });
});

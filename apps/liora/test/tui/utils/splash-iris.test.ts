import { describe, expect, it } from 'vitest';

import {
  applyIrisReveal,
  applyStageMorphReveal,
  resolveBrandMorphRect,
  resolveMorphProgress,
  SPLASH_IRIS_MS,
  SPLASH_MORPH_MS,
} from '#/tui/utils/splash-iris';

describe('splash morph handoff', () => {
  it('keeps default morph length near one second', () => {
    expect(SPLASH_MORPH_MS).toBe(1100);
    expect(SPLASH_IRIS_MS).toBe(SPLASH_MORPH_MS);
  });

  it('eases morph progress across the window', () => {
    expect(resolveMorphProgress(0, 1000, 1000)).toBe(0);
    expect(resolveMorphProgress(1000, 1000, 1000)).toBe(0);
    expect(resolveMorphProgress(1500, 1000, 1000)).toBeGreaterThan(0.4);
    expect(resolveMorphProgress(1500, 1000, 1000)).toBeLessThan(0.7);
    expect(resolveMorphProgress(2000, 1000, 1000)).toBe(1);
  });

  it('lerps brand rect from fullscreen toward the Welcome hero', () => {
    const mid = resolveBrandMorphRect({
      progress: 0.5,
      cols: 200,
      fromTop: 30,
      fromWidth: 200,
      to: { x: 55, y: 18, width: 80 },
    });
    expect(mid.width).toBeLessThan(200);
    expect(mid.width).toBeGreaterThan(80);
    expect(mid.y).toBeLessThan(30);
    expect(mid.y).toBeGreaterThan(18);
    expect(mid.x).toBeGreaterThan(0);
  });

  it('opens a centered morph aperture onto the stage scene', () => {
    const width = 40;
    const rows = 20;
    const backdrop = Array.from({ length: rows }, () => 'B'.repeat(width));
    const scene = Array.from({ length: rows }, () => 'S'.repeat(width));
    const closed = applyStageMorphReveal({
      backdrop,
      scene,
      width,
      rows,
      progress: 0,
    });
    expect(closed.every((line) => line.includes('B'))).toBe(true);

    const open = applyStageMorphReveal({
      backdrop,
      scene,
      width,
      rows,
      progress: 1,
    });
    expect(open.every((line) => line.replaceAll(/\s/g, '').includes('S'))).toBe(true);
  });

  it('keeps legacy iris ellipse helper working', () => {
    const width = 40;
    const rows = 20;
    const backdrop = Array.from({ length: rows }, () => 'B'.repeat(width));
    const reveal = Array.from({ length: rows }, () => 'R'.repeat(width));
    const open = applyIrisReveal({
      backdrop,
      reveal,
      width,
      rows,
      progress: 1,
      paintRing: (t) => t,
    });
    expect(open.every((line) => line.replaceAll(/\s/g, '').includes('R'))).toBe(true);
  });
});

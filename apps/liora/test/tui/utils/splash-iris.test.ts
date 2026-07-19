import { describe, expect, it } from 'vitest';

import { applyIrisReveal, resolveIrisProgress, SPLASH_IRIS_MS } from '#/tui/utils/splash-iris';

describe('splash-iris', () => {
  it('keeps default iris length near one second', () => {
    expect(SPLASH_IRIS_MS).toBe(1000);
  });

  it('eases iris progress across the window', () => {
    expect(resolveIrisProgress(0, 1000, 1000)).toBe(0);
    expect(resolveIrisProgress(1000, 1000, 1000)).toBe(0);
    expect(resolveIrisProgress(1500, 1000, 1000)).toBeGreaterThan(0.4);
    expect(resolveIrisProgress(1500, 1000, 1000)).toBeLessThan(0.7);
    expect(resolveIrisProgress(2000, 1000, 1000)).toBe(1);
  });

  it('opens a reveal ellipse over the backdrop', () => {
    const width = 40;
    const rows = 20;
    const backdrop = Array.from({ length: rows }, () => 'B'.repeat(width));
    const reveal = Array.from({ length: rows }, () => 'R'.repeat(width));
    const closed = applyIrisReveal({
      backdrop,
      reveal,
      width,
      rows,
      progress: 0,
      paintRing: (t) => t,
    });
    expect(closed.every((line) => line.includes('B'))).toBe(true);

    const open = applyIrisReveal({
      backdrop,
      reveal,
      width,
      rows,
      progress: 1,
      paintRing: (t) => t,
    });
    expect(open.every((line) => line.replaceAll(/\s/g, '').includes('R'))).toBe(true);

    const mid = applyIrisReveal({
      backdrop,
      reveal,
      width,
      rows,
      progress: 0.45,
      paintRing: (t) => t,
    });
    const joined = mid.join('\n');
    expect(joined).toContain('R');
    expect(joined).toContain('B');
  });
});

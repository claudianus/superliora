import { describe, expect, it } from 'vitest';

import {
  FOCUS_TRANSFER_PREMIUM_MS,
  REFLOW_PREMIUM_MS,
  SHELL_SETTLE_PREMIUM_MS,
  focusTransferProgress,
  lerpDockWidth,
  reflowProgress,
  shellSettleProgress,
} from '#/tui/workspace/shell-motion';

describe('shellSettleProgress', () => {
  it('snaps settle progress to 1 when motion disallowed', () => {
    expect(shellSettleProgress(1000, 900, { motion: false, quality: 'off' })).toBe(1);
  });

  it('snaps settle progress to 1 for the off quality tier (instant)', () => {
    expect(shellSettleProgress(1000, 900, { motion: true, quality: 'off' })).toBe(1);
  });

  it('eases settle across ~160ms in premium', () => {
    const p = shellSettleProgress(1080, 1000, { motion: true, quality: 'premium' });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('reaches 1 once the premium settle window has elapsed', () => {
    const p = shellSettleProgress(1000 + SHELL_SETTLE_PREMIUM_MS, 1000, {
      motion: true,
      quality: 'premium',
    });
    expect(p).toBe(1);
  });

  it('subtle uses a shorter fade than premium at the same elapsed time', () => {
    const now = 1050;
    const startedAt = 1000;
    const premium = shellSettleProgress(now, startedAt, { motion: true, quality: 'premium' });
    const subtle = shellSettleProgress(now, startedAt, { motion: true, quality: 'subtle' });
    expect(subtle).toBeGreaterThan(premium);
  });

  it('never returns a value outside [0, 1]', () => {
    expect(shellSettleProgress(900, 1000, { motion: true, quality: 'premium' })).toBeGreaterThanOrEqual(0);
    expect(shellSettleProgress(5000, 1000, { motion: true, quality: 'premium' })).toBeLessThanOrEqual(1);
  });
});

describe('focusTransferProgress', () => {
  it('snaps to 1 when motion is disallowed', () => {
    expect(focusTransferProgress(1000, 900, { motion: false, quality: 'premium' })).toBe(1);
  });

  it('snaps to 1 for the off quality tier', () => {
    expect(focusTransferProgress(1000, 900, { motion: true, quality: 'off' })).toBe(1);
  });

  it('eases the column glow blend across the premium transfer window', () => {
    const p = focusTransferProgress(1100, 1000, { motion: true, quality: 'premium' });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('reaches 1 once the premium transfer window has elapsed', () => {
    const p = focusTransferProgress(1000 + FOCUS_TRANSFER_PREMIUM_MS, 1000, {
      motion: true,
      quality: 'premium',
    });
    expect(p).toBe(1);
  });

  it('subtle still animates but as a shorter fade than premium', () => {
    const now = 1060;
    const startedAt = 1000;
    const premium = focusTransferProgress(now, startedAt, { motion: true, quality: 'premium' });
    const subtle = focusTransferProgress(now, startedAt, { motion: true, quality: 'subtle' });
    expect(subtle).toBeGreaterThan(premium);
    expect(subtle).toBeLessThanOrEqual(1);
  });
});

describe('reflowProgress', () => {
  it('snaps to 1 when motion is disallowed', () => {
    expect(reflowProgress(1000, 900, { motion: false, quality: 'premium' })).toBe(1);
  });

  it('snaps to 1 for the off quality tier (instant reflow)', () => {
    expect(reflowProgress(1000, 900, { motion: true, quality: 'off' })).toBe(1);
  });

  it('snaps to 1 for the subtle quality tier — no long reflow, short fade only elsewhere', () => {
    expect(reflowProgress(1050, 1000, { motion: true, quality: 'subtle' })).toBe(1);
  });

  it('eases the paint-only lerp across the premium ~180ms reflow window', () => {
    const p = reflowProgress(1090, 1000, { motion: true, quality: 'premium' });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('reaches 1 once the premium reflow window has elapsed', () => {
    const p = reflowProgress(1000 + REFLOW_PREMIUM_MS, 1000, { motion: true, quality: 'premium' });
    expect(p).toBe(1);
  });
});

describe('lerpDockWidth', () => {
  it('returns the start width at progress 0', () => {
    expect(lerpDockWidth(0, 32, 0)).toBe(0);
  });

  it('returns the end width at progress 1', () => {
    expect(lerpDockWidth(0, 32, 1)).toBe(32);
  });

  it('interpolates and rounds to whole columns midway', () => {
    expect(lerpDockWidth(0, 32, 0.5)).toBe(16);
  });

  it('clamps progress outside [0, 1]', () => {
    expect(lerpDockWidth(10, 20, -1)).toBe(10);
    expect(lerpDockWidth(10, 20, 2)).toBe(20);
  });

  it('supports shrinking from a wider to a narrower width', () => {
    expect(lerpDockWidth(40, 0, 0.5)).toBe(20);
  });
});

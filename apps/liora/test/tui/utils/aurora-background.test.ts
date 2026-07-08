import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppearancePreferences } from '#/tui/config';
import type { RendererCell } from '#/tui/renderer';
import { currentTheme, darkColors } from '#/tui/theme';
import { buildAuroraBackground, resolveAuroraMode } from '#/tui/utils/aurora-background';

const PREMIUM_APPEARANCE: AppearancePreferences = {
  profile: 'premium',
  density: 'spacious',
  particles: 'premium',
  mascot: 'premium',
  animationFps: 20,
  canvasBackground: true,
  terminalBackground: 'off',
  terminalPalette: false,
};

const OFF_APPEARANCE: AppearancePreferences = { ...PREMIUM_APPEARANCE, profile: 'off' };

function allowMotion(): void {
  process.env['TERM'] = 'xterm-256color';
  delete process.env['NO_COLOR'];
  delete process.env['CI'];
  delete process.env['SSH_TTY'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_CLIENT'];
}

describe('buildAuroraBackground', () => {
  beforeEach(() => {
    currentTheme.setPalette(darkColors);
    allowMotion();
  });

  afterEach(() => {
    currentTheme.setPalette(darkColors);
  });

  it('returns an empty array for zero dimensions', () => {
    expect(buildAuroraBackground({ width: 0, height: 10, nowMs: 0, appearance: PREMIUM_APPEARANCE })).toEqual([]);
    expect(buildAuroraBackground({ width: 10, height: 0, nowMs: 0, appearance: PREMIUM_APPEARANCE })).toEqual([]);
  });

  it('produces one row per height and one cell per width', () => {
    const rows = buildAuroraBackground({ width: 5, height: 3, nowMs: 0, appearance: PREMIUM_APPEARANCE });
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(5);
  });

  it('cells carry only a background style (no foreground), preserving text readability', () => {
    const rows = buildAuroraBackground({ width: 8, height: 2, nowMs: 1000, appearance: PREMIUM_APPEARANCE });
    for (const row of rows) {
      for (const cell of row) {
        expect(cell.char).toBe(' ');
        expect(cell.style?.fg).toBeUndefined();
        expect(cell.style?.bg).toBeTruthy();
      }
    }
  });

  it('keeps the base background as the majority contributor (blend ≤ intensity cap)', () => {
    const rows = buildAuroraBackground({ width: 40, height: 20, nowMs: 5000, appearance: PREMIUM_APPEARANCE });
    const base = darkColors.background;
    for (const row of rows) {
      for (const cell of row) {
        expect(closerTo(cell.style?.bg, base, darkColors.auroraA)).toBe(true);
        expect(closerTo(cell.style?.bg, base, darkColors.auroraB)).toBe(true);
        expect(closerTo(cell.style?.bg, base, darkColors.auroraC)).toBe(true);
      }
    }
  });

  it('is deterministic for identical inputs', () => {
    const a = buildAuroraBackground({ width: 12, height: 4, nowMs: 1234, appearance: PREMIUM_APPEARANCE });
    const b = buildAuroraBackground({ width: 12, height: 4, nowMs: 1234, appearance: PREMIUM_APPEARANCE });
    expect(b).toEqual(a);
  });

  it('animates: different nowMs yields different output in premium mode', () => {
    const a = buildAuroraBackground({ width: 30, height: 6, nowMs: 0, appearance: PREMIUM_APPEARANCE });
    const b = buildAuroraBackground({ width: 30, height: 6, nowMs: 6_000, appearance: PREMIUM_APPEARANCE });
    expect(someCellDiffers(a, b)).toBe(true);
  });

  it('degrades to flat base background when ambient effects are off', () => {
    const rows = buildAuroraBackground({ width: 6, height: 2, nowMs: 5000, appearance: OFF_APPEARANCE });
    for (const row of rows) {
      for (const cell of row) {
        expect(cell.style?.bg).toBe(darkColors.background);
      }
    }
  });

  it('degrades to flat base background when TERM=dumb', () => {
    process.env['TERM'] = 'dumb';
    const rows = buildAuroraBackground({ width: 6, height: 2, nowMs: 5000, appearance: PREMIUM_APPEARANCE });
    for (const row of rows) {
      for (const cell of row) expect(cell.style?.bg).toBe(darkColors.background);
    }
  });
});

describe('resolveAuroraMode', () => {
  beforeEach(allowMotion);

  it('returns off when NO_COLOR is set', () => {
    process.env['NO_COLOR'] = '1';
    expect(resolveAuroraMode(PREMIUM_APPEARANCE)).toBe('off');
  });

  it('returns off on SSH sessions', () => {
    process.env['SSH_TTY'] = '/dev/ttys001';
    expect(resolveAuroraMode(PREMIUM_APPEARANCE)).toBe('off');
  });

  it('returns a non-off mode locally with premium appearance', () => {
    const mode = resolveAuroraMode(PREMIUM_APPEARANCE);
    expect(['subtle', 'premium']).toContain(mode);
  });

  it('returns off when appearance profile is off', () => {
    expect(resolveAuroraMode(OFF_APPEARANCE)).toBe('off');
  });
});

function closerTo(bg: string | undefined, base: string, anchor: string): boolean {
  if (bg === undefined) return true;
  return rgbDistance(bg, base) <= rgbDistance(bg, anchor);
}

function rgbDistance(a: string, b: string): number {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (pa === undefined || pb === undefined) return Infinity;
  return (pa.r - pb.r) ** 2 + (pa.g - pb.g) ** 2 + (pa.b - pb.b) ** 2;
}

function parseHex(hex: string): { r: number; g: number; b: number } | undefined {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (match === null) return undefined;
  const n = Number.parseInt(match[1]!, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function someCellDiffers(a: readonly (readonly RendererCell[])[], b: readonly (readonly RendererCell[])[]): boolean {
  for (let y = 0; y < a.length; y++) {
    for (let x = 0; x < a[y]!.length; x++) {
      if (a[y]![x]!.style?.bg !== b[y]![x]!.style?.bg) return true;
    }
  }
  return false;
}

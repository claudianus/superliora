import { describe, expect, it } from 'vitest';

import { BUNDLED_THEMES } from '#/tui/theme/bundled-themes';
import { darkColors, lightColors, type ColorPalette } from '#/tui/theme/colors';

const MOTION_KEYS = [
  'gradientStart',
  'primary',
  'glow',
  'accent',
  'gradientEnd',
  'particle',
  'roleUser',
  'shellMode',
] as const satisfies readonly (keyof ColorPalette)[];

function parseHex(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** Cheap RGB distance — enough to catch near-duplicate motion anchors. */
function rgbDistance(a: string, b: string): number {
  const A = parseHex(a);
  const B = parseHex(b);
  return Math.hypot(A.r - B.r, A.g - B.g, A.b - B.b);
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function contrastRatio(fg: string, bg: string): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function assertMotionSpan(palette: ColorPalette, label: string): void {
  expect(palette.gradientStart, label).not.toBe(palette.gradientEnd);
  expect(palette.glow, label).not.toBe(palette.particle);
  expect(palette.roleUser, label).not.toBe(palette.shellMode);
  expect(rgbDistance(palette.gradientStart, palette.gradientEnd), label).toBeGreaterThan(40);
  expect(rgbDistance(palette.glow, palette.particle), label).toBeGreaterThan(35);
  // Warm and cool role anchors must stay distinct from the cool brand cluster.
  expect(rgbDistance(palette.roleUser, palette.primary), label).toBeGreaterThan(40);
  for (const key of MOTION_KEYS) {
    expect(palette[key], `${label}:${key}`).not.toBe(palette.success);
    expect(palette[key], `${label}:${key}`).not.toBe(palette.warning);
    expect(palette[key], `${label}:${key}`).not.toBe(palette.error);
  }
}

describe('theme hue span', () => {
  it('widens default dark motion anchors', () => {
    assertMotionSpan(darkColors, 'dark');
    expect(rgbDistance(darkColors.gradientStart, darkColors.gradientEnd)).toBeGreaterThan(80);
  });

  it('keeps light text/chrome AA after brand retune', () => {
    assertMotionSpan(lightColors, 'light');
    expect(contrastRatio(lightColors.text, lightColors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightColors.textDim, lightColors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightColors.border, lightColors.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(lightColors.primary, lightColors.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('widens every bundled theme motion span', () => {
    expect(BUNDLED_THEMES.length).toBeGreaterThanOrEqual(10);
    for (const theme of BUNDLED_THEMES) {
      const colors = theme.colors;
      expect(colors).toBeDefined();
      assertMotionSpan(colors as unknown as ColorPalette, theme.name);
    }
  });
});

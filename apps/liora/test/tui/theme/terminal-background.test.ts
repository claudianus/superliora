import { describe, expect, it } from 'vitest';

import { parseColorFgBg } from '#/tui/theme/detect';
import {
  hexRelativeLuminance,
  isLightBackgroundLuminance,
  linearizeSrgbChannel,
} from '#/tui/theme/luminance';
import { themeFromHexChannels } from '#/tui/theme/terminal-background';

describe('theme luminance helpers', () => {
  it('linearizes sRGB channels per WCAG', () => {
    expect(linearizeSrgbChannel(0)).toBe(0);
    expect(linearizeSrgbChannel(1)).toBeCloseTo(1, 5);
    // #808080 gamma 0.50196 → linear ~0.21586 (the mid-gray trap).
    expect(linearizeSrgbChannel(0x80 / 255)).toBeCloseTo(0.21586, 4);
    // Below the 0.04045 knee the response is linear.
    expect(linearizeSrgbChannel(0.02)).toBeCloseTo(0.02 / 12.92, 6);
  });

  it('classifies mid-gray #808080 as dark (was mis-classified light)', () => {
    expect(themeFromHexChannels('80', '80', '80')).toBe('dark');
    expect(isLightBackgroundLuminance(hexRelativeLuminance('#808080')!)).toBe(false);
  });

  it('keeps canonical terminal backgrounds on the right side', () => {
    expect(themeFromHexChannels('00', '00', '00')).toBe('dark');
    expect(themeFromHexChannels('ff', 'ff', 'ff')).toBe('light');
    // #1E1E1E (VS Code dark) and #0B0F14 (product dark) stay dark.
    expect(themeFromHexChannels('1e', '1e', '1e')).toBe('dark');
    expect(themeFromHexChannels('0b', '0f', '14')).toBe('dark');
    // #FAFAFA (light) stays light; #B0B0B0 flips to light past the threshold.
    expect(themeFromHexChannels('fa', 'fa', 'fa')).toBe('light');
    expect(themeFromHexChannels('b0', 'b0', 'b0')).toBe('light');
  });

  it('agrees between hex luminance and channel parsing', () => {
    const luma = hexRelativeLuminance('#3d9bff');
    expect(luma).toBeDefined();
    expect(themeFromHexChannels('3d', '9b', 'ff')).toBe(
      isLightBackgroundLuminance(luma!) ? 'light' : 'dark',
    );
  });

  it('rejects malformed hex luminance input', () => {
    expect(hexRelativeLuminance('nothex!')).toBeUndefined();
    expect(hexRelativeLuminance('#12345')).toBeUndefined();
    expect(hexRelativeLuminance('#1234567')).toBeUndefined();
  });
});

describe('parseColorFgBg', () => {
  it('maps the documented real-world values', () => {
    expect(parseColorFgBg('15;0')).toBe('dark'); // tmux dark
    expect(parseColorFgBg('0;15')).toBe('light'); // tmux light
    expect(parseColorFgBg('15;default;0')).toBe('dark'); // rxvt
    expect(parseColorFgBg('8')).toBe('dark'); // bright black
    expect(parseColorFgBg('7')).toBe('light');
  });

  it('falls back to null on out-of-range or garbage indices', () => {
    expect(parseColorFgBg('15;9999')).toBeNull();
    expect(parseColorFgBg('-1')).toBeNull();
    expect(parseColorFgBg('16')).toBeNull();
    expect(parseColorFgBg('abc')).toBeNull();
    expect(parseColorFgBg('')).toBeNull();
    expect(parseColorFgBg(undefined)).toBeNull();
  });
});

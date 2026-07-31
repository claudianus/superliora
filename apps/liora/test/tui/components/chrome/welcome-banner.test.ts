import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import chalk from 'chalk';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  renderWelcomeBanner,
  resolveBannerFontId,
  selectBannerFontId,
  type BannerFontId,
} from '#/tui/components/chrome/welcome-banner';
import { currentTheme, darkColors } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';

const CLEAN_FONTS: readonly BannerFontId[] = [
  'slant',
  'lcd',
  'standard',
  'smslant',
  'small',
];

describe('welcome banner gradient', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    currentTheme.setPalette(darkColors);
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    advanceAppearanceAnimationClock(Date.now());
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
  });

  it('keeps figlet on brand gradient hues (no roleUser gold jump)', () => {
    const premium = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    // Force slant so the glyph set is deterministic for the color probe.
    const lines = renderWelcomeBanner('standard', premium, 80, { fontId: 'slant' });
    expect(lines.length).toBeGreaterThan(2);
    const roleRgb = [
      parseInt(darkColors.roleUser.slice(1, 3), 16),
      parseInt(darkColors.roleUser.slice(3, 5), 16),
      parseInt(darkColors.roleUser.slice(5, 7), 16),
    ].join(';');
    for (const line of lines) {
      expect(line).not.toContain(`38;2;${roleRgb}`);
      expect(line).toContain('38;2;');
    }
  });

  it('animates banner shimmer across the clock', () => {
    const premium = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    advanceAppearanceAnimationClock(1_000);
    const a = renderWelcomeBanner('standard', premium, 80, { fontId: 'slant' }).join('\n');
    advanceAppearanceAnimationClock(1_000 + 700);
    const b = renderWelcomeBanner('standard', premium, 80, { fontId: 'slant' }).join('\n');
    expect(a).not.toBe(b);
  });

  it('only exposes the clean five-font pool', () => {
    const seen = new Set<BannerFontId>();
    for (let seed = 0; seed < 64; seed++) {
      seen.add(selectBannerFontId(seed));
    }
    expect([...seen].toSorted()).toEqual([...CLEAN_FONTS].toSorted());
    // Dense hand-built block font is gone from the pool.
    expect(CLEAN_FONTS).not.toContain('block');
  });

  it('falls back to slant when ambient effects are off', () => {
    const off = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off' as const,
      particles: 'off' as const,
    };
    expect(resolveBannerFontId(off, 99)).toBe('slant');
  });

  it('renders every clean font without throwing', () => {
    const premium = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    for (const fontId of CLEAN_FONTS) {
      const lines = renderWelcomeBanner('standard', premium, 80, { fontId });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.length).toBeGreaterThan(0);
      }
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import chalk from 'chalk';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { renderWelcomeBanner } from '#/tui/components/chrome/welcome-banner';
import { currentTheme, darkColors } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

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
    const lines = renderWelcomeBanner('standard', premium, 80);
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
    const a = renderWelcomeBanner('standard', premium, 80).join('\n');
    // Slow elegant wave needs ~1s delta to reliably differ (was frantic at 400ms).
    advanceAppearanceAnimationClock(1_000 + 1_200);
    const b = renderWelcomeBanner('standard', premium, 80).join('\n');
    expect(a).not.toBe(b);
  });
});

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

  it('paints figlet rows with a vertical gradientStart→gradientEnd blend', () => {
    const premium = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    const lines = renderWelcomeBanner('standard', premium, 80);
    expect(lines.length).toBeGreaterThan(2);
    const startRgb = [
      parseInt(darkColors.gradientStart.slice(1, 3), 16),
      parseInt(darkColors.gradientStart.slice(3, 5), 16),
      parseInt(darkColors.gradientStart.slice(5, 7), 16),
    ].join(';');
    const endRgb = [
      parseInt(darkColors.gradientEnd.slice(1, 3), 16),
      parseInt(darkColors.gradientEnd.slice(3, 5), 16),
      parseInt(darkColors.gradientEnd.slice(5, 7), 16),
    ].join(';');
    // Top row near gradientStart; bottom row near gradientEnd.
    expect(lines[0]).toContain(`38;2;${startRgb}`);
    expect(lines[lines.length - 1]).toContain(`38;2;${endRgb}`);
    // Must not jump to roleUser gold on the banner body.
    const roleRgb = [
      parseInt(darkColors.roleUser.slice(1, 3), 16),
      parseInt(darkColors.roleUser.slice(3, 5), 16),
      parseInt(darkColors.roleUser.slice(5, 7), 16),
    ].join(';');
    for (const line of lines) {
      expect(line).not.toContain(`38;2;${roleRgb}`);
    }
  });
});

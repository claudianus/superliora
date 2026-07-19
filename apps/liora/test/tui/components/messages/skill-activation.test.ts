import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkillActivationComponent } from '#/tui/components/messages/skill-activation';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('SkillActivationComponent', () => {
  const previous = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    chalkLevel: chalk.level,
  };

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    chalk.level = 3;
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
    chalk.level = previous.chalkLevel;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    if (previous.TERM === undefined) delete process.env['TERM'];
    else process.env['TERM'] = previous.TERM;
    if (previous.CI === undefined) delete process.env['CI'];
    else process.env['CI'] = previous.CI;
    if (previous.NO_COLOR === undefined) delete process.env['NO_COLOR'];
    else process.env['NO_COLOR'] = previous.NO_COLOR;
  });

  it('keeps the premium headline and pulses the secondary args line', () => {
    const early = new SkillActivationComponent('review', 'focus on auth');
    const earlyRaw = early.render(80).join('\n');
    expect(strip(earlyRaw)).toContain('Activated skill:');
    expect(strip(earlyRaw)).toContain('review');
    expect(strip(earlyRaw)).toContain('focus on auth');

    advanceAppearanceAnimationClock(Date.now() + 500);
    const later = new SkillActivationComponent('review', 'focus on auth');
    const laterRaw = later.render(80).join('\n');
    expect(strip(laterRaw)).toContain('focus on auth');
    expect(laterRaw).not.toBe(earlyRaw);
  });
});

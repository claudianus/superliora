import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatusMessageComponent } from '#/tui/components/messages/status-message';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
  STATUS_FLASH_MS,
} from '#/tui/features/appearance/appearance-effects';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('StatusMessageComponent enter/exit flash', () => {
  const previousEnv = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };
  const previousChalkLevel = chalk.level;
  const premium = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium' as const,
    particles: 'premium' as const,
  };

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    chalk.level = 3;
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences(premium);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
    chalk.level = previousChalkLevel;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('flashes on appearance and settles to static colored text after the window', () => {
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const component = new StatusMessageComponent('Warning: disk almost full', 'warning');

    const t0 = component.render(100).join('\n');
    expect(strip(t0)).toContain('Warning:');
    const staticLine = `  ${currentTheme.fg('warning', 'Warning: disk almost full')}`;
    expect(t0.trimEnd()).not.toBe(staticLine);

    // Past the full enter→exit window the line is byte-stable static text —
    // no shimmer, no flash residue.
    vi.setSystemTime(new Date(start + STATUS_FLASH_MS + 80));
    advanceAppearanceAnimationClock(Date.now());
    expect(component.render(100).join('\n').trimEnd()).toBe(staticLine);
  });

  it('keeps the settled line stable across later ambient ticks', () => {
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const component = new StatusMessageComponent('Error: boom', 'error');

    vi.setSystemTime(new Date(start + STATUS_FLASH_MS + 80));
    advanceAppearanceAnimationClock(Date.now());
    const settled = component.render(100);

    vi.setSystemTime(new Date(start + STATUS_FLASH_MS + 500));
    advanceAppearanceAnimationClock(Date.now());
    expect(component.render(100)).toEqual(settled);
  });

  it('renders static colored text with no flash when quality is off', () => {
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off' as const,
      particles: 'off' as const,
    });
    const start = Date.now();
    advanceAppearanceAnimationClock(start);
    const component = new StatusMessageComponent('Error: boom', 'error');
    const expected = `  ${currentTheme.fg('error', 'Error: boom')}`;
    expect(component.render(100).join('\n').trimEnd()).toBe(expected);

    vi.setSystemTime(new Date(start + 900));
    advanceAppearanceAnimationClock(Date.now());
    expect(component.render(100).join('\n').trimEnd()).toBe(expected);
  });

  it('multi-line content keeps streaming without per-line flashes', () => {
    const component = new StatusMessageComponent('line1\nline2', 'success');
    const out = component.render(100).join('\n');
    const visible = strip(out);
    expect(visible).toContain('line1');
    expect(visible).toContain('line2');
  });
});

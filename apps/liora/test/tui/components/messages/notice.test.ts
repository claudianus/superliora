import { visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  NoticeMessageComponent,
  StatusMessageComponent,
} from '#/tui/components/messages/status-message';
import { CronMessageComponent } from '#/tui/components/messages/cron-message';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('NoticeComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
    advanceAppearanceAnimationClock(Date.now());
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    vi.useRealTimers();
  });

  it('renders top and bottom spacing around the notice copy', () => {
    const component = new NoticeMessageComponent(
      'Plan mode: ON',
      'Plan will be created here: /tmp/plans/test-plan.md',
    );

    const lines = component.render(120).map((line) => strip(line));
    expect(lines[0]).toBe('');
    expect(lines[1]).toContain('Plan mode: ON');
    expect(lines[2]).toContain('Plan will be created here: /tmp/plans/test-plan.md');
  });

  it('animates notice titles with spectacular colors when ambient effects are on', () => {
    const previousEnv = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
    };
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];

    try {
      const component = new NoticeMessageComponent(
        'Ultrawork mode: ON',
        'Shift-Tab routes the next task through UltraPlan before any UltraGoal or Swarm work.',
      );
      component.invalidate();
      const rendered = component.render(120).join('\n');
      const codes = rendered.match(ANSI_SGR) ?? [];
      expect(codes.length).toBeGreaterThan(2);
      expect(strip(rendered)).toContain('Ultrawork mode: ON');
      expect(strip(rendered)).toContain('Shift-Tab routes the next task through UltraPlan');
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('CronMessageComponent', () => {
  it('keeps title, detail, and prompt within narrow widths', () => {
    const component = new CronMessageComponent('Please investigate the reminder payload and report back.', {
      cron: '*/15 * * * *',
      jobId: 'job-with-a-very-long-identifier-for-width-testing',
      recurring: true,
      missedCount: 3,
      stale: true,
    });

    for (const width of [39, 20, 10, 4]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe('StatusMessageComponent', () => {
  it('strips carriage returns so CRLF provider errors stay visible', () => {
    const component = new StatusMessageComponent('Error: boom\r\nmore\r', 'error');
    const text = component
      .render(120)
      .map((line) => strip(line))
      .join('\n');

    expect(text).toContain('Error: boom');
    expect(text).toContain('more');
    expect(text).not.toContain('\r');
  });
});

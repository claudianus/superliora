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
} from '#/tui/features/appearance/appearance-effects';

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
        'Mission mode: ON',
        'Shift-Tab routes the next task through Plan before any Goal or Fleet work.',
      );
      component.invalidate();
      const rendered = component.render(120).join('\n');
      const codes = rendered.match(ANSI_SGR) ?? [];
      expect(codes.length).toBeGreaterThan(2);
      // Title shimmer prefix may still use particle glyphs; details stay plain.
      const normalized = strip(rendered).replaceAll(/[·∙•◦*]/g, ' ');
      expect(normalized).toContain('Mission mode: ON');
      expect(normalized).toContain('Shift-Tab routes the next task through Plan');
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('keeps job inspect notice height stable across ambient ticks', () => {
    const previousEnv = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
      SSH_TTY: process.env['SSH_TTY'],
      SSH_CONNECTION: process.env['SSH_CONNECTION'],
      SSH_CLIENT: process.env['SSH_CLIENT'],
    };
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');

    try {
      const detail = [
        'job_abc  done  implement  p1  Fix the transcript flicker',
        'created=2026-08-23T00:00:00.000Z updated=2026-08-23T00:01:00.000Z',
        'effect: isolate on worktree',
        'isolation: worktree',
        'repo: D:\\superliora',
        'worktree: D:\\superliora\\.superliora\\worktrees\\job_abc',
        'brief:',
        'Fix JobInspect / JobInbox output so wrapping lines do not bounce while ambient motion runs on the shared clock.',
      ].join('\n');
      const notice = new NoticeMessageComponent(
        'Fix the transcript flicker',
        detail,
        'job-inspect:job_abc',
      );
      const width = 52;
      const rowCounts = new Set<number>();
      for (let t = 0; t < 2400; t += 80) {
        advanceAppearanceAnimationClock(t);
        notice.invalidate();
        rowCounts.add(notice.render(width).length);
      }
      expect(rowCounts.size).toBe(1);
      expect([...rowCounts][0]).toBeGreaterThan(6);
      const plain = notice.render(width).map((line) => strip(line)).join('\n');
      expect(plain).toContain('job_abc');
      expect(plain).toContain('isolation: worktree');
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

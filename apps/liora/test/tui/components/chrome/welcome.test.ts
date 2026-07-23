import { setCliLocale } from '#/cli/i18n';
import { visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import type { AppState } from '#/tui/types';
import {
  advanceAppearanceAnimationClock,
  setActiveAppearancePreferences,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

const appState: AppState = {
  version: '1.2.3',
  workDir: '/tmp/project',
  additionalDirs: [],
  sessionId: 'ses-1',
  sessionTitle: null,
  model: 'kimi-k2',
  permissionMode: 'manual',
  thinking: false,
  contextUsage: 0,
  contextTokens: 0,
  maxContextTokens: 0,
  isCompacting: false,
  isBackgroundCompacting: false,
  isReplaying: false,
  streamingPhase: 'idle',
  streamingStartTime: 0,
  planMode: false,
  inputMode: 'prompt',
  swarmMode: false,
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  availableModels: {},
  availableProviders: {},
  mcpServersSummary: null,
};

function ansiSequenceCount(text: string): number {
  return (text.match(ANSI_SGR) ?? []).length;
}

/** Banner lines (frameless welcome — skip leading blank + optional particle rail). */
function bannerOf(lines: string[]): string {
  const start = lines.findIndex((line) => /[_/\\|A-Za-z]/.test(strip(line)) && strip(line).trim().length > 4);
  const from = start >= 0 ? start : 0;
  return lines.slice(from, from + 6).join('\n');
}

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('WelcomeComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    vi.useRealTimers();
  });

  it('animates the banner with multi-color spectacular effects by default', () => {
    const previousEnv = {
      TERM: process.env['TERM'],
      CI: process.env['CI'],
      NO_COLOR: process.env['NO_COLOR'],
    };
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    advanceAppearanceAnimationClock(Date.now());

    try {
      const output = bannerOf(new WelcomeComponent(appState).render(80));
      expect(ansiSequenceCount(output)).toBeGreaterThan(6);
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('leads logged-in users to describe the task first', () => {
    setCliLocale('en');
    const output = strip(new WelcomeComponent(appState).render(80).join('\n'));

    expect(output).toContain('SUPERLIORA');
    expect(output).not.toContain('____  ___');
    expect(output).toContain('Type a task · /status web·office·media·ZDR · /bench · Shift-Tab Ultrawork');
    expect(output).not.toContain('Welcome to SuperLiora!');
    expect(output).not.toContain('Ultrawork plans, sets goal, swarms, verifies.');
    expect(output).not.toContain('helpers');
    expect(output).not.toContain('Kimi checks readiness and verification.');
    expect(output).not.toContain('Send /help for help information.');
  });

  it('renders ambient particle rails by default in safe terminals', () => {
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    try {
      const lines = new WelcomeComponent(appState).render(80);

      // Soft top rail + optional idle meteor dust under the banner.
      const joined = lines.map((line) => strip(line)).join('\n');
      expect(joined).toMatch(/[·∙•◦*]/);
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('keeps every line within the requested width on narrow terminals', () => {
    for (const width of [0, 1, 2, 4, 10, 39, 60, 80, 100, 120, 160]) {
      for (const line of new WelcomeComponent(appState).render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('stays frameless so bento chrome owns the borders', () => {
    const joined = strip(new WelcomeComponent(appState).render(80).join('\n'));
    expect(joined).not.toMatch(/[╭╮╰╯]/);
    expect(joined).toContain('Directory:');
  });
});

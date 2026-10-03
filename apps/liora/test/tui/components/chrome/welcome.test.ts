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
  setAppearanceTransportStability,
} from '#/tui/features/appearance/appearance-effects';

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
  isReplaying: false,
  streamingPhase: 'idle',
  streamingStartTime: 0,
  inputMode: 'prompt',
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  availableModels: {},
  availableProviders: {},
};

function ansiSequenceCount(text: string): number {
  return (text.match(ANSI_SGR) ?? []).length;
}

/** Banner lines inside the welcome box. */
function bannerOf(lines: string[]): string {
  return lines.slice(2, 8).join('\n');
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


  it('shows the model name with the current thinking effort', () => {
    setCliLocale('en');
    const output = strip(
      new WelcomeComponent({
        ...appState,
        thinking: true,
        thinkingLevel: 'high',
        availableModels: {
          'kimi-k2': {
            provider: 'managed:kimi-api',
            model: 'kimi-k2',
            maxContextSize: 200_000,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
          } as AppState['availableModels'][string],
        },
      }).render(80).join('\n'),
    );

    expect(output).toContain('Kimi K2 · high');
  });

  it('shows clamp arrow when wire effort differs from requested', () => {
    setCliLocale('en');
    const output = strip(
      new WelcomeComponent({
        ...appState,
        thinking: true,
        thinkingLevel: 'max',
        availableModels: {
          'kimi-k2': {
            provider: 'managed:kimi-api',
            model: 'kimi-k2',
            maxContextSize: 200_000,
            displayName: 'Kimi K2',
            capabilities: ['thinking'],
            supportEfforts: ['low', 'high', 'max'],
          } as AppState['availableModels'][string],
        },
      }).render(80).join('\n'),
    );

    expect(output).toContain('Kimi K2 · max→high');
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

  it('frames the hero in a rounded box that stays static when motion is off', () => {
    const off = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off' as const,
      particles: 'off' as const,
    };
    setActiveAppearancePreferences(off);
    const lines = new WelcomeComponent({ ...appState, appearance: off }).render(80);
    const top = strip(lines.find((line) => line.includes('╭')) ?? '');
    const bottom = strip(lines.find((line) => line.includes('╰')) ?? '');
    expect(top).toMatch(/^╭─+╮$/);
    expect(bottom).toMatch(/^╰─+╯$/);
    expect(visibleWidth(top)).toBe(80);
    expect(visibleWidth(bottom)).toBe(80);
  });

  it('moves the welcome frame colors across the shared animation clock', () => {
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
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });

    try {
      const welcome = new WelcomeComponent(appState);
      advanceAppearanceAnimationClock(1_000);
      const first = welcome.render(80).find((line) => line.includes('╭')) ?? '';
      advanceAppearanceAnimationClock(1_000 + 900);
      const second = welcome.render(80).find((line) => line.includes('╭')) ?? '';
      expect(strip(first)).toMatch(/^╭─+╮$/);
      expect(strip(second)).toMatch(/^╭─+╮$/);
      expect(first).not.toBe(second);
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('keeps the welcome frame moving on an unstable transport', () => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    setAppearanceTransportStability('unstable');
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
    });
    try {
      const welcome = new WelcomeComponent(appState);
      advanceAppearanceAnimationClock(1_000);
      const first = welcome.render(80).find((line) => line.includes('╭')) ?? '';
      advanceAppearanceAnimationClock(1_000 + 900);
      const second = welcome.render(80).find((line) => line.includes('╭')) ?? '';
      expect(first).not.toBe(second);
    } finally {
      setAppearanceTransportStability('synchronized');
    }
  });
});

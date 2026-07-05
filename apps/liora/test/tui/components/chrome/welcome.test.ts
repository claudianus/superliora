import { visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WelcomeComponent } from '#/tui/components/chrome/welcome';
import type { AppState } from '#/tui/types';

const TRUECOLOR_PATTERN = /\u001B\[38;2;(\d+);(\d+);(\d+)m/g;

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

function truecolorCodes(text: string): Set<string> {
  const codes = new Set<string>();
  for (const match of text.matchAll(TRUECOLOR_PATTERN)) {
    codes.add(`${match[1]},${match[2]},${match[3]}`);
  }
  return codes;
}

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

/** The first two banner rows inside the welcome box. */
function bannerHeaderOf(lines: string[]): string {
  return [lines[3], lines[4]].join('\n');
}

describe('WelcomeComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    vi.useRealTimers();
  });

  it('renders the banner in a single brand color by default', () => {
    const codes = truecolorCodes(bannerHeaderOf(new WelcomeComponent(appState).render(80)));

    // No rainbow by default — just the brand primary (plus the dim tagline).
    expect(codes.size).toBeLessThanOrEqual(2);
  });

  it('leads logged-in users to describe the task first', () => {
    const output = strip(new WelcomeComponent(appState).render(80).join('\n'));

    expect(output).toContain('____  ___');
    expect(output).toContain('Type normally, or press Shift-Tab to toggle Ultrawork/off.');
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

      expect(strip(lines[2] ?? '')).toMatch(/[·∙✧]/);
      expect(strip(lines.at(-3) ?? '')).toMatch(/[·∙✧]/);
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
});

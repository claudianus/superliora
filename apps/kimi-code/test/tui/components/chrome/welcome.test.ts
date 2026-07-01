import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  PREMIUM_MASCOT_FRAMES,
  renderKimiMascotIcon,
} from '#/tui/components/chrome/kimi-mascot-icon';
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

/** The two header rows (logo + title) of the rendered welcome box. */
function headerOf(lines: string[]): string {
  return [lines[3], lines[4]].join('\n');
}

describe('WelcomeComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
  });

  it('renders the banner in a single brand color by default', () => {
    const codes = truecolorCodes(headerOf(new WelcomeComponent(appState).render(80)));

    // No rainbow by default — just the brand primary (plus the dim tagline).
    expect(codes.size).toBeLessThanOrEqual(2);
  });

  it('leads logged-in users to describe the task first', () => {
    const output = strip(new WelcomeComponent(appState).render(80).join('\n'));

    expect(output).toContain('Welcome to Super Kimi Code!');
    expect(output).toContain(
      'Describe task; Ultrawork runs the full workflow, then verifies.',
    );
    expect(output).not.toContain('Ultrawork plans, sets goal, swarms, verifies.');
    expect(output).not.toContain('helpers');
    expect(output).not.toContain('Kimi checks readiness and verification.');
    expect(output).not.toContain('Send /help for help information.');
  });

  it('keeps every line within the requested width on narrow terminals', () => {
    for (const width of [0, 1, 2, 4, 10, 39, 60, 80, 100, 120, 160]) {
      for (const line of new WelcomeComponent(appState).render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('keeps every premium mascot animation frame at a fixed visible width', () => {
    const expectedWidth = visibleWidth(PREMIUM_MASCOT_FRAMES[0]![0]!);
    for (const frame of PREMIUM_MASCOT_FRAMES) {
      for (const line of frame) {
        expect(visibleWidth(line)).toBe(expectedWidth);
      }
    }
  });

  it('uses an ASCII mascot fallback in dumb terminals', () => {
    const previousTerm = process.env['TERM'];
    process.env['TERM'] = 'dumb';
    try {
      const rows = renderKimiMascotIcon({
        layout: 'standard',
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
      });

      expect(strip(rows.join('\n'))).toContain('/---\\');
    } finally {
      if (previousTerm === undefined) delete process.env['TERM'];
      else process.env['TERM'] = previousTerm;
    }
  });
});

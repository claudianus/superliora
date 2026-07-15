import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FooterComponent } from '#/tui/components/chrome/footer';
import { currentTheme, darkColors, lightColors } from '#/tui/theme';
import type { AppState } from '#/tui/types';

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

describe('FooterComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
  });

  it('renders the premium badge when premium quality mode is on', () => {
    const footer = new FooterComponent({ ...appState, premiumQualityMode: true });
    const rendered = footer.render(120).join('\n');
    expect(rendered).toContain('premium');
  });

  it('renders the model name in the footer', () => {
    const footer = new FooterComponent(appState);

    const rendered = footer.render(120).join('\n');

    expect(rendered).toContain('kimi-k2');
  });

  it('repaints from the active palette on the next render (no setColors needed)', () => {
    const footer = new FooterComponent(appState);
    const before = footer.render(120).join('\n');

    currentTheme.setPalette(lightColors);
    try {
      const after = footer.render(120).join('\n');
      // Reads currentTheme live, so a palette swap changes the emitted colours.
      expect(after).not.toBe(before);
    } finally {
      currentTheme.setPalette(darkColors);
    }
  });
});

  it('suggests media keys in the next-action line when no image/video key is set', () => {
    const previous = {
      OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
      GOOGLE_API_KEY: process.env['GOOGLE_API_KEY'],
      GEMINI_API_KEY: process.env['GEMINI_API_KEY'],
    };
    delete process.env['OPENAI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    try {
      const footer = new FooterComponent(appState);
      const rendered = footer.render(160).join('\n');
      expect(rendered).toMatch(/OPENAI_API_KEY|GOOGLE_API_KEY|image\/video|\/status/i);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('keeps the default Ultrawork next-action when media keys are already present', () => {
    const previous = process.env['OPENAI_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'test-key';
    try {
      const footer = new FooterComponent(appState);
      const rendered = footer.render(160).join('\n');
      expect(rendered).toMatch(/Ultrawork|\/status/i);
      expect(rendered).not.toMatch(/OPENAI_API_KEY or GOOGLE_API_KEY for image\/video/);
    } finally {
      if (previous === undefined) delete process.env['OPENAI_API_KEY'];
      else process.env['OPENAI_API_KEY'] = previous;
    }
  });


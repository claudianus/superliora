import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';

import type { ModelAlias } from '@superliora/sdk';

import { ModelSelectorComponent } from '#/tui/components/dialogs/model-selector';
import { TabbedModelSelectorComponent } from '#/tui/components/dialogs/tabbed-model-selector';
import type { RendererCell, RendererRegionLine } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';
import { buildTUIStateNativeFrameRegions } from '#/tui/utils/native-layout-frame';
import { advanceAppearanceAnimationClock } from '#/tui/utils/appearance-effects';
import { createTUIState } from '#/tui/tui-state';
import type { AppState } from '#/tui/types';

/** ESC-stripped SGR bodies (the modal garbage pattern). */
const LEAKED_SGR_BODY = /(?<!\u001B)\[[0-9;]*38;2/;

function fakeInitialAppState(): AppState {
  return {
    model: 'kimi',
    workDir: '/tmp/kimi-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    inputMode: 'prompt',
    swarmMode: false,
    thinking: true,
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isBackgroundCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: '0.0.0-test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    availableModels: {},
    availableProviders: {},
    sessionTitle: null,
    mcpServersSummary: null,
  };
}

function model(displayName: string, capabilities: string[] = ['thinking']): ModelAlias {
  return {
    provider: 'managed:kimi-api',
    model: displayName.toLowerCase().replaceAll(' ', '-'),
    maxContextSize: 200_000,
    displayName,
    capabilities,
  } as unknown as ModelAlias;
}

function regionPlainText(lines: readonly RendererRegionLine[]): string {
  return lines
    .map((line) => {
      if (typeof line === 'string') return line;
      return line.map((cell) => cell.char).join('');
    })
    .join('\n');
}

function assertNoLeakedSgr(lines: readonly RendererRegionLine[]): void {
  for (const line of lines) {
    if (typeof line === 'string') {
      expect(line).not.toMatch(LEAKED_SGR_BODY);
      expect(line).not.toMatch(/(?<!\u001B)\[0;1;38/);
      continue;
    }
    const joined = line.map((cell: RendererCell) => cell.char).join('');
    expect(joined).not.toMatch(LEAKED_SGR_BODY);
    expect(joined).not.toContain('38;2;');
    expect(joined).not.toMatch(/\[0;1;38/);
  }
}

describe('model selector native frame ANSI safety', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
    process.env['TERM'] = 'xterm-256color';
    delete process.env['NO_COLOR'];
    delete process.env['CI'];
    // Pin the shared appearance clock. With motion allowed (CI/NO_COLOR cleared
    // above), the premium headline sparkle replaces spaces in "Select a model"
    // with particle glyphs on wall-clock ticks, which used to flip these
    // assertions between runs. t=0 sits well inside a sparkle-free window.
    advanceAppearanceAnimationClock(0);
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
  });

  it('paints ModelSelector editor-replacement cells without leaked SGR bodies', () => {
    const width = 100;
    const height = 40;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });

    const selector = new ModelSelectorComponent({
      models: {
        kimi: model('Kimi K2.6'),
        mimo: model('MiMo V2 Pro'),
      },
      currentValue: 'kimi',
      currentThinking: true,
      currentEffort: 'high',
      searchable: true,
      providerSwitchHint: true,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    state.editorContainer.clear();
    state.editorContainer.addChild(selector);

    const regions = buildTUIStateNativeFrameRegions(state, width, height);
    const editor = regions.find((region) => region.id === 'editor');
    expect(editor).toBeDefined();
    expect(editor!.content.length).toBeGreaterThan(0);

    assertNoLeakedSgr(editor!.content);

    const plain = regionPlainText(editor!.content);
    expect(plain).toContain('Select a model');
    expect(plain).toContain('Kimi K2.6');
    expect(plain).toContain('Thinking');
  });

  it('paints TabbedModelSelector editor-replacement cells without leaked SGR bodies', () => {
    const width = 100;
    const height = 40;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });

    const selector = new TabbedModelSelectorComponent({
      models: {
        kimi: model('Kimi K2.6'),
        mimo: {
          ...model('MiMo V2 Pro'),
          provider: 'managed:mimo',
        } as ModelAlias,
      },
      currentValue: 'kimi',
      currentThinking: true,
      currentEffort: 'high',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    state.editorContainer.clear();
    state.editorContainer.addChild(selector);

    const regions = buildTUIStateNativeFrameRegions(state, width, height);
    const editor = regions.find((region) => region.id === 'editor');
    expect(editor).toBeDefined();
    assertNoLeakedSgr(editor!.content);

    const plain = regionPlainText(editor!.content);
    expect(plain).toContain('Select a model');
    expect(plain).toContain('Kimi K2.6');
  });

  it('ModelSelector.render keeps ESC on SGR and never emits stripped bodies', () => {
    const picker = new ModelSelectorComponent({
      models: { kimi: model('Kimi K2.6') },
      currentValue: 'kimi',
      currentThinking: true,
      searchable: true,
      providerSwitchHint: true,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const out = picker.render(120).join('\n');
    expect(out).toContain('\u001B[');
    expect(out).not.toMatch(LEAKED_SGR_BODY);
    const plain = out.replaceAll(/\u001B\[[0-9;]*m/g, '');
    expect(plain).toContain('Select a model');
    expect(plain).toContain('Kimi K2.6');
  });
});

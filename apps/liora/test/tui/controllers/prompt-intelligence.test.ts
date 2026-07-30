import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isExperimentalFlagEnabled,
  setExperimentalFeatures,
} from '#/tui/commands/experimental-flags';
import { PromptIntelligenceController } from '#/tui/controllers/prompt/prompt-intelligence';
import type { AppState } from '#/tui/types';
import type { TUIState } from '#/tui/tui-state';

function makeEditor() {
  let text = '';
  let ghost: string | undefined;
  let ghostKind: 'inline' | 'suggestion' = 'inline';
  let cursor = { line: 0, col: 0 };
  return {
    onAcceptGhost: undefined as (() => void) | undefined,
    onCycleGhost: undefined as ((direction: -1 | 1) => void) | undefined,
    onChange: undefined as ((text: string) => void) | undefined,
    getText: () => text,
    setText: (value: string) => {
      text = value;
      cursor = { line: 0, col: value.length };
    },
    getCursor: () => cursor,
    setCursor: (next: { line: number; col: number }) => {
      cursor = next;
    },
    isShowingAutocomplete: () => false,
    setGhostText: (value: string | undefined, kind: 'inline' | 'suggestion') => {
      ghost = value;
      ghostKind = kind;
    },
    getGhostText: () => ghost,
    getGhostKind: () => ghostKind,
  };
}

describe('PromptIntelligenceController', () => {
  beforeEach(() => {
    setExperimentalFeatures([{ id: 'prompt_intelligence', enabled: true }]);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setExperimentalFeatures([]);
  });

  function makeHost(overrides?: {
    inlineComplete?: (input: unknown) => Promise<{ completion: string; modelAlias?: string }>;
    suggestPrompts?: () => Promise<{ suggestions: string[]; modelAlias?: string }>;
  }) {
    const editor = makeEditor();
    const appState = {
      streamingPhase: 'idle',
      inputMode: 'prompt',
      model: 'main',
      availableModels: {},
      promptIntelligencePhase: 'idle',
    } as AppState;
    const setAppState = vi.fn((patch: Partial<AppState>) => {
      Object.assign(appState, patch);
    });
    const session = {
      inlineComplete:
        overrides?.inlineComplete ??
        vi.fn(async () => ({ completion: ' next words', modelAlias: 'cheap' })),
      suggestPrompts:
        overrides?.suggestPrompts ??
        vi.fn(async () => ({ suggestions: ['Write tests'], modelAlias: 'cheap' })),
    };
    const host = {
      state: {
        editor,
        appState,
      } as unknown as TUIState,
      session: session as never,
      track: vi.fn(),
      setAppState,
      showNotice: vi.fn(),
    };
    const controller = new PromptIntelligenceController(host);
    controller.install();
    return { controller, editor, host, session, setAppState, appState };
  }

  it('defaults prompt_intelligence on before harness snapshot', () => {
    setExperimentalFeatures([]);
    expect(isExperimentalFlagEnabled('prompt_intelligence')).toBe(true);
  });

  it('shows pending ghost then paints short completions', async () => {
    let resolveRequest!: (value: { completion: string; modelAlias?: string }) => void;
    const pending = new Promise<{ completion: string; modelAlias?: string }>((resolve) => {
      resolveRequest = resolve;
    });
    const inlineComplete = vi.fn(async () => pending);
    const { editor, session } = makeHost({ inlineComplete });

    editor.setText('please help me');
    editor.onChange?.(editor.getText());

    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    // pending placeholder while RPC is outstanding
    expect(editor.getGhostText()).toBe('…');
    expect(inlineComplete).toHaveBeenCalled();

    resolveRequest({ completion: ' fix', modelAlias: 'cheap' });
    await Promise.resolve();
    await Promise.resolve();

    expect(session.inlineComplete).toHaveBeenCalled();
    expect(editor.getGhostText()).toBe(' fix');
  });

  it('sets promptIntelligencePhase while inline request runs', async () => {
    let resolveRequest!: (value: { completion: string }) => void;
    const pending = new Promise<{ completion: string }>((resolve) => {
      resolveRequest = resolve;
    });
    const { editor, appState, setAppState } = makeHost({
      inlineComplete: vi.fn(async () => pending),
    });

    editor.setText('enough chars here');
    editor.onChange?.(editor.getText());
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    expect(appState.promptIntelligencePhase).toBe('inline');
    expect(setAppState).toHaveBeenCalledWith({ promptIntelligencePhase: 'inline' });

    resolveRequest({ completion: ' done' });
    await Promise.resolve();
    await Promise.resolve();

    expect(appState.promptIntelligencePhase).toBe('idle');
  });

  it('does not request when slash autocomplete owns the line', async () => {
    const { editor, session } = makeHost();
    editor.setText('/help me please');
    editor.onChange?.(editor.getText());
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(session.inlineComplete).not.toHaveBeenCalled();
  });
});

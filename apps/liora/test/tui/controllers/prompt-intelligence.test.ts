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

  it('ignores stale async completion when buffer text changed mid-flight', async () => {
    let resolveRequest!: (value: { completion: string }) => void;
    const pending = new Promise<{ completion: string }>((resolve) => {
      resolveRequest = resolve;
    });
    const setGhostText = vi.fn();
    const { editor } = makeHost({
      inlineComplete: vi.fn(async () => pending),
    });
    // Spy after install so we can assert post-race paints only.
    const originalSetGhost = editor.setGhostText.bind(editor);
    editor.setGhostText = (value, kind) => {
      setGhostText(value, kind);
      originalSetGhost(value, kind);
    };

    editor.setText('enough chars here');
    editor.onChange?.(editor.getText());
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(editor.getGhostText()).toBe('…');

    // User keeps typing while the RPC is outstanding.
    editor.setText('enough chars here and more');
    editor.onChange?.(editor.getText());

    resolveRequest({ completion: ' stale-completion' });
    await Promise.resolve();
    await Promise.resolve();

    // Stale completion must not repaint over the newer buffer.
    const paintsAfterStale = setGhostText.mock.calls.filter(
      ([value]) => value === ' stale-completion' || value === 'stale-completion',
    );
    expect(paintsAfterStale).toHaveLength(0);
    expect(editor.getGhostText()).not.toBe(' stale-completion');
  });

  it('ignores stale async completion when only the cursor moved', async () => {
    let resolveRequest!: (value: { completion: string }) => void;
    const pending = new Promise<{ completion: string }>((resolve) => {
      resolveRequest = resolve;
    });
    const { editor } = makeHost({
      inlineComplete: vi.fn(async () => pending),
    });

    const text = 'enough chars here';
    editor.setText(text);
    editor.onChange?.(editor.getText());
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    expect(editor.getGhostText()).toBe('…');

    // Cursor retreats into the committed buffer; text is unchanged so getText()
    // alone would pass the old guard and paint ghost over real characters.
    editor.setCursor({ line: 0, col: 4 });
    // Cursor-only moves do not fire onChange — this is the race under test.

    resolveRequest({ completion: ' next words' });
    await Promise.resolve();
    await Promise.resolve();

    expect(editor.getGhostText()).not.toBe(' next words');
    // Pending placeholder from the aborted generation must not stick either once
    // the result is rejected; leave editor free of a misleading suffix paint.
    expect(editor.getGhostText() === '…' || editor.getGhostText() === undefined).toBe(true);
  });

  it('cache hit does not paint ghost when prefix no longer matches current buffer', async () => {
    const inlineComplete = vi.fn(async () => ({ completion: ' cached-tail' }));
    const { editor } = makeHost({ inlineComplete });
    const setGhostText = vi.fn();
    const originalSetGhost = editor.setGhostText.bind(editor);
    editor.setGhostText = (value, kind) => {
      setGhostText(value, kind);
      originalSetGhost(value, kind);
    };

    // Prime the LRU with a successful completion for this prefix.
    editor.setText('enough chars here');
    editor.onChange?.(editor.getText());
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.getGhostText()).toBe(' cached-tail');
    expect(inlineComplete).toHaveBeenCalledTimes(1);
    setGhostText.mockClear();

    // Keystroke clears ghost on the real editor; simulate that here.
    editor.setText('enough chars here');
    editor.setGhostText(undefined, 'inline');
    setGhostText.mockClear();
    editor.onChange?.(editor.getText());
    // Advance just under debounce so we can move the caret before the cache path.
    await vi.advanceTimersByTimeAsync(449);
    // Caret retreats into committed text — real editor also clears ghost on move.
    editor.setCursor({ line: 0, col: 3 });
    editor.setGhostText(undefined, 'inline');
    setGhostText.mockClear();
    await vi.advanceTimersByTimeAsync(2);
    await Promise.resolve();
    await Promise.resolve();

    // Mid-buffer caret: cache hit must not call setGhostText with the old suffix.
    const cachePaints = setGhostText.mock.calls.filter(
      ([value]) => value === ' cached-tail' || value === 'cached-tail',
    );
    expect(cachePaints).toHaveLength(0);
    expect(editor.getGhostText()).not.toBe(' cached-tail');
    // No new RPC either — budget/cache path exits without network.
    expect(inlineComplete).toHaveBeenCalledTimes(1);
  });

  it('reuses cache only when live prefix and caret still match', async () => {
    const inlineComplete = vi.fn(async () => ({ completion: ' cached-tail' }));
    const { editor } = makeHost({ inlineComplete });

    editor.setText('enough chars here');
    editor.onChange?.(editor.getText());
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.getGhostText()).toBe(' cached-tail');
    expect(inlineComplete).toHaveBeenCalledTimes(1);

    // Keystroke clears ghost (editor side); restore same prefix at end caret.
    editor.setText('enough chars here!');
    editor.onChange?.(editor.getText());
    editor.setText('enough chars here');
    editor.onChange?.(editor.getText());
    await vi.advanceTimersByTimeAsync(500);
    await Promise.resolve();

    expect(editor.getGhostText()).toBe(' cached-tail');
    // Second paint must come from cache, not another RPC.
    expect(inlineComplete).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { encodeNativeInputAsLegacySequence, type NativeInputEvent } from '#/tui/renderer';
import type { AppState } from '#/tui/types';
import { createTUIState } from '#/tui/tui-state';
import { createTUIStateNativeInputRouter } from '#/tui/features/native-layout/native-input-router';

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/liora-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    askMode: false,
    inputMode: 'prompt',
    thinking: false,
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

function createState() {
  return createTUIState({
    initialAppState: fakeInitialAppState(),
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
  });
}

function withPreHandler(state: ReturnType<typeof createState>) {
  return createTUIStateNativeInputRouter(state, {
    requestRender: false,
    handlePreEditorInput: (event) => {
      if (event.type !== 'key' || event.eventType === 'release') return false;
      const legacy = encodeNativeInputAsLegacySequence(event);
      if (legacy === undefined) return false;
      return state.editor.tryHandleAppShortcut?.(legacy) === true;
    },
  });
}

describe('app shortcut pre-handler (native path)', () => {
  it('opens Command Hub on ? when the editor is empty', () => {
    const state = createState();
    const openHub = vi.fn();
    state.editor.onCommandHub = openHub;
    const router = withPreHandler(state);

    const event: NativeInputEvent = {
      type: 'key',
      key: 'character',
      raw: '?',
      text: '?',
      ctrl: false,
      alt: false,
      shift: false,
    };
    expect(router.dispatch(event).handled).toBe(true);
    expect(openHub).toHaveBeenCalledOnce();
    expect(state.editor.getText()).toBe('');
    router.dispose();
  });

  it('inserts ? when the editor is non-empty', () => {
    const state = createState();
    state.editor.setText('hello');
    const openHub = vi.fn();
    state.editor.onCommandHub = openHub;
    const router = withPreHandler(state);

    const event: NativeInputEvent = {
      type: 'key',
      key: 'character',
      raw: '?',
      text: '?',
      ctrl: false,
      alt: false,
      shift: false,
    };
    router.dispatch(event);
    expect(openHub).not.toHaveBeenCalled();
    expect(state.editor.getText()).toContain('?');
    router.dispose();
  });

  it('opens Command Hub on Ctrl-K via pre-handler', () => {
    const state = createState();
    const openHub = vi.fn();
    state.editor.onCommandHub = openHub;
    const router = withPreHandler(state);

    const event: NativeInputEvent = {
      type: 'key',
      key: 'character',
      raw: '\u000B',
      text: 'k',
      ctrl: true,
      alt: false,
      shift: false,
    };
    router.dispatch(event);
    expect(openHub).toHaveBeenCalledOnce();
    router.dispose();
  });

  it('opens Job Deck on Alt+J via tryHandleAppShortcut (Kitty ESC+j)', () => {
    const state = createState();
    const openDeck = vi.fn();
    state.editor.onOpenJobDeck = openDeck;
    const legacy = encodeNativeInputAsLegacySequence({
      type: 'key',
      key: 'character',
      raw: '\u001bj',
      text: 'j',
      ctrl: false,
      alt: true,
      shift: false,
    });
    expect(legacy).toBeDefined();
    expect(state.editor.tryHandleAppShortcut?.(legacy!)).toBe(true);
    expect(openDeck).toHaveBeenCalledOnce();
  });

  it('opens Job Inbox on Alt+I via tryHandleAppShortcut (Kitty ESC+i)', () => {
    const state = createState();
    const openInbox = vi.fn();
    state.editor.onOpenJobInbox = openInbox;
    const legacy = encodeNativeInputAsLegacySequence({
      type: 'key',
      key: 'character',
      raw: '\u001bi',
      text: 'i',
      ctrl: false,
      alt: true,
      shift: false,
    });
    expect(legacy).toBeDefined();
    expect(state.editor.tryHandleAppShortcut?.(legacy!)).toBe(true);
    expect(openInbox).toHaveBeenCalledOnce();
  });

  it('does not treat Ctrl-Y as an app retry shortcut', () => {
    const state = createState();
    const legacy = encodeNativeInputAsLegacySequence({
      type: 'key',
      key: 'character',
      raw: '\u0019',
      text: 'y',
      ctrl: true,
      alt: false,
      shift: false,
    });
    expect(legacy).toBeDefined();
    expect(state.editor.tryHandleAppShortcut?.(legacy!)).toBe(false);
  });

  it('toggles tool output expansion on Ctrl-O', () => {
    const state = createState();
    const toggle = vi.fn();
    state.editor.onToggleToolExpand = toggle;
    const legacy = encodeNativeInputAsLegacySequence({
      type: 'key',
      key: 'character',
      raw: '\u000F',
      text: 'o',
      ctrl: true,
      alt: false,
      shift: false,
    });
    expect(legacy).toBeDefined();
    expect(state.editor.tryHandleAppShortcut?.(legacy!)).toBe(true);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('expands the todo panel on Ctrl-T only while it overflows', () => {
    const state = createState();
    const toggle = vi.fn().mockReturnValue(true);
    state.editor.onToggleTodoExpand = toggle;
    const legacy = encodeNativeInputAsLegacySequence({
      type: 'key',
      key: 'character',
      raw: '\u0014',
      text: 't',
      ctrl: true,
      alt: false,
      shift: false,
    });
    expect(legacy).toBeDefined();
    expect(state.editor.tryHandleAppShortcut?.(legacy!)).toBe(true);
    toggle.mockReturnValue(false);
    expect(state.editor.tryHandleAppShortcut?.(legacy!)).toBe(false);
    expect(toggle).toHaveBeenCalledTimes(2);
  });
});

describe('OS primary-modifier app shortcuts', () => {
  const kittySuper = (code: number) => `\u001B[${code};9u`;

  function bindAppChords(state: ReturnType<typeof createState>) {
    const copySelectedTranscript = vi.fn();
    const showCommandHub = vi.fn();
    const pasteMedia = vi.fn();
    state.editor.onCtrlC = copySelectedTranscript;
    state.editor.onCommandHub = showCommandHub;
    state.editor.onPasteMedia = pasteMedia;
    return { state, copySelectedTranscript, showCommandHub, pasteMedia };
  }

  it.each(['darwin', 'linux', 'win32'] as const)(
    'accepts Ctrl chords on %s',
    (platform) => {
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: platform });
      try {
        const { state, showCommandHub, copySelectedTranscript } = bindAppChords(createState());
        expect(state.editor.tryHandleAppShortcut?.('\u0003')).toBe(true);
        expect(copySelectedTranscript).toHaveBeenCalledTimes(1);
        expect(state.editor.tryHandleAppShortcut?.('\u000B')).toBe(true);
        expect(showCommandHub).toHaveBeenCalledTimes(1);
        expect(state.editor.tryHandleAppShortcut?.('\u0016')).toBe(true);
      } finally {
        Object.defineProperty(process, 'platform', { value: original });
      }
    },
  );

  it('accepts Cmd/Super chords on darwin and ignores Super on linux/win32', () => {
    const original = process.platform;
    try {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const darwin = bindAppChords(createState());
      expect(darwin.state.editor.tryHandleAppShortcut?.(kittySuper(99))).toBe(true);
      expect(darwin.copySelectedTranscript).toHaveBeenCalledTimes(1);
      expect(darwin.state.editor.tryHandleAppShortcut?.(kittySuper(107))).toBe(true);
      expect(darwin.showCommandHub).toHaveBeenCalledTimes(1);
      expect(darwin.state.editor.tryHandleAppShortcut?.(kittySuper(118))).toBe(true);

      Object.defineProperty(process, 'platform', { value: 'linux' });
      const linux = bindAppChords(createState());
      expect(linux.state.editor.tryHandleAppShortcut?.(kittySuper(99))).toBe(false);
      expect(linux.copySelectedTranscript).not.toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: 'win32' });
      const win = bindAppChords(createState());
      expect(win.state.editor.tryHandleAppShortcut?.(kittySuper(118))).toBe(false);
      // Windows image-paste Alt+V stays; Super+V is not a Windows scheme.
      expect(win.state.editor.tryHandleAppShortcut?.('\u001Bv')).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
  });
});

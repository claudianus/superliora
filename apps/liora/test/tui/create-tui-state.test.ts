import { EventEmitter } from 'node:events';

import { afterEach, describe, it, expect, vi } from 'vitest';
import chalk from 'chalk';

import { createTUIState, type LioraTUIOptions } from '#/tui/liora-tui';
import { NoticeMessageComponent } from '#/tui/components/messages/status-message';
import { ThinkingComponent } from '#/tui/components/messages/thinking';
import { ToolCallComponent } from '#/tui/components/messages/tool-call';
import { UserMessageComponent } from '#/tui/components/messages/user-message';
import { NativeTUIEditor } from '#/tui/components/editor/native-tui-editor';
import {
  ANSI_ENABLE_BRACKETED_PASTE,
  ANSI_ENABLE_FOCUS_EVENTS,
  ANSI_ENABLE_MOUSE_TRACKING,
  ANSI_ENABLE_SGR_MOUSE_MODE,
  ANSI_HIDE_CURSOR,
  ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT,
  ANSI_SHOW_CURSOR,
  ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL,
  CURSOR_MARKER,
  encodeTerminalClearBelowRow,
  type AutocompleteItem,
  type AutocompleteProvider,
  type Component,
  diagnoseNativeRendererStats,
  NativeFrameStats,
  type NativeInputEvent,
  type NativeRenderLoopScheduler,
  type NativeRenderTimer,
  type NativeTerminalInput,
  type NativeTerminalRendererFrameMetrics,
  type RendererTerminalHost,
} from '#/tui/renderer';
import type { AppState } from '#/tui/types';
import { currentTheme } from '#/tui/theme';
import {
  buildTUIStateNativeFrameRegions,
  createTUIStateNativeRenderer,
  createTUIStateVisibleNativeRenderer,
  detectTUIStateNativeLayoutShift,
  resolveTUIStateNativeFramePolicy,
  renderTUIStateNativeFrame,
  shouldForceTUIStateNativeLayoutFrame,
  shouldRefreshNativeTerminalPalette,
} from '#/tui/utils/native-layout-frame';
import { renderNativeLayoutFrame } from '#/tui/renderer';
import {
  createNativeEditorTextInput,
  handleNativeEditorKeyInput,
  handleNativeEditorMouseInput,
  nativeEditorAtomicRangesForText,
} from '#/tui/utils/native-editor-text-input';
import { createTUIStateNativeInputRouter } from '#/tui/utils/native-input-router';
import {
  advanceAppearanceAnimationClock,
  appearanceAnimationNow,
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_SGR, '');
}

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/kimi-test',
    additionalDirs: [],
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    inputMode: 'prompt',
    swarmMode: false,
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

async function flushAutocomplete(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

function providerReturning(items: AutocompleteItem[]): AutocompleteProvider {
  return {
    getSuggestions: vi.fn(async () => ({ items, prefix: '/' })),
    applyCompletion: vi.fn((lines, cursorLine, cursorCol, item, prefix) => {
      const line = lines[cursorLine] ?? '';
      const beforePrefix = line.slice(0, cursorCol - prefix.length);
      const afterCursor = line.slice(cursorCol);
      const next = `${beforePrefix}/${item.value} ${afterCursor}`;
      return { lines: [next], cursorLine, cursorCol: beforePrefix.length + item.value.length + 2 };
    }),
  };
}

function filteringAutocompleteProvider(items: AutocompleteItem[]): AutocompleteProvider {
  return {
    getSuggestions: async (lines, cursorLine, cursorCol) => {
      const line = lines[cursorLine] ?? '';
      const beforeCursor = line.slice(0, cursorCol);
      const match = /\/(\S*)$/.exec(beforeCursor);
      if (match === null) return null;
      const query = match[1] ?? '';
      const filtered = items.filter((item) => item.value.startsWith(query));
      if (filtered.length === 0) return null;
      return { items: filtered, prefix: `/${query}` };
    },
    applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => {
      const line = lines[cursorLine] ?? '';
      const beforePrefix = line.slice(0, cursorCol - prefix.length);
      const afterCursor = line.slice(cursorCol);
      const next = `${beforePrefix}/${item.value} ${afterCursor}`;
      return { lines: [next], cursorLine, cursorCol: beforePrefix.length + item.value.length + 2 };
    },
  };
}

function frameText(frame: { renderer: { frame: { width: number; height: number; getCell(x: number, y: number): { char: string } } } }): string {
  const { width, height } = frame.renderer.frame;
  return Array.from({ length: height }, (_, y) => rowText(frame.renderer.frame, y)).join('\n');
}

describe('createTUIState', () => {
  it('initializes all fields with sensible defaults', () => {
    const opts: LioraTUIOptions = {
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    };
    const state = createTUIState(opts);

    // UI objects are created.
    expect(state.ui).toBeDefined();
    expect(state.terminal).toBeDefined();
    expect(state.renderer.ui).toBe(state.ui);
    expect(state.renderer.terminal).toBe(state.terminal);
    expect(state.transcriptViewport.followOutput).toBe(true);
    expect(state.transcriptContainer).toBeDefined();
    expect(state.activityContainer).toBeDefined();
    expect(state.todoPanelContainer).toBeDefined();
    expect(state.queueContainer).toBeDefined();
    expect(state.editorContainer).toBeDefined();
    expect(state.footerContainer).toBeDefined();
    expect(state.footerContainer.children).toHaveLength(0);
    expect(state.editor).toBeDefined();
    expect(state.footer).toBeDefined();
    expect(state.todoPanel).toBeDefined();
    expect(state.theme.palette).toBeDefined();

    // App state is cloned from initialAppState, not reused by reference.
    expect(state.appState).not.toBe(opts.initialAppState);
    expect(state.appState.model).toBe('test-model');
    expect(state.appState.additionalDirs).toEqual([]);
    expect(state.appState.sessionId).toBe('sess-1');
    expect(state.startupState).toBe('pending');

    // LivePane defaults.
    expect(state.livePane.mode).toBe('idle');
    expect(state.livePane.pendingApproval).toBeNull();
    expect(state.livePane.pendingQuestion).toBeNull();

    // Empty collections.
    expect(state.transcriptEntries).toHaveLength(0);
    expect(state.queuedMessages).toHaveLength(0);

    // Boolean, counter, and optional-field defaults.
    expect(state.toolOutputExpanded).toBe(false);
    expect(state.activeDialog).toBeNull();
    expect(state.externalEditorRunning).toBe(false);
    expect(state.loadingSessions).toBe(false);
    expect(state.sessionsScope).toBe('cwd');
    expect(state.activitySpinner).toBeNull();
  });

  it('can mount the renderer-native editor backend behind the shared editor contract', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });

    expect(state.editor).toBeInstanceOf(NativeTUIEditor);
    state.editor.handleInput('x');
    expect(state.editor.getText()).toBe('x');
  });

  it('composes renderer-native editor autocomplete below the native editor frame', async () => {
    vi.useFakeTimers();
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 6 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 24 });
    // Rebuild editor with zero debounce so autocomplete opens deterministically in tests.
    state.editor = new NativeTUIEditor({ requestRender: () => {}, autocompleteDebounceMs: 0 });
    state.editor.setAutocompleteProvider(providerReturning([
      { value: 'help', label: 'help', description: 'Show help' },
    ]));
    state.editorContainer.addChild(state.editor);

    state.editor.handleInput('/');
    await vi.runAllTimersAsync();
    await flushAutocomplete();
    const frame = renderTUIStateNativeFrame(state);

    expect(state.editor.isShowingAutocomplete()).toBe(true);
    // Editor region is bottom-stacked in a 6-row frame: top border, input,
    // selected suggestion, bottom border (no blank spacer row).
    expect(rowText(frame.renderer.frame, 4)).toContain('❯ help');
    expect(rowText(frame.renderer.frame, 4)).toContain('Show help');
    expect(rowText(frame.renderer.frame, 5)).toBe('╰──────────────────────╯');

    const editorRegion = frame.regions.find((region) => region.id === 'editor');
    const plainLines = (editorRegion?.lines ?? []).map((line) =>
      typeof line === 'string' ? line : line.map((cell) => cell.char).join(''),
    );
    expect(plainLines.filter((line) => line.includes('╰'))).toHaveLength(1);
    expect(plainLines.at(-1)).toBe('╰──────────────────────╯');
  });

  it('keeps incremental native frames free of stale ghost cells while typing with autocomplete open', async () => {
    const width = 30;
    const height = 12;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
    state.editor.setAutocompleteProvider(filteringAutocompleteProvider([
      { value: 'thinking', label: 'thinking', description: 'Set thinking effort for the session' },
      { value: 'tasks', label: 'tasks', description: 'Browse background tasks' },
      { value: 'test', label: 'test', description: 'Some other command' },
    ]));
    state.editorContainer.addChild(state.editor);

    let renderer: import('#/tui/renderer').NativeFrameRenderer | undefined;
    for (const char of ['/', 't', 'e', 's', 't']) {
      state.editor.handleInput(char);
      await flushAutocomplete();
      // Incremental frame: reuses the renderer + composition caches across keystrokes,
      // exactly like the live app does.
      const incremental = renderTUIStateNativeFrame(state, { renderer });
      renderer = incremental.renderer;
      // Authoritative frame: a brand-new renderer with no caches, forced full redraw.
      const authoritative = renderTUIStateNativeFrame(state, { force: true });

      expect(frameText(incremental)).toBe(frameText(authoritative));
    }
  });

  it('keeps incremental native frames consistent after transcript viewport scroll', () => {
    const width = 40;
    const height = 16;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
    state.transcriptContainer.addChild(
      fixedLines(
        Array.from(
          { length: 40 },
          (_, index) => `transcript-line-${String(index).padStart(2, '0')}`,
        ),
      ),
    );
    state.editorContainer.addChild(state.editor);
    state.footerContainer.addChild(fixedLines(['footer']));

    let renderer = renderTUIStateNativeFrame(state, { force: true }).renderer;
    for (let step = 0; step < 6; step++) {
      state.transcriptViewport.scroll('line-up');
      const incremental = renderTUIStateNativeFrame(state, { renderer });
      renderer = incremental.renderer;
      const authoritative = renderTUIStateNativeFrame(state, { force: true });
      expect(frameText(incremental)).toBe(frameText(authoritative));
    }
  });

  it('detects transcript content growth without viewport scroll as a layout shift', () => {
    const width = 80;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    state.editorContainer.addChild(state.editor);

    let tracking = {};
    const first = detectTUIStateNativeLayoutShift(state, width, tracking);
    expect(first.shifted).toBe(false);
    expect(first.viewportScrolled).toBe(false);
    expect(first.structuralShift).toBe(false);

    state.transcriptContainer.addChild(
      new NoticeMessageComponent(
        'Ultrawork mode: ON',
        'Shift-Tab routes the next task through UltraPlan before any UltraGoal or Swarm work.',
      ),
    );
    const second = detectTUIStateNativeLayoutShift(state, width, first.next);
    expect(second.shifted).toBe(true);
    expect(second.viewportScrolled).toBe(false);
    expect(second.structuralShift).toBe(true);
    expect(shouldForceTUIStateNativeLayoutFrame(['request'], second.structuralShift)).toBe(true);
  });

  it('detects viewport scroll without structural layout shift', () => {
    const width = 80;
    const height = 24;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
    state.transcriptContainer.addChild(
      fixedLines(
        Array.from({ length: 40 }, (_, index) => `transcript-line-${String(index).padStart(2, '0')}`),
      ),
    );
    state.editorContainer.addChild(state.editor);

    const first = detectTUIStateNativeLayoutShift(state, width, {});
    renderTUIStateNativeFrame(state, { force: true, width, height });
    state.transcriptViewport.scroll('line-up');
    const second = detectTUIStateNativeLayoutShift(state, width, first.next);

    expect(second.viewportScrolled).toBe(true);
    expect(second.structuralShift).toBe(false);
    expect(
      shouldForceTUIStateNativeLayoutFrame(['transcript-scroll'], second.structuralShift, {
        viewportScrolled: second.viewportScrolled,
      }),
    ).toBe(false);
  });

  it('keeps incremental native frames consistent after spamming transcript notices', () => {
    const width = 80;
    const height = 30;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
    state.transcriptContainer.addChild(fixedLines(['seed line']));
    state.editorContainer.addChild(state.editor);
    state.footerContainer.addChild(fixedLines(['footer']));

    let renderer = renderTUIStateNativeFrame(state, { force: true, width, height }).renderer;
    for (let i = 0; i < 12; i++) {
      state.transcriptContainer.addChild(
        new NoticeMessageComponent(
          i % 2 === 0 ? 'Ultrawork mode: ON' : 'Ultrawork mode: OFF',
          i % 2 === 0
            ? 'Shift-Tab routes the next task through UltraPlan before any UltraGoal or Swarm work.'
            : undefined,
        ),
      );
      const incremental = renderTUIStateNativeFrame(state, { renderer, width, height });
      renderer = incremental.renderer;
      const authoritative = renderTUIStateNativeFrame(state, { force: true, width, height });
      expect(frameText(incremental)).toBe(frameText(authoritative));
    }
  });

  it('preserves transcript foreground colors across animation and layout-shift frames', () => {
    const envKeys = ['CI', 'NO_COLOR'] as const;
    const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    const previousChalkLevel = chalk.level;
    chalk.level = 3;
    for (const key of envKeys) delete process.env[key];
    try {
    const width = 80;
    const height = 24;
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => height });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => width });
    currentTheme.setCanvasBackgroundEnabled(true);
    state.transcriptContainer.addChild(new UserMessageComponent('start work now'));
    state.transcriptContainer.addChild(new ThinkingComponent('researching game frameworks', true, 'live'));
    state.transcriptContainer.addChild(
      new ToolCallComponent({
        id: 'call_websearch',
        name: 'WebSearch',
        args: { query: 'Phaser 3 browser game' },
      }, undefined),
    );
    state.editorContainer.addChild(state.editor);
    state.footerContainer.addChild(fixedLines(['footer']));

    const hasColorOutput = (output: string) => /\u001B\[[0-9;]*m/.test(output);

    const initial = renderTUIStateNativeFrame(state, { width, height, force: true });
    expect(hasColorOutput(initial.output)).toBe(true);
    expect(countVisibleTranscriptCellsWithForeground(initial.renderer.frame)).toBeGreaterThan(0);

    const animationPolicy = resolveTUIStateNativeFramePolicy({
      causes: ['animation'],
      viewportScrolled: false,
      structuralShift: false,
      nextTranscriptStart: state.transcriptViewport.start(),
      ambientAnimationAllowed: true,
    });
    expect(animationPolicy.refreshTerminalPalette).toBe(true);

    advanceAppearanceAnimationClock(appearanceAnimationNow() + 120);
    const animated = renderTUIStateNativeFrame(state, {
      renderer: initial.renderer,
      width,
      height,
      force: animationPolicy.force,
    });
    expect(hasColorOutput(animated.output)).toBe(true);
    expect(countVisibleTranscriptCellsWithForeground(animated.renderer.frame)).toBeGreaterThan(0);

    state.transcriptContainer.addChild(
      new NoticeMessageComponent('Ultrawork mode: ON', 'Shift-Tab routes the next task.'),
    );
    const grown = renderTUIStateNativeFrame(state, {
      renderer: animated.renderer,
      width,
      height,
      force: true,
    });
    expect(hasColorOutput(grown.output)).toBe(true);
    expect(countVisibleTranscriptCellsWithForeground(grown.renderer.frame)).toBeGreaterThan(0);

    const incremental = renderTUIStateNativeFrame(state, {
      renderer: grown.renderer,
      width,
      height,
    });
    expect(countVisibleTranscriptCellsWithForeground(incremental.renderer.frame)).toBeGreaterThan(0);
    } finally {
      chalk.level = previousChalkLevel;
      for (const key of envKeys) {
        const value = saved[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('forces native redraws on ambient animation frames', () => {
    expect(
      shouldForceTUIStateNativeLayoutFrame(['animation'], false, { ambientAnimation: true }),
    ).toBe(true);
    expect(
      shouldForceTUIStateNativeLayoutFrame(['animation'], false, { ambientAnimation: false }),
    ).toBe(false);
  });

  it('refreshes terminal palette after transcript layout shifts', () => {
    expect(shouldRefreshNativeTerminalPalette(['request'], true)).toBe(true);
    expect(shouldRefreshNativeTerminalPalette(['animation'], false)).toBe(false);
    expect(shouldRefreshNativeTerminalPalette(['manual'], false)).toBe(true);
  });

  it('renders footer history badge from the transcript viewport state', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });

    state.transcriptViewport.sync(100, 10);
    state.transcriptViewport.scroll('line-up');

    expect(stripAnsi(state.footer.render(140)[0] ?? '')).toContain('[history +3 rows]');

    state.transcriptViewport.scroll('bottom');

    expect(stripAnsi(state.footer.render(140)[0] ?? '')).not.toContain('[history');
  });

  it('can render current renderer containers through the native layout adapter', () => {
    const opts: LioraTUIOptions = {
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    };
    const state = createTUIState(opts);
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 4 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 8 });
    state.transcriptContainer.addChild(fixedLines(['t1', 't2', 't3']));
    state.editorContainer.addChild(fixedLines(['ed']));
    state.footerContainer.addChild(fixedLines(['ft']));
    const writes: string[] = [];

    const first = renderTUIStateNativeFrame(state, {
      output: { write: (chunk) => writes.push(chunk) },
    });
    const second = renderTUIStateNativeFrame(state, { renderer: first.renderer });

    expect(first.width).toBe(8);
    expect(first.height).toBe(4);
    expect(first.regions.map((region) => region.id)).toEqual(['transcript', 'editor', 'footer']);
    expect(rowText(first.renderer.frame, 0).trim()).toBe('t2    │');
    expect(rowText(first.renderer.frame, 1).trim()).toBe('t3    █');
    expect(rowText(first.renderer.frame, 2).trim()).toBe('ed');
    expect(rowText(first.renderer.frame, 3).trim()).toBe('ft');
    expect(first.cursor).toEqual({ x: 0, y: 0, visible: false });
    expect(writes).toHaveLength(1);
    expect(second.output).toBe('');
  });

  it('projects focused cursor markers into native cursor state', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 3 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 8 });
    state.editorContainer.addChild(fixedLines([`ab${CURSOR_MARKER}\u001B[7mc\u001B[0md`]));

    const first = renderTUIStateNativeFrame(state);

    expect(first.cursor).toEqual({ x: 3, y: 2, visible: true });
    expect(rowText(first.renderer.frame, 2).slice(1, 5)).toBe('abcd');
    expect(first.renderer.frame.getCell(3, 2).style?.inverse).toBeUndefined();
    expect(first.output).toContain(ANSI_SHOW_CURSOR);
  });

  it('renders the mounted app editor through the renderer-native text input model', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 6 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 14 });
    state.editor.setText('hello');
    state.editorContainer.addChild(state.editor);

    const first = renderTUIStateNativeFrame(state);

    expect(first.regions.map((region) => region.id)).toEqual(['transcript', 'editor']);
    expect(rowText(first.renderer.frame, 3)).toBe('╭────────────╮');
    expect(rowText(first.renderer.frame, 4)).toBe('│ > hello    │');
    expect(rowText(first.renderer.frame, 5)).toBe('╰────────────╯');
    expect(first.renderer.frame.getCell(12, 4).char).toBe(' ');
    expect(first.cursor).toMatchObject({ x: 9, y: 4, visible: true, shape: 'bar' });
    expect(first.renderer.frame.getCell(0, 3).style?.fg).toBe(state.theme.palette.border);
  });
  it('paints root-level fullscreen takeover children instead of chrome layout', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 8 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 20 });
    // Mount normal chrome first, then replace the root tree the same way splash does.
    state.ui.addChild(state.transcriptContainer);
    state.ui.addChild(state.editorContainer);
    state.editorContainer.addChild(state.editor);
    state.ui.clear();
    state.ui.addChild({
      render(width: number): string[] {
        return Array.from({ length: 8 }, (_, row) =>
          `SPLASH-${String(row)}`.padEnd(width, ' ').slice(0, width),
        );
      },
      invalidate(): void {},
    } satisfies Component);

    const regions = buildTUIStateNativeFrameRegions(state, 20, 8);
    expect(regions.map((region) => region.id)).toEqual(['fullscreen-takeover']);
    const frame = renderTUIStateNativeFrame(state, { width: 20, height: 8 });
    expect(rowText(frame.renderer.frame, 0)).toContain('SPLASH-0');
    expect(rowText(frame.renderer.frame, 3)).toContain('SPLASH-3');
    expect(rowText(frame.renderer.frame, 7)).toContain('SPLASH-7');
  });

  it('attaches adaptive renderer VFX to highlighted native editor regions', () => {
    withMotionEffectsAllowedEnv(() => {
      const state = createTUIState({
        initialAppState: fakeInitialAppState(),
        startup: {
          continueLast: false,
          yolo: false,
          auto: false,
          plan: false,
        },
      });
      state.editor.borderHighlighted = true;
      state.editorContainer.addChild(state.editor);
      advanceAppearanceAnimationClock(450);
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');

      const regions = buildTUIStateNativeFrameRegions(state, 14, 6);
      const editor = regions.find((region) => region.id === 'editor');

      expect(editor?.vfx).toMatchObject({
        effect: {
          kind: 'pulse',
          nowMs: 450,
          color: state.theme.palette.primary,
        },
      });
    });
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('uses a brighter loading-shimmer VFX on the editor border in Ultrawork mode', () => {
    withMotionEffectsAllowedEnv(() => {
      const state = createTUIState({
        initialAppState: {
          ...fakeInitialAppState(),
          ultraworkMode: true,
        },
        startup: {
          continueLast: false,
          yolo: false,
          auto: false,
          plan: false,
        },
      });
      state.editor.borderHighlighted = true;
      state.editorContainer.addChild(state.editor);
      advanceAppearanceAnimationClock(450);
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');

      const regions = buildTUIStateNativeFrameRegions(state, 14, 6);
      const editor = regions.find((region) => region.id === 'editor');

      expect(editor?.vfx).toMatchObject({
        effect: {
          kind: 'shimmer',
          nowMs: 450,
          seed: 'native-editor-ultrawork',
        },
      });
      // Perimeter paint should tint at least one border cell away from static border.
      const lines = Array.isArray(editor?.content) ? editor.content : [];
      const cells = lines.flatMap((line) => (typeof line === 'string' ? [] : [...line]));
      const borderCells = cells.filter((cell) => '╭╮╰╯│─'.includes(cell.char));
      expect(borderCells.length).toBeGreaterThan(0);
      expect(
        borderCells.some(
          (cell) =>
            (cell.style?.fg ?? '').toLowerCase() !== state.theme.palette.border.toLowerCase(),
        ),
      ).toBe(true);
    });
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('suppresses native region VFX while transcript viewport is manually scrolled', () => {
    withMotionEffectsAllowedEnv(() => {
      const state = createTUIState({
        initialAppState: fakeInitialAppState(),
        startup: {
          continueLast: false,
          yolo: false,
          auto: false,
          plan: false,
        },
      });
      state.editor.borderHighlighted = true;
      state.editorContainer.addChild(state.editor);
      state.transcriptViewport.scroll('line-up');
      advanceAppearanceAnimationClock(450);
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');

      const regions = buildTUIStateNativeFrameRegions(state, 14, 6);
      const editor = regions.find((region) => region.id === 'editor');

      expect(state.transcriptViewport.followOutput).toBe(false);
      expect(editor?.vfx).toBeUndefined();
    });
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('renders an internal scrollbar when the native editor content overflows', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 6 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 16 });
    state.editor.setText('a\nb\nc\nd\ne');
    state.editorContainer.addChild(state.editor);

    const first = renderTUIStateNativeFrame(state);
    const editorRegion = first.regions.find((region) => region.id === 'editor');
    expect(editorRegion?.rect).toBeDefined();
    const scrollbarColumn = (editorRegion?.rect?.x ?? 0) + (editorRegion?.rect?.width ?? first.width) - 2;
    const scrollbarTop = editorRegion?.rect?.y ?? 0;
    const scrollbarBottom = scrollbarTop + (editorRegion?.rect?.height ?? first.height);
    const scrollbarChars = Array.from({ length: scrollbarBottom - scrollbarTop }, (_, index) =>
      first.renderer.frame.getCell(scrollbarColumn, scrollbarTop + index).char,
    );

    expect(scrollbarChars).toContain('█');
  });

  it('allocates more native editor rows for multiline input', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 10 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 24 });
    state.editor.setText('a\nb\nc');
    state.editorContainer.addChild(state.editor);

    const frame = renderTUIStateNativeFrame(state);
    const editorRegion = frame.regions.find((region) => region.id === 'editor');

    expect(editorRegion?.rect?.height).toBeGreaterThanOrEqual(5);
  });

  it('builds native frame regions without mutating mounted footer state', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });

    const regions = buildTUIStateNativeFrameRegions(state, 10, 5);

    expect(regions.map((region) => region.id)).toEqual(['transcript']);
    expect(state.footerContainer.children).toHaveLength(0);
  });

  it('fills empty native frame cells with the theme background when canvas background is enabled', () => {
    const previous = currentTheme.canvasBackgroundEnabled;
    currentTheme.setCanvasBackgroundEnabled(true);
    try {
      const state = createTUIState({
        initialAppState: fakeInitialAppState(),
        startup: {
          continueLast: false,
          yolo: false,
          auto: false,
          plan: false,
        },
      });
      Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 6 });
      Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 12 });

      const frame = renderTUIStateNativeFrame(state);
      const background = currentTheme.palette.background;

      expect(frame.renderer.frame.getCell(0, 0).style?.bg).toBe(background);
      expect(frame.renderer.frame.getCell(11, 5).style?.bg).toBe(background);
    } finally {
      currentTheme.setCanvasBackgroundEnabled(previous);
    }
  });

  it('can drive current renderer containers through the live native renderer runtime', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    state.transcriptContainer.addChild(fixedLines(['t1', 't2', 't3']));
    state.editorContainer.addChild(fixedLines(['ed']));
    state.footerContainer.addChild(fixedLines(['ft']));
    const output = new FakeNativeOutput(8, 4);
    const scheduler = new FakeRenderLoopScheduler();
    const renderer = createTUIStateNativeRenderer(state, {
      output,
      scheduler,
      renderOnStart: true,
    });

    renderer.start();
    scheduler.advance(0);

    expect(renderer.lastFrame?.frame.causes).toEqual(['start']);
    expect(renderer.lastFrame?.size).toEqual({ columns: 8, rows: 4 });
    expect(renderer.lastFrame?.metrics).toMatchObject({
      outputBytes: Buffer.byteLength(output.writes[0]!),
      changedCells: 8 * 4,
      totalCells: 8 * 4,
      overBudget: false,
    });
    expect(renderer.lastFrame?.present?.outputPolicy).toMatchObject({
      mode: 'full',
      reason: 'disabled',
      eraseLine: true,
    });
    expect(renderer.stats.frames).toBe(1);
    expect(renderer.stats.health).toBe('healthy');
    expect(renderer.stats.last).toBe(renderer.lastFrame?.metrics);
    expect(rowText(renderer.frameRenderer.frame, 0).trim()).toBe('t2    │');
    expect(rowText(renderer.frameRenderer.frame, 1).trim()).toBe('t3    █');
    expect(rowText(renderer.frameRenderer.frame, 2).trim()).toBe('ed');
    expect(rowText(renderer.frameRenderer.frame, 3).trim()).toBe('ft');
    expect(output.writes).toHaveLength(1);

    output.columns = 10;
    output.rows = 5;
    output.emit('resize');
    scheduler.advance(17);

    expect(renderer.lastFrame?.frame.causes).toEqual(['resize']);
    expect(renderer.lastFrame?.size).toEqual({ columns: 10, rows: 5 });
    expect(renderer.frameRenderer.width).toBe(10);
    expect(renderer.frameRenderer.height).toBe(5);
    renderer.stop();
  });

  it('grows the native renderer frame height with transcript content instead of always filling the viewport', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    state.transcriptContainer.addChild(fixedLines(['t1', 't2']));
    state.editorContainer.addChild(fixedLines(['ed']));
    state.footerContainer.addChild(fixedLines(['ft']));
    const output = new FakeNativeOutput(10, 10);
    const scheduler = new FakeRenderLoopScheduler();
    const renderer = createTUIStateNativeRenderer(state, {
      output,
      scheduler,
      renderOnStart: true,
      growWithContent: true,
    });

    renderer.start();
    scheduler.advance(0);

    // transcript (2 lines) + editor (1) + footer (1) = 4, well below the 10 real rows.
    expect(renderer.frameRenderer.height).toBe(4);
    expect(renderer.lastFrame?.size).toEqual({ columns: 10, rows: 10 });

    state.transcriptContainer.addChild(fixedLines(['t3', 't4', 't5']));
    state.transcriptContainer.invalidate();
    renderer.requestRender('manual');
    scheduler.advance(17);

    expect(renderer.frameRenderer.height).toBe(7);

    const writesBeforeShrink = output.writes.length;
    state.transcriptContainer.children.length = 0;
    state.transcriptContainer.addChild(fixedLines(['t1']));
    state.transcriptContainer.invalidate();
    renderer.requestRender('manual');
    scheduler.advance(17);

    expect(renderer.frameRenderer.height).toBe(3);
    const shrinkWrites = output.writes.slice(writesBeforeShrink);
    expect(shrinkWrites).toContain(encodeTerminalClearBelowRow(3));
    renderer.stop();
  });

  it('enables synchronized-output probing for the visible native renderer', async () => {
    const terminal = new FakeNativeTerminal(8, 4);
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    state.terminal = terminal as unknown as RendererTerminalHost;
    const scheduler = new FakeRenderLoopScheduler();
    const renderer = createTUIStateVisibleNativeRenderer(state, {
      scheduler,
      features: { synchronized: true },
      renderOnStart: false,
      synchronizedOutputProbeTimeoutMs: 25,
    });

    renderer.start();
    expect(terminal.writes).toEqual([ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT]);

    terminal.emit('data', '\u001B[?2026;0$y');
    await Promise.resolve();

    expect(renderer.synchronizedOutputProbeResult).toMatchObject({
      support: 'unsupported',
      timedOut: false,
    });
    expect(renderer.synchronizedOutputEnabled).toBe(false);
    renderer.stop();
  });

  it('schedules native animation frames while region VFX is active', () => {
    withMotionEffectsAllowedEnv(() => {
      const state = createTUIState({
        initialAppState: fakeInitialAppState(),
        startup: {
          continueLast: false,
          yolo: false,
          auto: false,
          plan: false,
        },
      });
      state.editorContainer.addChild(state.editor);
      state.editor.borderHighlighted = true;
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');
      const output = new FakeNativeOutput(14, 6);
      const scheduler = new FakeRenderLoopScheduler();
      const renderer = createTUIStateNativeRenderer(state, {
        output,
        scheduler,
        renderOnStart: true,
        synchronized: true,
      });

      renderer.start();
      scheduler.advance(0);
      expect(renderer.lastFrame?.frame.causes).toEqual(['start']);

      scheduler.advance(17);
      expect(renderer.lastFrame?.frame.causes).toContain('animation');

      scheduler.advance(17);
      expect(renderer.lastFrame?.frame.causes).toContain('animation');
      expect(renderer.stats.frames).toBe(3);
      renderer.stop();
    });
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('degrades native region VFX animation frames when synchronized output is unavailable', () => {
    withMotionEffectsAllowedEnv(() => {
      const state = createTUIState({
        initialAppState: fakeInitialAppState(),
        startup: {
          continueLast: false,
          yolo: false,
          auto: false,
          plan: false,
        },
      });
      state.editorContainer.addChild(state.editor);
      state.editor.borderHighlighted = true;
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');
      const output = new FakeNativeOutput(14, 6);
      const scheduler = new FakeRenderLoopScheduler();
      const renderer = createTUIStateNativeRenderer(state, {
        output,
        scheduler,
        renderOnStart: true,
      });

      renderer.start();
      scheduler.advance(0);
      scheduler.advance(17);

      expect(renderer.lastFrame?.frame.causes).toEqual(['start']);
      expect(renderer.stats.frames).toBe(1);
      expect(output.writes).toHaveLength(1);
      renderer.stop();
    });
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('keeps native region VFX idle while transcript viewport is manually scrolled', () => {
    withMotionEffectsAllowedEnv(() => {
      const state = createTUIState({
        initialAppState: fakeInitialAppState(),
        startup: {
          continueLast: false,
          yolo: false,
          auto: false,
          plan: false,
        },
      });
      state.editorContainer.addChild(state.editor);
      state.editor.borderHighlighted = true;
      state.transcriptViewport.scroll('line-up');
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');
      const output = new FakeNativeOutput(14, 6);
      const scheduler = new FakeRenderLoopScheduler();
      const renderer = createTUIStateNativeRenderer(state, {
        output,
        scheduler,
        renderOnStart: true,
        synchronized: true,
      });

      renderer.start();
      scheduler.advance(0);
      const writesAfterStart = output.writes.length;

      renderer.requestRender('request');
      scheduler.advance(17);

      expect(state.transcriptViewport.followOutput).toBe(false);
      expect(renderer.areAutoFramesHeld).toBe(true);
      expect(renderer.lastFrame?.frame.causes).toEqual(['start']);
      expect(renderer.stats.frames).toBe(1);
      expect(output.writes).toHaveLength(writesAfterStart);

      state.transcriptViewport.scroll('bottom');
      renderer.requestRender('manual');
      scheduler.advance(0);

      expect(state.transcriptViewport.followOutput).toBe(true);
      expect(renderer.areAutoFramesHeld).toBe(false);
      expect(renderer.lastFrame?.frame.causes).toEqual(['request', 'manual']);
      expect(output.writes.length).toBeGreaterThan(writesAfterStart);
      renderer.stop();
    });
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('keeps native renderer idle when no region VFX is active', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    state.editorContainer.addChild(state.editor);
    const output = new FakeNativeOutput(14, 6);
    const scheduler = new FakeRenderLoopScheduler();
    const renderer = createTUIStateNativeRenderer(state, {
      output,
      scheduler,
      renderOnStart: true,
    });

    renderer.start();
    scheduler.advance(0);
    scheduler.advance(17);

    expect(renderer.lastFrame?.frame.causes).toEqual(['start']);
    expect(renderer.stats.frames).toBe(1);
    renderer.stop();
  });

  it('can render native frame diagnostics as a compositor overlay', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    state.transcriptContainer.addChild(fixedLines(['underlay']));
    const stats = new NativeFrameStats({ windowSize: 4 });
    stats.record(nativeFrameMetrics({ durationMs: 16, targetFrameMs: 10, outputBytes: 70_000 }));
    stats.record(nativeFrameMetrics({ durationMs: 12, targetFrameMs: 10, outputBytes: 80_000 }));
    const diagnostics = diagnoseNativeRendererStats(stats.snapshot(), {
      level: 'balanced',
      consecutiveOverBudgetFrames: 0,
      consecutiveOutputPressureFrames: 0,
      consecutiveUnderBudgetFrames: 0,
      changes: 1,
      lastChangeReason: 'over-budget',
    });

    const frame = renderTUIStateNativeFrame(state, {
      width: 44,
      height: 8,
      diagnosticsOverlay: {
        diagnostics,
        width: 36,
        maxIssues: 1,
        placement: 'top-left',
        marginX: 0,
        marginY: 0,
      },
    });

    expect(rowText(frame.renderer.frame, 0)).toContain('Renderer');
    expect(rowText(frame.renderer.frame, 1)).toContain('renderer degraded');
    expect(rowText(frame.renderer.frame, 2)).toContain('frames');
    expect(rowText(frame.renderer.frame, 3)).toContain('output full');
    expect(rowText(frame.renderer.frame, 4)).toContain('phase top');
    expect(rowText(frame.renderer.frame, 5)).toContain('cache rows');
    expect(rowText(frame.renderer.frame, 6)).toContain('frame-budget');
  });

  it('attaches adaptive renderer VFX to non-healthy diagnostics overlays', () => {
    withMotionEffectsAllowedEnv(() => {
      const state = createTUIState({
        initialAppState: fakeInitialAppState(),
        startup: {
          continueLast: false,
          yolo: false,
          auto: false,
          plan: false,
        },
      });
      const stats = new NativeFrameStats({ windowSize: 4 });
      stats.record(nativeFrameMetrics({ durationMs: 16, targetFrameMs: 10 }));
      const diagnostics = diagnoseNativeRendererStats(stats.snapshot(), {
        level: 'balanced',
        consecutiveOverBudgetFrames: 1,
        consecutiveOutputPressureFrames: 0,
        consecutiveUnderBudgetFrames: 0,
        changes: 1,
        lastChangeReason: 'over-budget',
      });
      advanceAppearanceAnimationClock(720);
      setAppearanceRenderQuality('balanced');
      setAppearanceRenderHealth('watch');

      const frame = renderTUIStateNativeFrame(state, {
        width: 44,
        height: 8,
        diagnosticsOverlay: {
          diagnostics,
          width: 36,
          placement: 'top-left',
          marginX: 0,
          marginY: 0,
        },
      });
      const overlay = frame.regions.find((region) => region.id === 'kimi-native-renderer-diagnostics');
      const expectedColor = diagnostics.severity === 'degraded'
        ? state.theme.palette.error
        : diagnostics.severity === 'watch'
          ? state.theme.palette.warning
          : state.theme.palette.success;

      expect(overlay?.vfx).toMatchObject({
        effect: {
          kind: 'pulse',
          nowMs: 720,
          color: expectedColor,
        },
      });
    });
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('updates the live native diagnostics overlay from previous frame stats', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    state.transcriptContainer.addChild(fixedLines(['body']));
    const output = new FakeNativeOutput(44, 8);
    const scheduler = new FakeRenderLoopScheduler();
    let diagnosticsOverlayEnabled = false;
    const renderer = createTUIStateNativeRenderer(state, {
      output,
      scheduler,
      renderOnStart: true,
      diagnosticsOverlay: () => diagnosticsOverlayEnabled
        ? {
            width: 36,
            maxIssues: 1,
            placement: 'top-left',
            marginX: 0,
            marginY: 0,
          }
        : false,
    });

    renderer.start();
    scheduler.advance(0);
    expect(rowText(renderer.frameRenderer.frame, 0)).not.toContain('Renderer');

    diagnosticsOverlayEnabled = true;
    renderer.requestRender('manual');
    scheduler.advance(17);

    expect(rowText(renderer.frameRenderer.frame, 0)).toContain('Renderer');
    expect(rowText(renderer.frameRenderer.frame, 1)).toContain('renderer');
    renderer.stop();
  });

  it('drives appearance animation quality from native renderer frame budget', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeNativeOutput(6, 3);
    output.write = (chunk: string) => {
      output.writes.push(chunk);
      scheduler.advance(12);
    };
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
    const renderer = createTUIStateNativeRenderer(state, {
      features: 'minimal',
      output,
      scheduler,
      targetFps: 100,
      renderOnStart: true,
      adaptiveQuality: { degradeAfterFrames: 1 },
    });

    renderer.start();
    scheduler.advance(0);
    expect(renderer.quality.level).toBe('balanced');
    expect(renderer.stats.health).toBe('degraded');
    expect(getAppearanceRenderHealth()).toBe('degraded');
    expect(getAppearanceRenderQuality()).toBe('full');

    renderer.requestRender('manual');
    scheduler.advance(12);

    expect(getAppearanceRenderQuality()).toBe('balanced');
    expect(appearanceAnimationNow()).toBe(12);
    renderer.stop();
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('can map native input routing onto the current editor target', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const requestRender = vi.fn();
    state.renderer.requestRender = requestRender;
    const legacyInputs: string[] = [];
    const nativeInput = createTUIStateNativeInputRouter(state, {
      handleLegacyInput: (data) => legacyInputs.push(data),
    });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'character',
      raw: 'x',
      text: 'x',
      ctrl: false,
      alt: false,
      shift: false,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(state.editor.getText()).toBe('x');
    expect(legacyInputs).toEqual([]);
    expect(requestRender).toHaveBeenCalledTimes(1);
    nativeInput.dispose();
    expect(nativeInput.dispatch(event)).toEqual({ event, route: 'unhandled', handled: false });
  });

  it('can project current editor state into the renderer-native text input model', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const text = 'run [paste #7 +2 lines]\nnow';

    state.editor.setText(text);
    const input = createNativeEditorTextInput(state.editor, { layoutWidth: 12 });

    expect(input.getText()).toBe(text);
    expect(input.getCursor()).toEqual({
      line: state.editor.getCursor().line,
      column: state.editor.getCursor().col,
    });
    expect(input.getAtomicRanges()).toEqual([
      {
        start: 4,
        end: 23,
        id: 'paste:7',
      },
    ]);
    expect(nativeEditorAtomicRangesForText('a [paste #2 9 chars] b')).toEqual([
      {
        start: 2,
        end: 20,
        id: 'paste:2',
      },
    ]);
  });

  it('can route native editor mouse input into renderer-native cursor placement', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 6 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 14 });
    const requestRender = vi.fn();
    state.renderer.requestRender = requestRender;
    state.editor.setText('hello');
    state.editorContainer.addChild(state.editor);
    const nativeInput = createTUIStateNativeInputRouter(state);
    const event: NativeInputEvent = {
      type: 'mouse',
      raw: '\u001B[<0;7;4M',
      button: 'left',
      action: 'press',
      x: 6,
      y: 4,
      ctrl: false,
      alt: false,
      shift: false,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(state.editor.getCursor()).toEqual({ line: 0, col: 2 });
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(renderTUIStateNativeFrame(state).cursor).toMatchObject({
      x: 6,
      y: 4,
      visible: true,
      shape: 'bar',
    });
  });

  it('ignores native editor mouse presses in the scrollbar gutter', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    state.editor.setText('a\nb\nc\nd\ne');
    const cursorBefore = state.editor.getCursor();

    expect(handleNativeEditorMouseInput(
      state.nativeEditorTextInput,
      state.editor,
      {
        type: 'mouse',
        raw: '\u001B[<0;15;3M',
        button: 'left',
        action: 'press',
        x: 14,
        y: 2,
        ctrl: false,
        alt: false,
        shift: false,
      },
      { x: 0, y: 0, width: 16, height: 5 },
    )).toBe(false);
    expect(state.editor.getCursor()).toEqual(cursorBefore);
  });

  it('can route native editor cursor keys through the renderer-native text model', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 6 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 14 });
    const requestRender = vi.fn();
    state.renderer.requestRender = requestRender;
    const legacyInputs: string[] = [];
    state.editor.setText('hello');
    state.editorContainer.addChild(state.editor);
    const nativeInput = createTUIStateNativeInputRouter(state, {
      handleLegacyInput: (data) => legacyInputs.push(data),
    });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'left',
      raw: '\u001B[D',
      ctrl: false,
      alt: false,
      shift: false,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(state.editor.getCursor()).toEqual({ line: 0, col: 4 });
    expect(legacyInputs).toEqual([]);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(renderTUIStateNativeFrame(state).cursor).toMatchObject({
      x: 8,
      y: 4,
      visible: true,
      shape: 'bar',
    });
  });

  it('keeps native editor selections alive across input and render', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 6 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 14 });
    state.editor.setText('hello');
    state.editorContainer.addChild(state.editor);
    const nativeInput = createTUIStateNativeInputRouter(state, { requestRender: false });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'left',
      raw: '\u001B[1;2D',
      ctrl: false,
      alt: false,
      shift: true,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(state.editor.getCursor()).toEqual({ line: 0, col: 4 });
    expect(
      state.nativeEditorTextInput.inputForEditor(state.editor).getSelectionRange(),
    ).toEqual({ start: 4, end: 5 });

    const frame = renderTUIStateNativeFrame(state);
    expect(frame.cursor).toMatchObject({ x: 8, y: 4, visible: true, shape: 'bar' });
    expect(frame.renderer.frame.getCell(8, 4).style?.bg).toBe(
      state.theme.palette.selectionBg,
    );
  });

  it('routes native editor document-boundary selection shortcuts', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    state.editor.setText('hello\nworld');
    state.editorContainer.addChild(state.editor);
    const legacyInputs: string[] = [];
    const nativeInput = createTUIStateNativeInputRouter(state, {
      requestRender: false,
      handleLegacyInput: (data) => legacyInputs.push(data),
    });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'home',
      raw: '\u001B[1;6H',
      ctrl: true,
      alt: false,
      shift: true,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(state.editor.getCursor()).toEqual({ line: 0, col: 0 });
    expect(
      state.nativeEditorTextInput.inputForEditor(state.editor).getSelectionRange(),
    ).toEqual({ start: 0, end: 11 });
    expect(legacyInputs).toEqual([]);
  });

  it('routes editor page keys only when the native editor can scroll internally', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'pageup',
      raw: '\u001B[5~',
      ctrl: false,
      alt: false,
      shift: false,
    };
    const rect = { x: 0, y: 0, width: 12, height: 4 };

    state.editor.setText('a\nb\nc\nd\ne');
    expect(handleNativeEditorKeyInput(
      state.nativeEditorTextInput,
      state.editor,
      event,
      rect,
    )).toBe(true);
    expect(state.editor.getCursor()).toEqual({ line: 2, col: 1 });

    const shortState = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    shortState.editor.setText('short');
    expect(handleNativeEditorKeyInput(
      shortState.nativeEditorTextInput,
      shortState.editor,
      event,
      rect,
    )).toBe(false);
  });

  it('can route native editor text mutations through the renderer-native text model', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    Object.defineProperty(state.terminal, 'rows', { configurable: true, get: () => 6 });
    Object.defineProperty(state.terminal, 'columns', { configurable: true, get: () => 14 });
    const requestRender = vi.fn();
    state.renderer.requestRender = requestRender;
    const legacyInputs: string[] = [];
    const changes: string[] = [];
    state.editor.onChange = (text) => changes.push(text);
    state.editorContainer.addChild(state.editor);
    const nativeInput = createTUIStateNativeInputRouter(state, {
      handleLegacyInput: (data) => legacyInputs.push(data),
    });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'character',
      raw: 'h',
      text: 'h',
      ctrl: false,
      alt: false,
      shift: false,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(state.editor.getText()).toBe('h');
    expect(state.editor.getCursor()).toEqual({ line: 0, col: 1 });
    expect(changes).toEqual(['h']);
    expect(legacyInputs).toEqual([]);
    expect(requestRender).toHaveBeenCalledTimes(1);
    expect(renderTUIStateNativeFrame(state).cursor).toMatchObject({
      x: 5,
      y: 4,
      visible: true,
      shape: 'bar',
    });
  });

  it('keeps native editor undo and redo history across input events', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    state.editorContainer.addChild(state.editor);
    const nativeInput = createTUIStateNativeInputRouter(state, { requestRender: false });

    nativeInput.dispatch({
      type: 'key',
      key: 'character',
      raw: 'a',
      text: 'a',
      ctrl: false,
      alt: false,
      shift: false,
    });
    nativeInput.dispatch({
      type: 'key',
      key: 'character',
      raw: 'b',
      text: 'b',
      ctrl: false,
      alt: false,
      shift: false,
    });

    expect(state.editor.getText()).toBe('ab');
    expect(
      state.nativeEditorTextInput.inputForEditor(state.editor).canUndo(),
    ).toBe(true);

    nativeInput.dispatch({
      type: 'key',
      key: 'character',
      raw: '\u001A',
      text: 'z',
      ctrl: true,
      alt: false,
      shift: false,
    });
    expect(state.editor.getText()).toBe('a');

    nativeInput.dispatch({
      type: 'key',
      key: 'character',
      raw: '\u0019',
      text: 'y',
      ctrl: true,
      alt: false,
      shift: false,
    });
    expect(state.editor.getText()).toBe('ab');
  });

  it('preserves bash-mode entry while routing native editor text input', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const inputModes: string[] = [];
    const legacyInputs: string[] = [];
    state.editor.onInputModeChange = (mode) => inputModes.push(mode);
    state.editorContainer.addChild(state.editor);
    const nativeInput = createTUIStateNativeInputRouter(state, {
      handleLegacyInput: (data) => legacyInputs.push(data),
    });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'character',
      raw: '!',
      text: '!',
      ctrl: false,
      alt: false,
      shift: false,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(state.editor.inputMode).toBe('bash');
    expect(state.editor.getText()).toBe('');
    expect(inputModes).toEqual(['bash']);
    expect(legacyInputs).toEqual([]);
  });

  it('preserves bash-mode exit while routing native editor text input', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const inputModes: string[] = [];
    const legacyInputs: string[] = [];
    state.editor.inputMode = 'bash';
    state.editor.onInputModeChange = (mode) => inputModes.push(mode);
    state.editorContainer.addChild(state.editor);
    const nativeInput = createTUIStateNativeInputRouter(state, {
      handleLegacyInput: (data) => legacyInputs.push(data),
    });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'escape',
      raw: '\u001B',
      ctrl: false,
      alt: false,
      shift: false,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(state.editor.inputMode).toBe('prompt');
    expect(inputModes).toEqual(['prompt']);
    expect(legacyInputs).toEqual([]);
  });

  it('keeps empty-prompt navigation on the legacy editor path', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const requestRender = vi.fn();
    state.renderer.requestRender = requestRender;
    const legacyInputs: string[] = [];
    state.editorContainer.addChild(state.editor);
    const nativeInput = createTUIStateNativeInputRouter(state, {
      handleLegacyInput: (data) => legacyInputs.push(data),
    });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'up',
      raw: '\u001B[A',
      ctrl: false,
      alt: false,
      shift: false,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(legacyInputs).toEqual(['\u001B[A']);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('can let native editor input consume structured events before legacy fallback', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const requestRender = vi.fn();
    state.renderer.requestRender = requestRender;
    const legacyInputs: string[] = [];
    const nativeEvents: NativeInputEvent[] = [];
    const nativeInput = createTUIStateNativeInputRouter(state, {
      handleNativeEditorInput: (event) => {
        if (event.type !== 'mouse') return false;
        nativeEvents.push(event);
        return true;
      },
      handleLegacyInput: (data) => legacyInputs.push(data),
    });
    const mouseEvent: NativeInputEvent = {
      type: 'mouse',
      raw: '\u001B[<0;1;1M',
      button: 'left',
      action: 'press',
      x: 0,
      y: 0,
      ctrl: false,
      alt: false,
      shift: false,
    };
    const keyEvent: NativeInputEvent = {
      type: 'key',
      key: 'character',
      raw: 'x',
      text: 'x',
      ctrl: false,
      alt: false,
      shift: false,
    };

    expect(nativeInput.dispatch(mouseEvent)).toEqual({
      event: mouseEvent,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });
    expect(nativeInput.dispatch(keyEvent)).toEqual({
      event: keyEvent,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(nativeEvents).toEqual([mouseEvent]);
    expect(legacyInputs).toEqual(['x']);
    expect(requestRender).toHaveBeenCalledTimes(2);
  });

  it('can capture native input with an editor replacement modal target', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const legacyInputs: string[] = [];
    state.editor.handleInput = (data) => {
      legacyInputs.push(data);
    };
    const nativeInput = createTUIStateNativeInputRouter(state, { requestRender: false });
    const event: NativeInputEvent = {
      type: 'key',
      key: 'character',
      raw: 'x',
      text: 'x',
      ctrl: false,
      alt: false,
      shift: false,
    };
    const closeModal = nativeInput.pushLegacyModalTarget({
      id: 'modal',
      handleInput: (data) => legacyInputs.push(`modal:${data}`),
    });

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'modal',
      handled: true,
      targetId: 'modal',
    });
    closeModal();
    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'focused',
      handled: true,
      targetId: 'editor',
    });

    expect(state.editor.getText()).toBe('x');
    expect(legacyInputs).toEqual(['modal:x']);
  });

  it('can route native wheel input into transcript viewport scrolling', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
    });
    const scrollActions: string[] = [];
    const nativeInput = createTUIStateNativeInputRouter(state, {
      requestRender: false,
      scrollTranscriptViewport: (action) => {
        scrollActions.push(action);
        return true;
      },
    });
    const event: NativeInputEvent = {
      type: 'mouse',
      raw: '\u001B[<64;1;1M',
      button: 'wheel-up',
      action: 'wheel',
      x: 0,
      y: 0,
      ctrl: false,
      alt: false,
      shift: false,
    };

    expect(nativeInput.dispatch(event)).toEqual({
      event,
      route: 'global',
      handled: true,
      targetId: 'transcript-scroll',
    });
    expect(scrollActions).toEqual(['line-up']);
  });

});

function fixedLines(lines: readonly string[]): Component {
  return {
    invalidate: () => {},
    render: () => [...lines],
  };
}

function rowText(buffer: { width: number; getCell(x: number, y: number): { char: string } }, y: number): string {
  return Array.from({ length: buffer.width }, (_, x) => buffer.getCell(x, y).char).join('');
}

function countVisibleTranscriptCellsWithForeground(buffer: {
  readonly width: number;
  readonly height: number;
  getCell(x: number, y: number): { char: string; style?: { fg?: string } };
}): number {
  let count = 0;
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      const cell = buffer.getCell(x, y);
      if (cell.char.trim().length > 0 && cell.style?.fg !== undefined) count++;
    }
  }
  return count;
}

function withMotionEffectsAllowedEnv(run: () => void): void {
  const previous = {
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    TERM: process.env['TERM'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };
  process.env['CI'] = '0';
  process.env['TERM'] = 'xterm-256color';
  delete process.env['NO_COLOR'];
  delete process.env['SSH_TTY'];
  delete process.env['SSH_CONNECTION'];
  delete process.env['SSH_CLIENT'];
  try {
    run();
  } finally {
    restoreEnv('CI', previous.CI);
    restoreEnv('NO_COLOR', previous.NO_COLOR);
    restoreEnv('TERM', previous.TERM);
    restoreEnv('SSH_TTY', previous.SSH_TTY);
    restoreEnv('SSH_CONNECTION', previous.SSH_CONNECTION);
    restoreEnv('SSH_CLIENT', previous.SSH_CLIENT);
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function nativeFrameMetrics(
  metrics: Partial<NativeTerminalRendererFrameMetrics>,
): NativeTerminalRendererFrameMetrics {
  const targetFrameMs = metrics.targetFrameMs ?? 16;
  const durationMs = metrics.durationMs ?? 0;
  const totalCells = metrics.totalCells ?? 100;
  const scannedCells = metrics.scannedCells ?? totalCells;
  const scanRatio = metrics.scanRatio ?? (totalCells === 0 ? 0 : scannedCells / totalCells);
  const damageCells = metrics.damageCells ?? scannedCells;
  const damageRatio = metrics.damageRatio ?? (totalCells === 0 ? 0 : damageCells / totalCells);
  return {
    startedAt: metrics.startedAt ?? 0,
    endedAt: metrics.endedAt ?? durationMs,
    durationMs,
    targetFrameMs,
    overBudget: metrics.overBudget ?? durationMs > targetFrameMs,
    renderCallbackDurationMs: metrics.renderCallbackDurationMs ?? durationMs,
    presentDurationMs: metrics.presentDurationMs ?? 0,
    diffDurationMs: metrics.diffDurationMs ?? 0,
    encodeDurationMs: metrics.encodeDurationMs ?? 0,
    writeDurationMs: metrics.writeDurationMs ?? 0,
    qualityDurationMs: metrics.qualityDurationMs ?? 0,
    outputBytes: metrics.outputBytes ?? 0,
    outputBackpressure: metrics.outputBackpressure ?? false,
    outputCells: metrics.outputCells ?? 0,
    outputRuns: metrics.outputRuns ?? 0,
    outputBridgedCells: metrics.outputBridgedCells ?? 0,
    outputBridgedCellRatio: metrics.outputBridgedCellRatio ?? 0,
    cursorAbsoluteMoves: metrics.cursorAbsoluteMoves ?? 0,
    cursorRelativeMoves: metrics.cursorRelativeMoves ?? 0,
    cursorHorizontalAbsoluteMoves: metrics.cursorHorizontalAbsoluteMoves ?? 0,
    cursorMoveBytes: metrics.cursorMoveBytes ?? 0,
    cursorMoveAbsoluteBytes: metrics.cursorMoveAbsoluteBytes ?? 0,
    cursorMoveSavedBytes: metrics.cursorMoveSavedBytes ?? 0,
    outputMode: metrics.outputMode ?? 'full',
    outputSynchronized: metrics.outputSynchronized ?? false,
    outputLargeFrame: metrics.outputLargeFrame ?? true,
    outputPolicyReason: metrics.outputPolicyReason ?? 'full-frame',
    outputEraseLine: metrics.outputEraseLine ?? false,
    changedCells: metrics.changedCells ?? 0,
    scannedCells,
    scannedRows: metrics.scannedRows ?? 10,
    dirtyRows: metrics.dirtyRows ?? 0,
    totalCells,
    scanStrategy: metrics.scanStrategy ?? (scannedCells === 0 ? 'none' : 'full-frame'),
    scanRatio,
    damageCells,
    damageRatio,
    compositionRowsVisited: metrics.compositionRowsVisited ?? 0,
    compositionRowsComposed: metrics.compositionRowsComposed ?? 0,
    compositionRowsReused: metrics.compositionRowsReused ?? 0,
    compositionReuseRatio: metrics.compositionReuseRatio ?? 0,
    lineCacheHits: metrics.lineCacheHits ?? 0,
    lineCacheMisses: metrics.lineCacheMisses ?? 0,
    lineCacheHitRatio: metrics.lineCacheHitRatio ?? 0,
    lineCacheEvictions: metrics.lineCacheEvictions ?? 0,
  };
}

class FakeNativeOutput extends EventEmitter {
  writes: string[] = [];

  constructor(
    public columns: number,
    public rows: number,
  ) {
    super();
  }

  write(chunk: string): void {
    this.writes.push(chunk);
  }
}

class FakeNativeInput extends EventEmitter implements NativeTerminalInput {
  isTTY = true;
  isRaw = false;
  rawModeCalls: boolean[] = [];

  setRawMode(raw: boolean): void {
    this.rawModeCalls.push(raw);
    this.isRaw = raw;
  }

  setEncoding(_encoding: BufferEncoding): void {}

  resume(): void {}

  pause(): void {}
}

class FakeNativeTerminal extends FakeNativeOutput implements NativeTerminalInput {
  isTTY = true;
  isRaw = false;
  rawModeCalls: boolean[] = [];

  setRawMode(raw: boolean): void {
    this.rawModeCalls.push(raw);
    this.isRaw = raw;
  }

  setEncoding(_encoding: BufferEncoding): void {}

  resume(): void {}

  pause(): void {}

  async drainInput(): Promise<void> {}
}

class FakeRenderLoopTimer implements NativeRenderTimer {
  cleared = false;
  unrefCalls = 0;

  constructor(
    readonly dueAt: number,
    readonly callback: () => void,
  ) {}

  unref(): void {
    this.unrefCalls++;
  }
}

class FakeRenderLoopScheduler implements NativeRenderLoopScheduler {
  private time = 0;
  private timers: FakeRenderLoopTimer[] = [];

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): FakeRenderLoopTimer {
    const timer = new FakeRenderLoopTimer(this.time + Math.max(0, delayMs), callback);
    this.timers.push(timer);
    return timer;
  }

  clearTimeout(timer: NativeRenderTimer): void {
    (timer as FakeRenderLoopTimer).cleared = true;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const timer = this.nextDueTimer(target);
      if (timer === undefined) break;
      this.time = timer.dueAt;
      timer.cleared = true;
      timer.callback();
    }
    this.time = target;
  }

  private nextDueTimer(target: number): FakeRenderLoopTimer | undefined {
    return this.timers
      .filter((timer) => !timer.cleared && timer.dueAt <= target)
      .toSorted((a, b) => a.dueAt - b.dueAt)[0];
  }
}

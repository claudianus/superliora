import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { StreamingUIController, type StreamingUIHost } from '#/tui/controllers/streaming-ui/index';
import { createTUIState } from '#/tui/liora-tui';
import type { AppState, TranscriptEntry } from '#/tui/types';
import {
  setActiveAppearancePreferences,
} from '#/tui/features/appearance/appearance-effects';
import { createMotionBeatController } from '#/tui/utils/render/motion-beats';

function fakeAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    theme: 'dark',
    model: 'example-model',
    planMode: false,
    askMode: false,
    streamingPhase: 'composing',
    isCompacting: false,
    isBackgroundCompacting: false,
    inputMode: 'prompt',
    appearance: { ...DEFAULT_APPEARANCE_PREFERENCES },
    ...overrides,
  } as AppState;
}

function createHost() {
  const state = createTUIState({
    initialAppState: fakeAppState(),
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
  });
  const entries: TranscriptEntry[] = [];
  const host: StreamingUIHost = {
    state,
    session: undefined,
    motionBeats: createMotionBeatController(),
    setAppState(patch) {
      state.appState = { ...state.appState, ...patch };
    },
    patchLivePane() {},
    resetLivePane() {},
    updateActivityPane() {},
    updateQueueDisplay() {},
    requireSession() {
      throw new Error('no session in unit test');
    },
    deferUserMessages: false,
    shiftQueuedMessage() {
      return undefined;
    },
    pushTranscriptEntry(entry) {
      entries.push(entry);
      state.transcriptEntries.push(entry);
    },
    mergeCurrentTurnSteps() {},
  };
  return { host, state, entries };
}

describe('StreamingUIController smooth reveal', () => {
  const envKeys = ['TERM', 'CI', 'NO_COLOR', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT'] as const;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of envKeys) delete process.env[key];
    process.env['TERM'] = 'xterm-256color';
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium',
      particles: 'premium',
      animationFps: 60,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    setActiveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('reveals assistant text gradually then snaps on end', () => {
    const { host, entries } = createHost();
    const ui = new StreamingUIController(host);
    const long =
      'The quick brown fox jumps over the lazy dog. '.repeat(8).trim();

    ui.onStreamingTextStart();
    ui.onStreamingTextUpdate(long);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.content).toBe(long);

    const block = ui.getStreamingBlockComponent();
    expect(block).toBeDefined();
    // First paint should be a proper prefix, not necessarily the full dump.
    const firstPaint = (block as unknown as { lastText: string }).lastText;
    expect(long.startsWith(firstPaint)).toBe(true);
    expect(firstPaint.length).toBeGreaterThan(0);
    expect(firstPaint.length).toBeLessThan(long.length);

    // Advance enough ticks to catch up.
    for (let i = 0; i < 40; i++) {
      vi.advanceTimersByTime(24);
    }
    const mid = (block as unknown as { lastText: string }).lastText;
    expect(mid.length).toBeGreaterThanOrEqual(firstPaint.length);

    ui.onStreamingTextEnd();
    const finalText = (block as unknown as { lastText: string }).lastText;
    expect(finalText).toBe(long.trim());
    expect(ui.getStreamingBlockComponent()).toBeUndefined();
  });

  it('snaps immediately when motion is disabled', () => {
    setActiveAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'off',
      particles: 'off',
      animationFps: 0,
    });
    const { host } = createHost();
    const ui = new StreamingUIController(host);
    const text = 'Instant full dump when animation is off.';

    ui.onStreamingTextStart();
    ui.onStreamingTextUpdate(text);

    const block = ui.getStreamingBlockComponent();
    expect((block as unknown as { lastText: string }).lastText).toBe(text);
  });

  it('reveals thinking gradually and snaps on end', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);
    const thinking = 'Considering several approaches to the streaming reveal layer. '.repeat(6);

    ui.onThinkingUpdate(thinking);
    expect(ui.hasActiveThinkingComponent()).toBe(true);

    // Component text is private; re-render path uses setText — drive ticks then end.
    for (let i = 0; i < 50; i++) {
      vi.advanceTimersByTime(24);
    }

    ui.onThinkingEnd();
    expect(ui.hasActiveThinkingComponent()).toBe(false);
  });

  it('disarms reveal catch-up on resetLiveText', () => {
    const { host } = createHost();
    const ui = new StreamingUIController(host);
    // Catch-up rides the shared frame clock, not a private timer (PREMIUM §7.1).
    const armed = () =>
      (ui as unknown as { revealRuntime: { revealArmed: boolean } }).revealRuntime.revealArmed;

    ui.onStreamingTextStart();
    ui.onStreamingTextUpdate('partial stream that lags a bit '.repeat(10));
    expect(armed()).toBe(true);

    ui.resetLiveText();
    expect(armed()).toBe(false);
    expect(ui.getStreamingBlockComponent()).toBeUndefined();
  });
});

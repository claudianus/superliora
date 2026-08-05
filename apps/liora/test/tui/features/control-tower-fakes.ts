/**
 * Shared fakes for Conductor input-path tests (V3-1 / V3-2 / V3-3).
 *
 * `fakeDispatchHost` satisfies `MessageDispatchHost` with spy surfaces —
 * no renderer, no disk (sessionDir undefined keeps prompt-input persistence
 * a no-op), deterministic streaming state.
 */

import { vi } from 'vitest';

import type { QueuedMessage } from '#/tui/types';

export type FakeStreamingPhase = 'idle' | 'waiting' | 'running' | 'shell';

/**
 * Bare spy with an explicit signature. An untyped `vi.fn` infers `Mock<Procedure>`, and
 * `Procedure` has no public export, so the inferred host type would not be
 * nameable in declaration output (TS2883).
 */
const spy = () => vi.fn<(...args: unknown[]) => void>();

export interface FakeDispatchOptions {
  readonly loading?: boolean;
  readonly replaying?: boolean;
  readonly inputMode?: 'prompt' | 'bash';
  readonly streamingPhase?: FakeStreamingPhase;
  readonly deferUserMessages?: boolean;
}

export function fakeDispatchHost(options: FakeDispatchOptions = {}) {
  let editorText = '';
  const editor = {
    getText: () => editorText,
    setText: (text: string) => {
      editorText = text;
    },
    inputMode: options.inputMode ?? ('prompt' as 'prompt' | 'bash'),
  };
  const appState = {
    inputMode: options.inputMode ?? 'prompt',
    isReplaying: options.replaying ?? false,
    streamingPhase: options.streamingPhase ?? 'idle',
    isCompacting: false,
    model: 'test-model',
  };
  const state = {
    queuedMessages: [] as QueuedMessage[],
    editor,
    appState,
    transcriptContainer: { isBatchMounting: false },
    renderer: { invalidateFrame: spy() },
  };
  const session = {
    id: 'sess_test',
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    activateSkill: vi.fn(async () => {}),
  };
  let loadingActive = options.loading ?? false;
  const host = {
    state,
    session,
    deferUserMessages: options.deferUserMessages ?? false,
    lastUserInput: undefined as string | undefined,
    harness: {
      interactiveAgentId: 'main',
      withInteractiveAgent: (_agentId: string, run: () => void) => {
        run();
      },
    },
    streamingUI: { getTurnContext: () => ({ turnId: 'turn_1' }) },
    btwPanelController: { sendUserInput: vi.fn(() => false) },
    imageStore: {},
    promptStash: { toArray: () => [], replaceAll: () => {} },
    setAppState: vi.fn((patch: Record<string, unknown>) => {
      Object.assign(appState, patch);
    }),
    handleInputModeChange: vi.fn((mode: 'prompt' | 'bash') => {
      appState.inputMode = mode;
      editor.inputMode = mode;
    }),
    isSessionLoadingOverlayActive: vi.fn(() => loadingActive),
    showError: spy(),
    showStatus: spy(),
    persistInputHistory: vi.fn(async () => {}),
    runShellCommandFromInput: spy(),
    updateQueueDisplay: spy(),
    dispatchSlashInput: spy(),
    appStateController: { supportsCurrentModelCapability: () => true },
    beginSessionRequest: spy(),
    failSessionRequest: spy(),
    appendTranscriptEntry: spy(),
    track: spy(),
    updateEditorBorderHighlight: spy(),
    controlTowerDesk: { markInputSubmitted: spy() },
    // Test handles.
    editorText: () => editorText,
    setLoading: (value: boolean) => {
      loadingActive = value;
    },
  };
  return host;
}

export type FakeDispatchHost = ReturnType<typeof fakeDispatchHost>;

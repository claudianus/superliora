/**
 * Shared fakes for Conductor input-path tests (V3-1 / V3-2 / V3-3).
 *
 * `fakeDispatchHost` satisfies `MessageDispatchHost` with vi.fn() surfaces —
 * no renderer, no disk (sessionDir undefined keeps prompt-input persistence
 * a no-op), deterministic streaming state.
 */

import { vi } from 'vitest';

import type { QueuedMessage } from '#/tui/types';

export type FakeStreamingPhase = 'idle' | 'waiting' | 'running' | 'shell';

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
    renderer: { invalidateFrame: vi.fn() },
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
    showError: vi.fn(),
    showStatus: vi.fn(),
    persistInputHistory: vi.fn(async () => {}),
    runShellCommandFromInput: vi.fn(),
    updateQueueDisplay: vi.fn(),
    dispatchSlashInput: vi.fn(),
    appStateController: { supportsCurrentModelCapability: () => true },
    beginSessionRequest: vi.fn(),
    failSessionRequest: vi.fn(),
    appendTranscriptEntry: vi.fn(),
    track: vi.fn(),
    updateEditorBorderHighlight: vi.fn(),
    controlTowerDesk: { markInputSubmitted: vi.fn() },
    // Test handles.
    editorText: () => editorText,
    setLoading: (value: boolean) => {
      loadingActive = value;
    },
  };
  return host;
}

export type FakeDispatchHost = ReturnType<typeof fakeDispatchHost>;

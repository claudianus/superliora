/**
 * V3-3 — loading never drops submitted input.
 *
 * The editor clears its buffer before the (IME double-deferred) submit lands
 * in `MessageDispatchController.handleUserInput`, so the old "loading busy"
 * rejection silently destroyed whatever the operator typed while the session
 * loading overlay was mounting. The rejection path is gone: while loading,
 * submitted text is handed back to the editor (draft persist picks it up),
 * and Enter re-submits once loading finishes. Pure replay viewing keeps the
 * busy error — there is no live session to submit to.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  MessageDispatchController,
  type MessageDispatchHost,
} from '#/tui/controllers/transcript/message-dispatch';
import type { QueuedMessage } from '#/tui/types';
import { ttui } from '#/tui/utils/tui-i18n';

type StreamingPhase = 'idle' | 'waiting' | 'running' | 'shell';

interface FakeDispatchOptions {
  readonly loading?: boolean;
  readonly replaying?: boolean;
  readonly inputMode?: 'prompt' | 'bash';
  readonly streamingPhase?: StreamingPhase;
  readonly deferUserMessages?: boolean;
}

function fakeDispatchHost(options: FakeDispatchOptions = {}) {
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
    // Test handles.
    editorText: () => editorText,
    setLoading: (value: boolean) => {
      loadingActive = value;
    },
  };
  return host;
}

function controllerFor(host: ReturnType<typeof fakeDispatchHost>): MessageDispatchController {
  return new MessageDispatchController(host as unknown as MessageDispatchHost);
}

describe('V3-3 — submitted input survives the session loading overlay', () => {
  it('hands the submitted text back to the editor instead of rejecting it', () => {
    const host = fakeDispatchHost({ loading: true });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('ship the release notes');

    // No rejection path: no busy error, nothing dropped, nothing sent yet.
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.session.prompt).not.toHaveBeenCalled();
    expect(host.dispatchSlashInput).not.toHaveBeenCalled();
    // Input is preserved exactly where the operator will look for it.
    expect(host.editorText()).toBe('ship the release notes');
    expect(host.updateEditorBorderHighlight).toHaveBeenCalledWith('ship the release notes');
    expect(host.showStatus).toHaveBeenCalledWith(ttui('tui.sessionLoading.inputHeld'), 'info');
  });

  it('preserves bash mode for a `!` command submitted mid-load', () => {
    const host = fakeDispatchHost({ loading: true, inputMode: 'bash' });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('pnpm -C apps/liora run test');

    expect(host.showError).not.toHaveBeenCalled();
    expect(host.editorText()).toBe('pnpm -C apps/liora run test');
    // handleUserInput exits bash mode first; the hold path must restore it so
    // the re-submit after loading still runs as a shell command.
    expect(host.state.editor.inputMode).toBe('bash');
    expect(host.handleInputModeChange).toHaveBeenLastCalledWith('bash');
  });

  it('re-submits the preserved text normally once loading finishes', () => {
    const host = fakeDispatchHost({ loading: true });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('continue the migration');
    expect(host.dispatchSlashInput).not.toHaveBeenCalled();

    host.setLoading(false);
    dispatch.handleUserInput(host.editorText());

    expect(host.dispatchSlashInput).toHaveBeenCalledTimes(1);
    expect(host.dispatchSlashInput).toHaveBeenCalledWith('continue the migration');
  });

  it('keeps the busy rejection for pure replay viewing (no live session)', () => {
    const host = fakeDispatchHost({ replaying: true });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('should not land');

    expect(host.showError).toHaveBeenCalledWith(ttui('tui.sessionLoading.busy'));
    expect(host.dispatchSlashInput).not.toHaveBeenCalled();
    expect(host.editorText()).toBe('');
  });

  it('does not hold blank submissions', () => {
    const host = fakeDispatchHost({ loading: true });
    const dispatch = controllerFor(host);

    dispatch.handleUserInput('   ');

    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.editorText()).toBe('');
  });
});

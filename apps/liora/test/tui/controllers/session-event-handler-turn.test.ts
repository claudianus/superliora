import { describe, expect, it, vi } from 'vitest';

import type { Event } from '@superliora/sdk';

import { SessionEventHandler } from '#/tui/controllers/session-event/handler';
import { getBuiltInPalette } from '#/tui/theme';

function makeHost() {
  const host = {
    state: {
      appState: {
        sessionId: 's1',
        streamingPhase: 'waiting',
        model: 'kimi-model',
        permissionMode: 'auto',
        // Notification gate: disabled so turn-complete bell/toast paths never
        // touch stdout from inside tests.
        notifications: { enabled: false, condition: 'always' as const },
      },
      queuedMessages: [],
      theme: { palette: getBuiltInPalette('dark') },
      toolOutputExpanded: false,
      todoPanel: { getTodos: vi.fn(() => []) },
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    session: undefined,
    aborted: false,
    sessionEventUnsubscribe: undefined,
    streamingUI: {
      setTurnId: vi.fn(),
      setStep: vi.fn(),
      flushNow: vi.fn(),
      resetToolUi: vi.fn(),
      finalizeTurn: vi.fn(),
      finalizeLiveTextBuffers: vi.fn(),
      hasThinkingDraft: vi.fn(() => false),
      flushThinkingToTranscript: vi.fn(),
      appendAssistantDelta: vi.fn(),
      scheduleFlush: vi.fn(),
      setTodoList: vi.fn(),
    },
    motionBeats: {
      play: vi.fn(),
      active: vi.fn(),
      clear: vi.fn(),
    },
    workerDock: {
      handleEvent: vi.fn(),
      reset: vi.fn(),
    },
    requireSession: vi.fn(function (this: { session: unknown }) {
      return this.session;
    }),
    setAppState: vi.fn(),
    patchLivePane: vi.fn(),
    resetLivePane: vi.fn(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    setLastTurnFailed: vi.fn(),
    track: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    appendTranscriptEntry: vi.fn(),
    handleShellOutput: vi.fn(),
    handleShellStarted: vi.fn(),
    sendNormalUserInput: vi.fn(),
    sendQueuedMessage: vi.fn(),
    shiftQueuedMessage: vi.fn(),
    updateActivityPane: vi.fn(),
    updateTerminalTitle: vi.fn(),
    btwPanelController: { routeEvent: vi.fn(() => false) },
    tasksBrowserController: {},
  };
  return host as any;
}

function stepInterruptedEvent(
  overrides: Partial<Extract<Event, { type: 'turn.step.interrupted' }>> = {},
) {
  return {
    type: 'turn.step.interrupted',
    agentId: 'main',
    sessionId: 's1',
    turnId: 1,
    step: 12,
    reason: 'max_steps',
    ...overrides,
  } satisfies Event;
}

describe('SessionEventHandler max_steps exhausted UX', () => {
  it('reports a real max_steps interrupt without heuristic recovery advice', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(stepInterruptedEvent(), vi.fn());

    expect(host.showNotice).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith('step interrupted (max_steps)');
  });

  it('keeps non-max_steps interrupts as showError', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(stepInterruptedEvent({ reason: 'provider_timeout' }), vi.fn());

    expect(host.showNotice).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith('step interrupted (provider_timeout)');
  });
});

describe('SessionEventHandler native Auto route', () => {
  it('records a concrete default selection without warning about failover or Smart Auto', () => {
    const host = makeHost();
    host.state.appState.model = 'auto';
    host.state.appState.availableModels = {
      'kimi-model': { provider: 'kimi', model: 'kimi-model', maxContextSize: 200_000 },
    };
    const handler = new SessionEventHandler(host);
    handler.handleEvent({
      type: 'turn.step.completed',
      agentId: 'main',
      sessionId: 's1',
      turnId: 1,
      step: 1,
      providerRouteSelection: {
        modelAlias: 'kimi-model',
        providerName: 'kimi',
        providerModel: 'kimi-model',
      },
    } satisfies Event, vi.fn());
    expect(host.showNotice).not.toHaveBeenCalled();
    expect(host.setAppState).toHaveBeenCalledWith(expect.objectContaining({
      lastModelRouteNotice: expect.objectContaining({
        kind: 'selection',
        fromAlias: 'auto',
        toAlias: 'kimi-model',
        reason: 'provider-route',
      }),
    }));
  });
});

describe('SessionEventHandler provider filtered turn end (Loop37a)', () => {
  it('surfaces provider filtering as a named notice', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'main',
        sessionId: 's1',
        turnId: 1,
        reason: 'filtered',
      } satisfies Event,
      vi.fn(),
    );

    expect(host.showNotice).toHaveBeenCalledWith(
      'Provider safety filter',
      expect.stringMatching(/filtered/i),
      { coalesceKey: 'provider-filtered' },
    );
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringMatching(/provider safety policy/i),
      'error',
    );
  });
});

describe('SessionEventHandler live-text finalize at turn boundaries', () => {
  it('finalizes live text on step begin, interrupt, and turn end', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(
      {
        type: 'turn.step.started',
        agentId: 'main',
        sessionId: 's1',
        turnId: 1,
        step: 2,
      } satisfies Event,
      vi.fn(),
    );
    expect(host.streamingUI.flushNow).toHaveBeenCalled();
    expect(host.streamingUI.finalizeLiveTextBuffers).toHaveBeenCalledWith('waiting');

    host.streamingUI.flushNow.mockClear();
    host.streamingUI.finalizeLiveTextBuffers.mockClear();

    handler.handleEvent(
      {
        type: 'turn.step.interrupted',
        agentId: 'main',
        sessionId: 's1',
        turnId: 1,
        step: 2,
        reason: 'aborted',
        cancelledByUser: true,
      } satisfies Event,
      vi.fn(),
    );
    expect(host.streamingUI.flushNow).toHaveBeenCalled();
    expect(host.streamingUI.finalizeLiveTextBuffers).toHaveBeenCalledWith('idle');

    host.streamingUI.flushNow.mockClear();
    host.streamingUI.finalizeTurn.mockClear();

    handler.handleEvent(
      {
        type: 'turn.ended',
        agentId: 'main',
        sessionId: 's1',
        turnId: 1,
        reason: 'completed',
      } satisfies Event,
      vi.fn(),
    );
    expect(host.streamingUI.flushNow).toHaveBeenCalled();
    expect(host.streamingUI.finalizeTurn).toHaveBeenCalledTimes(1);
  });
});

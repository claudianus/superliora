import { describe, expect, it, vi } from 'vitest';

import type { Event } from '@superliora/sdk';

import { SessionEventHandler } from '#/tui/controllers/session-event-handler';
import { getBuiltInPalette } from '#/tui/theme';

function makeHost() {
  const host = {
    state: {
      appState: {
        sessionId: 's1',
        streamingPhase: 'waiting',
        model: 'kimi-model',
        permissionMode: 'auto',
        planMode: false,
        ultraworkMode: false,
      },
      queuedMessages: [],
      theme: { palette: getBuiltInPalette('dark') },
      toolOutputExpanded: false,
      todoPanel: { getTodos: vi.fn(() => []) },
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    session: {
      setSwarmMode: vi.fn(async () => undefined),
      setPlanMode: vi.fn(async () => undefined),
      setPremiumQuality: vi.fn(async () => undefined),
      getUltraworkRun: vi.fn(async () => null),
    },
    aborted: false,
    sessionEventUnsubscribe: undefined,
    streamingUI: {
      setTurnId: vi.fn(),
      flushNow: vi.fn(),
      resetToolUi: vi.fn(),
      finalizeTurn: vi.fn(),
      hasThinkingDraft: vi.fn(() => false),
      flushThinkingToTranscript: vi.fn(),
      appendAssistantDelta: vi.fn(),
      scheduleFlush: vi.fn(),
    },
    motionBeats: {
      play: vi.fn(),
      active: vi.fn(),
      clear: vi.fn(),
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

function retryingEvent(overrides: Partial<Extract<Event, { type: 'turn.step.retrying' }>> = {}) {
  return {
    type: 'turn.step.retrying',
    agentId: 'main',
    sessionId: 's1',
    turnId: 1,
    step: 1,
    failedAttempt: 1,
    nextAttempt: 2,
    maxAttempts: 3,
    delayMs: 1500,
    errorName: 'OverloadedError',
    errorMessage: 'server is overloaded',
    statusCode: 529,
    ...overrides,
  } satisfies Event;
}

describe('SessionEventHandler step retry feedback', () => {
  it('surfaces step retries as a transient warning status line', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(retryingEvent(), vi.fn());

    expect(host.showStatus).toHaveBeenCalledTimes(1);
    const [message, color] = host.showStatus.mock.calls[0] as [string, string];
    expect(color).toBe('warning');
    expect(message).toContain('Retrying step 1');
    expect(message).toContain('attempt 2/3');
    expect(message).toContain('OverloadedError');
    expect(message).toContain('server is overloaded');
    expect(message).toContain('next attempt in 1.5s');
  });

  it('keeps the status readable when the error message is empty', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(retryingEvent({ errorMessage: '' }), vi.fn());

    const [message] = host.showStatus.mock.calls[0] as [string];
    expect(message).toContain('after OverloadedError');
    expect(message).not.toContain('undefined');
    expect(message).not.toContain(': ');
  });

  it('omits the backoff hint when there is no delay', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(retryingEvent({ delayMs: 0 }), vi.fn());

    const [message] = host.showStatus.mock.calls[0] as [string];
    expect(message).not.toContain('next attempt in');
  });

  it('truncates long error messages so the status stays one glance', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);
    const longMessage = `x`.repeat(200);

    handler.handleEvent(retryingEvent({ errorMessage: longMessage }), vi.fn());

    const [message] = host.showStatus.mock.calls[0] as [string];
    expect(message).toContain('…');
    expect(message.length).toBeLessThan(200);
  });
});

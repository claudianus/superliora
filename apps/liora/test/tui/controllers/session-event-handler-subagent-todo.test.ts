import { describe, expect, it, vi } from 'vitest';

import type { Event } from '@superliora/sdk';

import { SessionEventHandler } from '#/tui/controllers/session-event/handler';
import { getBuiltInPalette } from '#/tui/theme';

/**
 * Mission Control routing seam: every session event — `subagent.todo.updated`
 * included — must reach the Mission Control controller, and session resets
 * must clear its roster. The host mock mirrors
 * session-event-handler-turn.test.ts; the controller is a spy so the
 * assertions stay on the wiring (the registry itself is covered by
 * test/tui/controllers/mission-control-registry.test.ts).
 */
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
      todoPanel: {
        getTodos: vi.fn(() => []),
      },
      transcriptContainer: { addChild: vi.fn(), isBatchMounting: false },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    session: undefined,
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
    missionControl: {
      handleEvent: vi.fn(),
      reset: vi.fn(),
    },
    requireSession: vi.fn(),
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
    setLastTurnFailed: vi.fn(),
    updateActivityPane: vi.fn(),
    updateTerminalTitle: vi.fn(),
    btwPanelController: { routeEvent: vi.fn(() => false) },
    tasksBrowserController: {},
  };
  return host as any;
}

function todoUpdatedEvent(): Event {
  return {
    // Parent-emitted, so the session stamps the main agent id.
    agentId: 'main',
    sessionId: 's1',
    type: 'subagent.todo.updated',
    subagentId: 'sub-1',
    subagentName: 'explore',
    parentToolCallId: 'call-1',
    todos: [
      { title: 'find code', status: 'done' },
      { title: 'summarize', status: 'in_progress' },
      { title: 'report', status: 'pending' },
    ],
  } as Event;
}

describe('SessionEventHandler Mission Control feed', () => {
  it('feeds subagent.todo.updated into Mission Control', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);
    const event = todoUpdatedEvent();

    handler.handleEvent(event, vi.fn());

    expect(host.missionControl.handleEvent).toHaveBeenCalledWith(event);
  });

  it('feeds subagent lifecycle events into Mission Control', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);
    const event = {
      agentId: 'main',
      sessionId: 's1',
      type: 'subagent.completed',
      subagentId: 'sub-1',
      resultSummary: 'done',
    } as Event;

    handler.handleEvent(event, vi.fn());

    expect(host.missionControl.handleEvent).toHaveBeenCalledWith(event);
  });

  it('resets Mission Control when runtime state resets between sessions', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.resetRuntimeState();

    expect(host.missionControl.reset).toHaveBeenCalledTimes(1);
  });
});

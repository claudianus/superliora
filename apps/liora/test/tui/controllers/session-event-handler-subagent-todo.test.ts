import { describe, expect, it, vi } from 'vitest';

import type { Event } from '@superliora/sdk';

import { SessionEventHandler } from '#/tui/controllers/session-event-handler';
import { getBuiltInPalette } from '#/tui/theme';

/**
 * Phase 5-B routing seam: `subagent.todo.updated` must reach the Todo Board
 * strip, and lifecycle completion/failure must remove the row. The host mock
 * mirrors session-event-handler-turn.test.ts; the todo panel is a spy so the
 * assertions stay on the wiring, not the component (covered separately in
 * test/tui/components/chrome/todo-panel.test.ts).
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
        setSubagentTodos: vi.fn(),
        removeSubagent: vi.fn(() => false),
        clearSubagents: vi.fn(),
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

describe('SessionEventHandler subagent todo routing', () => {
  it('routes subagent.todo.updated onto the Todo Board strip', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(todoUpdatedEvent(), vi.fn());

    expect(host.state.todoPanel.setSubagentTodos).toHaveBeenCalledTimes(1);
    expect(host.state.todoPanel.setSubagentTodos).toHaveBeenCalledWith({
      subagentId: 'sub-1',
      name: 'explore',
      todos: [
        { title: 'find code', status: 'done' },
        { title: 'summarize', status: 'in_progress' },
        { title: 'report', status: 'pending' },
      ],
    });
    // The strip update requests a layout frame.
    expect(host.state.renderer.invalidateFrame).toHaveBeenCalledWith('layout');
  });

  it('removes the strip row when the subagent completes', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(todoUpdatedEvent(), vi.fn());
    handler.handleEvent(
      {
        agentId: 'main',
        sessionId: 's1',
        type: 'subagent.completed',
        subagentId: 'sub-1',
        resultSummary: 'done',
      } as Event,
      vi.fn(),
    );

    expect(host.state.todoPanel.removeSubagent).toHaveBeenCalledWith('sub-1');
  });

  it('removes the strip row when the subagent fails', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(todoUpdatedEvent(), vi.fn());
    handler.handleEvent(
      {
        agentId: 'main',
        sessionId: 's1',
        type: 'subagent.failed',
        subagentId: 'sub-1',
        error: 'boom',
      } as Event,
      vi.fn(),
    );

    expect(host.state.todoPanel.removeSubagent).toHaveBeenCalledWith('sub-1');
  });

  it('clears the strip when runtime state resets between sessions', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(todoUpdatedEvent(), vi.fn());
    handler.subAgentEventHandler.resetRuntimeState();

    expect(host.state.todoPanel.clearSubagents).toHaveBeenCalledTimes(1);
  });
});

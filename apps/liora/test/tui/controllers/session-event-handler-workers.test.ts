import { describe, expect, it, vi } from 'vitest';

import type { Event } from '@superliora/sdk';

import { SessionEventHandler } from '#/tui/controllers/session-event/handler';
import { getBuiltInPalette } from '#/tui/theme';

/** Live child activity reaches the worker dock, including transcript-routed deltas. */
function makeHost() {
  const host = {
    state: {
      appState: {
        sessionId: 's1',
        streamingPhase: 'waiting',
        model: 'kimi-model',
        permissionMode: 'auto',
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
    workerDock: {
      handleEvent: vi.fn(),
      reset: vi.fn(),
    },
    controlTowerDesk: {
      handleUpdated: vi.fn(),
      handleInbox: vi.fn(),
      handleSubagentProgress: vi.fn(),
      handleSubagentToolCall: vi.fn(),
      handleSubagentToolResult: vi.fn(),
      handleSubagentToolProgress: vi.fn(),
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

describe('SessionEventHandler Mission Control feed', () => {
  it('routes operator Job snapshots and inbox updates to the desk and worker dock', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);
    const updated = {
      type: 'job.updated',
      agentId: 'main',
      sessionId: 's1',
      schemaVersion: 3,
      job: { id: 'job-1', title: 'Run shell work', status: 'running', kind: 'task', priority: 1 },
    } as Event;
    const inbox = {
      type: 'job.inbox',
      agentId: 'main',
      sessionId: 's1',
      schemaVersion: 3,
      eventId: 'inbox-1',
      jobId: 'job-1',
      kind: 'job.completed',
      title: 'Run shell work completed',
      summary: 'Shell command exited successfully',
    } as Event;

    handler.handleEvent(updated, vi.fn());
    handler.handleEvent(inbox, vi.fn());

    expect(host.controlTowerDesk.handleUpdated).toHaveBeenCalledWith(updated);
    expect(host.controlTowerDesk.handleInbox).toHaveBeenCalledWith(inbox);
    expect(host.workerDock.handleEvent).toHaveBeenCalledWith(updated);
    expect(host.workerDock.handleEvent).toHaveBeenCalledWith(inbox);
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

    expect(host.workerDock.handleEvent).toHaveBeenCalledWith(event);
  });

  it('resets Mission Control when runtime state resets between sessions', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.resetRuntimeState();

    expect(host.workerDock.reset).toHaveBeenCalledTimes(1);
  });

  it('feeds child thinking/assistant deltas into Mission Control after transcript routing', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);
    // Child agentId ≠ main → routeChildAgentEvent consumes the event for the
    // transcript path; Mission Control must still see it (wiring under test).

    const thinking = {
      agentId: 'sub-1',
      sessionId: 's1',
      type: 'thinking.delta',
      delta: 'checking Phaser docs',
    } as Event;
    handler.handleEvent(thinking, vi.fn());
    expect(host.workerDock.handleEvent).toHaveBeenCalledWith(thinking);

    const answer = {
      agentId: 'sub-1',
      sessionId: 's1',
      type: 'assistant.delta',
      delta: 'Metal slug uses run-and-gun',
    } as Event;
    handler.handleEvent(answer, vi.fn());
    expect(host.workerDock.handleEvent).toHaveBeenCalledWith(answer);
  });

  it('routes subagent.tool_progress to Job Desk and Worker Dock', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);
    const event = {
      agentId: 'main',
      sessionId: 's1',
      type: 'subagent.tool_progress',
      subagentId: 'sub-1',
      toolCallId: 'tc-1',
      name: 'Bash',
      kind: 'stdout',
      textPreview: '12 passing',
    } as Event;

    handler.handleEvent(event, vi.fn());

    expect(host.controlTowerDesk.handleSubagentToolProgress).toHaveBeenCalledWith(event);
    expect(host.workerDock.handleEvent).toHaveBeenCalledWith(event);
  });
});

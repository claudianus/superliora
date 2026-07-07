import { describe, expect, it, vi } from 'vitest';

import type { Event } from '@superliora/sdk';

import { SessionEventHandler } from '#/tui/controllers/session-event-handler';
import { getBuiltInPalette } from '#/tui/theme';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

interface TestComponent {
  render(width: number): string[];
}

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
    session: {},
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
    requireSession: vi.fn(() => ({})),
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

function renderedTheatre(host: ReturnType<typeof makeHost>): string {
  const component = host.state.transcriptContainer.addChild.mock.calls.at(-1)?.[0] as
    | TestComponent
    | undefined;
  return stripAnsi(component?.render(100).join('\n') ?? '');
}

describe('SessionEventHandler Ultrawork theatre events', () => {
  it('keeps Ultrawork mode visible when UltraPlan exits into execution', () => {
    const host = makeHost();
    host.state.appState.planMode = true;
    host.state.appState.ultraworkMode = true;
    const handler = new SessionEventHandler(host);

    handler.handleEvent({
      type: 'agent.status.updated',
      agentId: 'main',
      sessionId: 's1',
      planMode: false,
    } satisfies Event, vi.fn());

    expect(host.setAppState).toHaveBeenCalledWith({ planMode: false });
  });

  it('renders one live theatre panel and updates it across research, team, verify, and learn', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent({
      type: 'ultrawork.stage.changed',
      agentId: 'main',
      sessionId: 's1',
      from: 'plan',
      to: 'research',
      reason: 'latest API knowledge needed',
      run: {
        id: 'uw_1',
        objective: 'Ship current-library feature',
        status: 'running',
        stage: 'research',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:01.000Z',
      },
    } satisfies Event, vi.fn());

    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledTimes(1);
    expect(renderedTheatre(host)).toContain('Ultrawork');
    expect(renderedTheatre(host)).toContain('research');

    handler.handleEvent({
      type: 'ultrawork.research.started',
      agentId: 'main',
      sessionId: 's1',
      runId: 'uw_1',
      topic: 'Ship current-library feature',
      backends: [
        {
          id: 'local',
          kind: 'local_research_stack',
          role: 'assist',
          status: 'selected',
          label: 'LocalResearchStack',
        },
      ],
    } satisfies Event, vi.fn());

    handler.handleEvent({
      type: 'ultrawork.team.staffed',
      agentId: 'main',
      sessionId: 's1',
      runId: 'uw_1',
      toolCallId: 'call_ultra_swarm',
      team: {
        id: 'team_1',
        runId: 'uw_1',
        intensity: 'premium',
        maxExperts: 24,
        experts: [
          {
            id: 'security-reviewer',
            name: 'Security Reviewer',
            role: 'security',
            focus: 'review',
            status: 'queued',
            division: 'security',
            coverageLane: 'security_privacy',
            selectionReason: 'Covers auth and data handling risk.',
          },
        ],
      },
    } satisfies Event, vi.fn());

    handler.handleEvent({
      type: 'ultrawork.verification.completed',
      agentId: 'main',
      sessionId: 's1',
      runId: 'uw_1',
      verification: {
        id: 'verify_1',
        runId: 'uw_1',
        status: 'passed',
        checks: [{ name: 'typecheck', status: 'passed' }],
        completedAt: '2026-07-01T00:00:02.000Z',
      },
    } satisfies Event, vi.fn());

    handler.handleEvent({
      type: 'ultrawork.knowledge.promoted',
      agentId: 'main',
      sessionId: 's1',
      runId: 'uw_1',
      promotion: {
        id: 'learn_1',
        runId: 'uw_1',
        target: 'llm_wiki',
        findingId: 'finding_1',
        title: 'Verified current API behavior',
        promotedAt: '2026-07-01T00:00:03.000Z',
        sourceEvidenceIds: ['evidence_1'],
      },
    } satisfies Event, vi.fn());

    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledTimes(1);
    expect(renderedTheatre(host)).toContain('Ultrawork');
    expect(renderedTheatre(host)).toContain('Ship current-library feature');
    expect(renderedTheatre(host)).toContain('LocalResearchStack');
    expect(renderedTheatre(host)).toContain('1 expert');
    expect(renderedTheatre(host)).toContain('verify passed');
    expect(renderedTheatre(host)).toContain('1 saved');
  });

  it('turns off Ultrawork mode and shows a completion marker when the run reaches done', () => {
    const setPlanMode = vi.fn(async () => {});
    const host = makeHost();
    host.requireSession = vi.fn(() => ({ setPlanMode }));
    host.state.appState.ultraworkMode = true;
    host.state.appState.planMode = true;
    host.state.appState.swarmMode = true;
    host.state.swarmModeEntry = 'ultrawork';
    const handler = new SessionEventHandler(host);

    handler.handleEvent({
      type: 'ultrawork.stage.changed',
      agentId: 'main',
      sessionId: 's1',
      from: 'learn',
      to: 'done',
      reason: 'Ultrawork completed',
      run: {
        id: 'uw_done',
        objective: 'Ship feature X',
        status: 'done',
        stage: 'done',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:04.000Z',
      },
    } satisfies Event, vi.fn());

    expect(host.setAppState).toHaveBeenCalledWith({
      ultraworkMode: false,
      planMode: false,
      activityTip: null,
      swarmMode: false,
    });
    expect(setPlanMode).toHaveBeenCalledWith(false, false);
    expect(host.state.swarmModeEntry).toBeUndefined();
    expect(host.showNotice).toHaveBeenCalledWith(
      'Ultrawork completed',
      expect.stringContaining('Ship feature X'),
      expect.objectContaining({ coalesceKey: 'ultrawork-completed:uw_done' }),
    );
    const markerText = host.state.transcriptContainer.addChild.mock.calls
      .map((call) => stripAnsi((call[0] as TestComponent | undefined)?.render(100).join('\n') ?? ''))
      .join('\n');
    expect(markerText).toContain('Ultrawork completed');
  });

  it('does not render Swarm ended when Ultrawork-owned swarm mode turns off', () => {
    const host = makeHost();
    host.state.appState.swarmMode = true;
    host.state.appState.ultraworkMode = true;
    host.state.swarmModeEntry = 'ultrawork';
    const handler = new SessionEventHandler(host);

    handler.handleEvent(
      {
        type: 'agent.status.updated',
        agentId: 'main',
        sessionId: 's1',
        swarmMode: false,
      } as Event,
      vi.fn(),
    );

    expect(host.state.transcriptContainer.addChild).not.toHaveBeenCalled();
    expect(host.state.swarmModeEntry).toBeUndefined();
  });
});

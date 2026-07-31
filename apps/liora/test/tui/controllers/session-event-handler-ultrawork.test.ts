import { describe, expect, it, vi } from 'vitest';

import type { Event } from '@superliora/sdk';

import { SessionEventHandler } from '#/tui/controllers/session-event/handler';
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

function renderedTheatre(host: ReturnType<typeof makeHost>): string {
  const component = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
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

  it('accepts mission.stage.changed alias and routes to Ultrawork theatre', () => {
    const host = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent({
      type: 'mission.stage.changed',
      agentId: 'main',
      sessionId: 's1',
      from: 'intake',
      to: 'plan',
      run: {
        id: 'uw_mission_alias',
        objective: 'Mission alias smoke',
        status: 'running',
        stage: 'plan',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:01.000Z',
      },
    } as unknown as Event, vi.fn());

    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledTimes(1);
    expect(renderedTheatre(host)).toContain('plan');
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
    expect(renderedTheatre(host)).toContain('Mission');
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
    expect(renderedTheatre(host)).toContain('Mission');
    expect(renderedTheatre(host)).toContain('Ship current-library feature');
    expect(renderedTheatre(host)).toContain('LocalResearchStack');
    expect(renderedTheatre(host)).toContain('1 expert');
    expect(renderedTheatre(host)).toContain('verify passed');
    expect(renderedTheatre(host)).toContain('1 saved');
  });

  it('turns off Ultrawork mode and shows a completion marker when the run reaches done', () => {
    const host = makeHost();
    // Keep full session mocks so finishUltraworkRun can restore swarm/premium.
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
      swarmMode: false,
      premiumQualityMode: false,
      activityTip: null,
      ultraworkPriorState: null,
    });
    expect(host.session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(host.session.setSwarmMode).toHaveBeenCalledWith(false, 'task');
    expect(host.session.setPremiumQuality).toHaveBeenCalledWith(false);
    expect(host.state.swarmModeEntry).toBeUndefined();
    expect(host.showNotice).toHaveBeenCalledWith(
      'Mission completed',
      expect.stringContaining('Ship feature X'),
      expect.objectContaining({ coalesceKey: 'ultrawork-completed:uw_done' }),
    );
    const markerText = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => stripAnsi((call[0] as TestComponent | undefined)?.render(100).join('\n') ?? ''))
      .join('\n');
    expect(markerText).toContain('Mission completed');
  });

  it('restores prior state when a cancelled run emits the terminal failed stage event', () => {
    const host = makeHost();
    host.state.appState.planMode = true;
    host.state.appState.swarmMode = true;
    host.state.appState.ultraworkMode = true;
    host.state.swarmModeEntry = 'ultrawork';
    const handler = new SessionEventHandler(host);

    // cancel() emits stage-changed with an unchanged stage but
    // run.status === 'failed'; that terminal marker must trigger the same
    // finishUltraworkRun restore as to='done'.
    handler.handleEvent({
      type: 'ultrawork.stage.changed',
      agentId: 'main',
      sessionId: 's1',
      from: 'plan',
      to: 'plan',
      reason: 'Cancelled by user',
      run: {
        id: 'uw_cancel',
        objective: 'Ship feature X',
        status: 'failed',
        stage: 'plan',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:04.000Z',
      },
    } satisfies Event, vi.fn());

    expect(host.setAppState).toHaveBeenCalledWith({
      ultraworkMode: false,
      planMode: false,
      swarmMode: false,
      premiumQualityMode: false,
      activityTip: null,
      ultraworkPriorState: null,
    });
    expect(host.session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(host.session.setSwarmMode).toHaveBeenCalledWith(false, 'task');
    expect(host.session.setPremiumQuality).toHaveBeenCalledWith(false);
    expect(host.showNotice).toHaveBeenCalledWith(
      'Mission ended',
      expect.stringContaining('Cancelled by user'),
      expect.objectContaining({ coalesceKey: 'ultrawork-completed:uw_cancel' }),
    );
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
      } as unknown as Event,
      vi.fn(),
    );

    expect(host.state.transcriptContainer.addChild).not.toHaveBeenCalled();
    expect(host.state.swarmModeEntry).toBeUndefined();
  });

  it('routes collaboration message/mention only to active swarm progress feed', () => {
    const host = makeHost();
    const children: Array<{ render(width: number): string[] }> = [];
    host.state.transcriptContainer.addChild = vi.fn((child: { render(width: number): string[] }) => {
      children.push(child);
    });
    host.state.transcriptContainer.children = children;
    host.state.transcriptContainer.invalidate = vi.fn();
    host.state.ui = {
      ...host.state.ui,
      children,
      terminal: { rows: 40, columns: 120 },
      requestRender: vi.fn(),
    };
    host.state.todoPanel.bumpActivity = vi.fn();
    host.streamingUI.getTurnContext = vi.fn(() => ({ turnId: 1, step: 0 }));
    host.streamingUI.registerToolCall = vi.fn();
    host.streamingUI.finalizeLiveTextBuffers = vi.fn();
    const handler = new SessionEventHandler(host);

    // Seed a theatre panel first (swarm stage hides its body).
    handler.handleEvent(
      {
        type: 'ultrawork.stage.changed',
        agentId: 'main',
        sessionId: 's1',
        from: 'staff',
        to: 'swarm',
        reason: 'team ready',
        run: {
          id: 'uw_feed',
          objective: 'Ship auth middleware',
          status: 'running',
          stage: 'swarm',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:01.000Z',
        },
      } satisfies Event,
      vi.fn(),
    );

    // Mount UltraSwarm progress via tool call start so collaboration has a sink.
    handler.handleEvent(
      {
        type: 'tool.call.started',
        agentId: 'main',
        sessionId: 's1',
        turnId: 1,
        toolCallId: 'call_ultra_swarm',
        name: 'UltraSwarm',
        args: {
          description: 'Ship auth middleware',
          items: [{ description: 'review auth', agent_type: 'coder' }],
        },
      } satisfies Event,
      vi.fn(),
    );

    const collaborationMessage = {
      id: 'msg_shared_1',
      runId: 'uw_feed',
      parentToolCallId: 'call_ultra_swarm',
      at: '2026-07-01T00:00:02.000Z',
      from: {
        expertId: 'security-appsec-engineer',
        agentId: 'agent_sec',
        name: 'AppSec Engineer',
        emoji: '🔒',
      },
      to: { expertId: 'impl-engineer' },
      channel: 'direct' as const,
      kind: 'mention' as const,
      body: 'Need auth review before merge',
    };

    handler.handleEvent(
      {
        type: 'ultrawork.collaboration.message',
        agentId: 'main',
        sessionId: 's1',
        runId: 'uw_feed',
        message: collaborationMessage,
      } satisfies Event,
      vi.fn(),
    );
    handler.handleEvent(
      {
        type: 'ultrawork.collaboration.mention',
        agentId: 'main',
        sessionId: 's1',
        runId: 'uw_feed',
        message: collaborationMessage,
        mentionExpertIds: ['impl-engineer'],
      } satisfies Event,
      vi.fn(),
    );

    const transcript = children
      .map((child) => stripAnsi(child.render(120).join('\n')))
      .join('\n');
    const bodyHits = transcript.match(/Need auth review before merge/g) ?? [];
    expect(bodyHits).toHaveLength(1);
    // Swarm stage hides theatre; only swarm progress should show the body.
    expect(transcript).toContain('war room');
  });

  it('skips theatre applyEvent when swarm owns collaboration message/mention (single-sink)', () => {
    const host = makeHost();
    type TranscriptChild = {
      render(width: number): string[];
      applyEvent?: (...args: unknown[]) => unknown;
    };
    const children: TranscriptChild[] = [];
    host.state.transcriptContainer.addChild = vi.fn((child: TranscriptChild) => {
        if (typeof child.applyEvent === 'function') {
          const original = child.applyEvent;
          child.applyEvent = vi.fn((...args: unknown[]) => original.apply(child, args));
        }
        children.push(child);
      },
    );
    host.state.transcriptContainer.children = children;
    host.state.transcriptContainer.invalidate = vi.fn();
    host.state.ui = {
      ...host.state.ui,
      children,
      terminal: { rows: 40, columns: 120 },
      requestRender: vi.fn(),
    };
    host.state.todoPanel.bumpActivity = vi.fn();
    host.streamingUI.getTurnContext = vi.fn(() => ({ turnId: 1, step: 0 }));
    host.streamingUI.registerToolCall = vi.fn();
    host.streamingUI.finalizeLiveTextBuffers = vi.fn();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(
      {
        type: 'ultrawork.stage.changed',
        agentId: 'main',
        sessionId: 's1',
        from: 'staff',
        to: 'research',
        reason: 'single-sink regression',
        run: {
          id: 'uw_single_sink',
          objective: 'Prove collaboration single-sink',
          status: 'running',
          stage: 'research',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:01.000Z',
        },
      } satisfies Event,
      vi.fn(),
    );

    const theatre = children.find((child) => typeof child.applyEvent === 'function');
    expect(theatre).toBeDefined();
    const theatreApply = theatre!.applyEvent as ReturnType<typeof vi.fn>;
    // Stage seed already applied once in the constructor path; clear for collaboration asserts.
    theatreApply.mockClear();

    handler.handleEvent(
      {
        type: 'tool.call.started',
        agentId: 'main',
        sessionId: 's1',
        turnId: 1,
        toolCallId: 'call_ultra_swarm_sink',
        name: 'UltraSwarm',
        args: {
          description: 'Single sink swarm',
          items: [{ description: 'route collab', agent_type: 'coder' }],
        },
      } satisfies Event,
      vi.fn(),
    );

    const collaborationMessage = {
      id: 'msg_single_sink_1',
      runId: 'uw_single_sink',
      parentToolCallId: 'call_ultra_swarm_sink',
      at: '2026-07-01T00:00:02.000Z',
      from: {
        expertId: 'security-appsec-engineer',
        agentId: 'agent_sec',
        name: 'AppSec Engineer',
        emoji: '🔒',
      },
      to: { expertId: 'impl-engineer' },
      channel: 'direct' as const,
      kind: 'status' as const,
      body: 'Single-sink body must not dual-paint',
    };

    handler.handleEvent(
      {
        type: 'ultrawork.collaboration.message',
        agentId: 'main',
        sessionId: 's1',
        runId: 'uw_single_sink',
        message: collaborationMessage,
      } satisfies Event,
      vi.fn(),
    );
    handler.handleEvent(
      {
        type: 'ultrawork.collaboration.mention',
        agentId: 'main',
        sessionId: 's1',
        runId: 'uw_single_sink',
        message: {
          ...collaborationMessage,
          id: 'msg_single_sink_2',
          kind: 'mention' as const,
          body: 'Single-sink mention body',
        },
        mentionExpertIds: ['impl-engineer'],
      } satisfies Event,
      vi.fn(),
    );

    // Regression: when swarm owns the collab feed, theatre must not receive applyEvent.
    expect(theatreApply).not.toHaveBeenCalled();

    const transcript = children
      .map((child) => stripAnsi(child.render(120).join('\n')))
      .join('\n');
    expect(transcript).toContain('Single-sink body must not dual-paint');
    expect(transcript).toContain('Single-sink mention body');
    expect(transcript).toContain('war room');
  });

  it('keeps debate/steer on swarm sink only while live UltraSwarm owns the feed', () => {
    const host = makeHost();
    type TranscriptChild = {
      render(width: number): string[];
      applyEvent?: (...args: unknown[]) => unknown;
    };
    const children: TranscriptChild[] = [];
    host.state.transcriptContainer.addChild = vi.fn((child: TranscriptChild) => {
        if (typeof child.applyEvent === 'function') {
          const original = child.applyEvent;
          child.applyEvent = vi.fn((...args: unknown[]) => original.apply(child, args));
        }
        children.push(child);
      },
    );
    host.state.transcriptContainer.children = children;
    host.state.transcriptContainer.invalidate = vi.fn();
    host.state.ui = {
      ...host.state.ui,
      children,
      terminal: { rows: 40, columns: 120 },
      requestRender: vi.fn(),
    };
    host.state.todoPanel.bumpActivity = vi.fn();
    host.streamingUI.getTurnContext = vi.fn(() => ({ turnId: 1, step: 0 }));
    host.streamingUI.registerToolCall = vi.fn();
    host.streamingUI.finalizeLiveTextBuffers = vi.fn();
    const handler = new SessionEventHandler(host);

    // Non-swarm stage so theatre would paint debate if applyEvent were called.
    handler.handleEvent(
      {
        type: 'ultrawork.stage.changed',
        agentId: 'main',
        sessionId: 's1',
        from: 'staff',
        to: 'verify',
        reason: 'debate single-sink',
        run: {
          id: 'uw_debate_sink',
          objective: 'Debate single-sink',
          status: 'running',
          stage: 'verify',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:01.000Z',
        },
      } satisfies Event,
      vi.fn(),
    );

    const theatre = children.find((child) => typeof child.applyEvent === 'function');
    expect(theatre).toBeDefined();
    const theatreApply = theatre!.applyEvent as ReturnType<typeof vi.fn>;
    theatreApply.mockClear();

    handler.handleEvent(
      {
        type: 'tool.call.started',
        agentId: 'main',
        sessionId: 's1',
        turnId: 1,
        toolCallId: 'call_ultra_swarm_debate',
        name: 'UltraSwarm',
        args: {
          description: 'Debate sink swarm',
          items: [{ description: 'argue path', agent_type: 'reviewer' }],
        },
      } satisfies Event,
      vi.fn(),
    );

    const debateText = 'Reject untested auth middleware merge';
    const steerText = 'Focus on OAuth callback edge cases';

    handler.handleEvent(
      {
        type: 'ultrawork.collaboration.debate',
        agentId: 'main',
        sessionId: 's1',
        runId: 'uw_debate_sink',
        debateId: 'deb_1',
        workNodeId: 'node_auth',
        phase: 'critic',
        expertId: 'security-appsec-engineer',
        expertName: 'AppSec Engineer',
        text: debateText,
        stance: 'oppose',
      } satisfies Event,
      vi.fn(),
    );
    handler.handleEvent(
      {
        type: 'ultrawork.collaboration.steer',
        agentId: 'main',
        sessionId: 's1',
        runId: 'uw_debate_sink',
        debateId: 'deb_1',
        text: steerText,
        fromUser: true,
      } satisfies Event,
      vi.fn(),
    );

    expect(theatreApply).not.toHaveBeenCalled();

    const transcript = children
      .map((child) => stripAnsi(child.render(120).join('\n')))
      .join('\n');
    expect(transcript).toContain(debateText);
    expect(transcript).toContain(steerText);
    // Theatre must not paint debate while swarm owns the sink (non-swarm stage would show it).
    const theatreOnly = stripAnsi(theatre!.render(120).join('\n'));
    expect(theatreOnly).not.toContain(debateText);
    expect(theatreOnly).not.toContain(steerText);
  });
});

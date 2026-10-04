import { AsyncLocalStorage } from 'node:async_hooks';

import type {
  AgentReplayRecord,
  BackgroundTaskInfo,
  ContentPart,
  PromptOrigin,
  ResumedAgentState,
  Role,
  Session,
  ToolCall,
} from '@superliora/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { LioraTUI, type LioraTUIStartupInput, type TUIState } from '#/tui/liora-tui';
import type { SessionEventHandler } from '#/tui/controllers/session-event/handler';
import type { StreamingUIController } from '#/tui/controllers/streaming-ui/index';
import { setActiveAppearancePreferences } from '#/tui/features/appearance/appearance-effects';
import { AgentGroupComponent } from '#/tui/components/messages/agent-group';
import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import {
  REPLAY_MAX_TOOL_MOUNTS_PER_TURN,
  REPLAY_TURN_LIMIT,
  countReplayUserTurns,
  limitReplayRecordsByTurn,
} from '#/tui/utils/session/message-replay';

vi.mock('#/utils/open-url', () => ({ openUrl: vi.fn() }));

const REPLAY_TIME = 1_700_000_000_000;

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

/** Full painted replay. `transcriptContainer.render` is a viewport slice. */
function paintedReplay(driver: ReplayDriver, width = 140): string {
  return stripAnsi(
    driver.state.transcriptContainer.children.flatMap((child) => child.render(width)).join('\n'),
  );
}

interface ReplayDriver {
  readonly state: TUIState;
  readonly streamingUI: StreamingUIController;
  readonly sessionEventHandler: SessionEventHandler;
  init(): Promise<boolean>;
  switchToSession(session: Session, statusMessage: string): Promise<void>;
  isSessionLoadingOverlayActive(): boolean;
}

function makeStartupInput(): LioraTUIStartupInput {
  return {
    cliOptions: {
      session: undefined,
      continue: false,
      yolo: false,
      auto: false,
      model: undefined,
      outputFormat: undefined,
      prompt: undefined,
    },
    tuiConfig: {
      theme: 'dark',
      locale: 'auto',
      performanceMode: 'off',
      permissionMode: 'yolo',
      disablePasteBurst: false,
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
      upgrade: { autoInstall: true },
    },
    version: '0.0.0-test',
    workDir: '/tmp/proj-a',
  };
}

function message(
  role: Role,
  content: readonly ContentPart[],
  extra: {
    readonly toolCalls?: readonly ToolCall[];
    readonly toolCallId?: string;
    readonly origin?: PromptOrigin;
    readonly isError?: boolean;
  } = {},
): AgentReplayRecord {
  return {
    time: REPLAY_TIME,
    type: 'message',
    message: {
      role,
      content: [...content],
      toolCalls: [...(extra.toolCalls ?? [])],
      toolCallId: extra.toolCallId,
      origin: extra.origin,
      isError: extra.isError,
    },
  };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return {
    type: 'function',
    id,
    name,
    arguments: JSON.stringify(args),
  };
}

function baseAgentState(
  replay: readonly AgentReplayRecord[],
  overrides: Partial<ResumedAgentState> = {},
): ResumedAgentState {
  return {
    type: 'main',
    config: {
      cwd: '/tmp/proj-a',
      modelAlias: 'k2',
      provider: undefined,
      modelCapabilities: {
        image_in: false,
        video_in: false,
        audio_in: false,
        pdf_in: false,
        thinking: false,
        tool_use: true,
        max_context_tokens: 100,
      },
      thinkingLevel: 'off',
      systemPrompt: '',
    },
    context: { history: [], tokenCount: 0 },
    replay,
    permission: { mode: 'manual', rules: [] },
    usage: {},
    background: [],
    ...overrides,
  };
}

function makeSession(
  replay: readonly AgentReplayRecord[],
  overrides: Partial<ResumedAgentState> = {},
): Session {
  const agent = baseAgentState(replay, overrides);
  return {
    id: 'ses-replay',
    model: 'k2',
    summary: { title: null },
    getStatus: vi.fn(async () => ({
      model: 'k2',
      thinkingLevel: 'off',
      permission: 'manual',
      contextTokens: 0,
      maxContextTokens: 100,
      contextUsage: 0,
    })),
    setApprovalHandler: vi.fn(),
    setQuestionHandler: vi.fn(),
    setCredentialHandler: vi.fn(),
    setModel: vi.fn(async () => {}),
    setThinking: vi.fn(async () => {}),
    setPermission: vi.fn(async () => {}),
    onEvent: vi.fn(() => vi.fn()),
    getResumeState: vi.fn(() => ({
      sessionMetadata: {},
      agents: { main: agent },
    })),
    close: vi.fn(async () => {}),
  } as unknown as Session;
}

function makeHarness(initialSession: Session) {
  const interactiveAgentScope = new AsyncLocalStorage<string>();
  return {
    getConfig: vi.fn(async () => ({
      models: {
        k2: { model: 'moonshot-v1', maxContextSize: 100 },
      },
    })),
    setConfig: vi.fn(async () => ({ providers: {} })),
    createSession: vi.fn(async () => initialSession),
    resumeSession: vi.fn(async () => initialSession),
    forkSession: vi.fn(async () => initialSession),
    listSessions: vi.fn(async () => []),
    close: vi.fn(async () => {}),
    track: vi.fn(),
    setTelemetryContext: vi.fn(),
    getExperimentalFeatures: vi.fn(async () => []),
    onIndependentSessionActivity: vi.fn(() => () => {}),
    get interactiveAgentId() {
      return interactiveAgentScope.getStore() ?? 'main';
    },
    withInteractiveAgent: vi.fn((agentId: string, fn: () => unknown) => {
      return interactiveAgentScope.run(agentId, fn);
    }),
    auth: {
      status: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getManagedUsage: vi.fn(),
      submitFeedback: vi.fn(async () => ({ kind: 'ok', feedbackId: 3 })),
    },
  };
}

async function makeDriver(initialSession: Session): Promise<ReplayDriver> {
  const driver = new LioraTUI(
    makeHarness(initialSession) as never,
    makeStartupInput(),
  ) as unknown as ReplayDriver;
  vi.spyOn(driver.state.ui, 'requestRender').mockImplementation(() => {});
  vi.spyOn(driver.state.terminal, 'setProgress').mockImplementation(() => {});
  await driver.init();
  return driver;
}

async function replayIntoDriver(
  replay: readonly AgentReplayRecord[],
  overrides: Partial<ResumedAgentState> = {},
): Promise<ReplayDriver> {
  const initial = makeSession([]);
  const resumed = makeSession(replay, overrides);
  const driver = await makeDriver(initial);
  await driver.switchToSession(resumed, 'Resumed session (ses-replay).');
  // init() reapplies default premium appearance. Pin off before callers
  // assert painted substrings — leftover motion (CI/NO_COLOR leak, clock)
  // replaces spaces with particle glyphs and breaks title checks.
  setActiveAppearancePreferences({
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'off',
    particles: 'off',
  });
  return driver;
}

function backgroundTask(
  taskId: string,
  description: string,
  status: BackgroundTaskInfo['status'] = 'running',
): BackgroundTaskInfo {
  if (taskId.startsWith('agent-')) {
    return {
      taskId,
      kind: 'agent',
      agentId: taskId,
      subagentType: 'coder',
      description,
      status,
      startedAt: 1,
      endedAt: status === 'running' ? null : 2,
    };
  }
  return {
    taskId,
    kind: 'process',
    command: `[agent] ${description}`,
    cwd: '/tmp/project',
    description,
    status,
    pid: 0,
    exitCode: status === 'completed' ? 0 : null,
    startedAt: 1,
    endedAt: status === 'running' ? null : 2,
  };
}

describe('limitReplayRecordsByTurn', () => {
  it('returns all records when user turns fit within the cap', () => {
    const records = [
      message('user', [{ type: 'text', text: 'a' }]),
      message('assistant', [{ type: 'text', text: 'A' }]),
      message('user', [{ type: 'text', text: 'b' }]),
      message('assistant', [{ type: 'text', text: 'B' }]),
    ];
    expect(limitReplayRecordsByTurn(records, 10)).toEqual(records);
    expect(countReplayUserTurns(records)).toBe(2);
  });

  it('keeps only the most recent N user turns when N >> cap', () => {
    const turnCount = REPLAY_TURN_LIMIT + 40;
    const records: AgentReplayRecord[] = [];
    for (let i = 0; i < turnCount; i++) {
      records.push(message('user', [{ type: 'text', text: `prompt ${i}` }]));
      records.push(message('assistant', [{ type: 'text', text: `reply ${i}` }]));
    }
    expect(countReplayUserTurns(records)).toBe(turnCount);

    const limited = limitReplayRecordsByTurn(records, REPLAY_TURN_LIMIT);
    expect(countReplayUserTurns(limited)).toBe(REPLAY_TURN_LIMIT);
    // Projection of a large fixture must not require keeping every message in the
    // render list — only the trailing window is projected.
    expect(limited.length).toBeLessThan(records.length);
    expect(limited.length).toBe(REPLAY_TURN_LIMIT * 2);

    const firstUser = limited.find(
      (record) => record.type === 'message' && record.message.role === 'user',
    );
    expect(firstUser?.type === 'message' ? firstUser.message.content : undefined).toEqual([
      { type: 'text', text: `prompt ${turnCount - REPLAY_TURN_LIMIT}` },
    ]);
    const lastAssistant = limited.at(-1);
    expect(
      lastAssistant?.type === 'message' ? lastAssistant.message.content : undefined,
    ).toEqual([{ type: 'text', text: `reply ${turnCount - 1}` }]);
  });

  it('returns empty when maxTurns is non-positive (never unbounded)', () => {
    const records = [message('user', [{ type: 'text', text: 'x' }])];
    expect(limitReplayRecordsByTurn(records, 0)).toEqual([]);
    expect(limitReplayRecordsByTurn(records, -3)).toEqual([]);
  });
});

describe('LioraTUI resume message replay', () => {
  beforeEach(() => {
    // Other liora files delete CI/NO_COLOR to test motion. Pin off so
    // substring asserts don't see entrance washes or interleaved SGR.
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
  });

  it('unescapes bash tag delimiters when replaying shell output', async () => {
    const driver = await replayIntoDriver([
      message(
        'user',
        [
          {
            type: 'text',
            text: '<bash-stdout>pre&lt;/bash-stdout&gt;post</bash-stdout><bash-stderr></bash-stderr>',
          },
        ],
        { origin: { kind: 'shell_command', phase: 'output' } },
      ),
    ]);

    const transcript = paintedReplay(driver);
    expect(transcript).toContain('pre</bash-stdout>post');
  });

  it('groups replayed SessionControl spawns without treating successful ACKs as completed children', async () => {
    const replay: AgentReplayRecord[] = [
      message('user', [{ type: 'text', text: 'run two agents' }]),
      message('assistant', [], {
        toolCalls: [
          toolCall('call_agent_1', 'SessionControl', {
            operation: 'spawn',
            description: 'Review API',
            profile: 'agent',
          }),
          toolCall('call_agent_2', 'SessionControl', {
            operation: 'spawn',
            description: 'Review tests',
            profile: 'agent',
          }),
        ],
      }),
      message('tool', [{ type: 'text', text: '{"agentId":"agent-one"}' }], {
        toolCallId: 'call_agent_1',
      }),
      message('tool', [{ type: 'text', text: '{"agentId":"agent-two"}' }], {
        toolCallId: 'call_agent_2',
      }),
    ];

    const driver = await replayIntoDriver(replay);
    const group = driver.state.transcriptContainer.children.find(
      (child) => child instanceof AgentGroupComponent,
    );

    expect(group).toBeInstanceOf(AgentGroupComponent);
    expect((group as AgentGroupComponent).size()).toBe(2);
    const output = stripAnsi((group as AgentGroupComponent).render(120).join('\n'));
    expect(output).not.toContain('agents finished');
    expect((group as AgentGroupComponent).getToolComponents().map(
      (component) => component.getSubagentSnapshot().phase,
    )).toEqual(['backgrounded', 'backgrounded']);
    expect(driver.streamingUI.hasPendingAgentGroup()).toBe(false);
    expect(driver.streamingUI.getToolComponent('call_agent_1')).toBeUndefined();
    expect(driver.streamingUI.getToolComponent('call_agent_2')).toBeUndefined();
  });

  it('does not group SessionControl list and message operations as child workers', async () => {
    const driver = await replayIntoDriver([
      message('user', [{ type: 'text', text: 'inspect and contact a child' }]),
      message('assistant', [], {
        toolCalls: [
          toolCall('call_list', 'SessionControl', { operation: 'list' }),
          toolCall('call_message', 'SessionControl', {
            operation: 'message', agentId: 'agent-one', message: 'Report current work',
          }),
        ],
      }),
      message('tool', [{ type: 'text', text: '[]' }], { toolCallId: 'call_list' }),
      message('tool', [{ type: 'text', text: '{"delivered":true}' }], {
        toolCallId: 'call_message',
      }),
    ]);
    expect(driver.state.transcriptContainer.children.some(
      (child) => child instanceof AgentGroupComponent,
    )).toBe(false);
    expect(driver.streamingUI.hasPendingAgentGroup()).toBe(false);
  });


  it('hydrates background snapshot state from the resumed main agent', async () => {
    const driver = await replayIntoDriver([], {
      background: [
        backgroundTask('agent-bg1', 'Review long-running work', 'running'),
        backgroundTask('bash-bg1', 'Build package', 'completed'),
      ],
    });

    expect(driver.sessionEventHandler.backgroundTasks.has('agent-bg1')).toBe(true);
    expect(driver.sessionEventHandler.backgroundTasks.has('bash-bg1')).toBe(true);
    expect(driver.sessionEventHandler.backgroundTaskTranscriptedTerminal.has('bash-bg1')).toBe(true);
  });

  it('matches completed resumed background agents by agent id when task id differs', async () => {
    const driver = await replayIntoDriver([], {
      background: [
        {
          taskId: 'task-bg1',
          kind: 'agent',
          agentId: 'agent-bg1',
          subagentType: 'coder',
          description: 'Review long-running work',
          status: 'running',
          startedAt: 1,
          endedAt: null,
        },
      ],
    });

    expect(
      driver.sessionEventHandler.subAgentEventHandler.backgroundAgentMetadata.has('agent-bg1'),
    ).toBe(true);
    expect(
      driver.sessionEventHandler.subAgentEventHandler.backgroundAgentMetadata.has('task-bg1'),
    ).toBe(false);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'subagent.completed',
        agentId: 'main',
        sessionId: 'ses-replay',
        subagentId: 'agent-bg1',
        resultSummary: 'Reviewed the long-running work.',
      },
      () => {},
    );

    const status = driver.state.transcriptEntries.find(
      (entry) => entry.backgroundAgentStatus?.phase === 'completed',
    );

    expect(
      driver.sessionEventHandler.subAgentEventHandler.backgroundAgentMetadata.has('agent-bg1'),
    ).toBe(false);
    expect(status?.backgroundAgentStatus?.headline).toBe('agent completed in background');
    expect(status?.backgroundAgentStatus?.detail).toContain('Review long-running work');
  });

  it('keeps timed-out status when an aborted resumed background agent later fails', async () => {
    const info: BackgroundTaskInfo = {
      taskId: 'task-bg-timeout',
      kind: 'agent',
      agentId: 'agent-bg-timeout',
      subagentType: 'coder',
      description: 'Review timeout handling',
      status: 'running',
      startedAt: 1,
      endedAt: null,
      timeoutMs: 1000,
    };
    const driver = await replayIntoDriver([], { background: [info] });
    const applyTerminalStatus = vi
      .spyOn(driver.streamingUI, 'applyBackgroundTaskTerminalStatus')
      .mockReturnValue(true);

    driver.sessionEventHandler.handleEvent(
      {
        type: 'background.task.terminated',
        agentId: 'main',
        sessionId: 'ses-replay',
        info: { ...info, status: 'timed_out', endedAt: 2 },
      },
      () => {},
    );
    driver.sessionEventHandler.handleEvent(
      {
        type: 'subagent.failed',
        agentId: 'main',
        sessionId: 'ses-replay',
        subagentId: 'agent-bg-timeout',
        error: 'The subagent was aborted.',
      },
      () => {},
    );

    expect(applyTerminalStatus.mock.calls.map(([args]) => args.status)).toEqual(['timed_out']);
    expect(
      driver.sessionEventHandler.subAgentEventHandler.backgroundAgentMetadata.has(
        'agent-bg-timeout',
      ),
    ).toBe(false);
    expect(driver.sessionEventHandler.backgroundTaskTranscriptedTerminal.has('task-bg-timeout'))
      .toBe(true);
    expect(
      driver.state.transcriptEntries.some(
        (entry) => entry.backgroundAgentStatus?.phase === 'failed',
      ),
    ).toBe(false);
  });

  it('renders replayed bash background notifications as bash tasks', async () => {
    const driver = await replayIntoDriver(
      [
        message('user', [{ type: 'text', text: 'Background task lost.' }], {
          origin: {
            kind: 'background_task',
            taskId: 'bash-lost0000',
            status: 'lost',
            notificationId: 'task:bash-lost0000:lost',
          },
        }),
      ],
      {
        background: [backgroundTask('bash-lost0000', 'Background timestamp logger', 'lost')],
      },
    );

    const status = driver.state.transcriptEntries.find(
      (entry) => entry.backgroundAgentStatus !== undefined,
    );

    expect(status?.backgroundAgentStatus?.headline).toBe('bash task lost');
    expect(status?.backgroundAgentStatus?.detail).toContain('Background timestamp logger');
    expect(status?.backgroundAgentStatus?.headline).not.toContain('agent');
  });

  it('renders only the most recent ten visible user turns', async () => {
    const replay = Array.from({ length: 12 }, (_, index) => [
      message('user', [{ type: 'text', text: `prompt ${index}` }]),
      message('assistant', [{ type: 'text', text: `answer ${index}` }]),
    ]).flat();

    const driver = await replayIntoDriver(replay);

    expect(
      driver.state.transcriptEntries
        .filter((entry) => entry.kind === 'user')
        .map((entry) => entry.content),
    ).toEqual([
      'prompt 2',
      'prompt 3',
      'prompt 4',
      'prompt 5',
      'prompt 6',
      'prompt 7',
      'prompt 8',
      'prompt 9',
      'prompt 10',
      'prompt 11',
    ]);
    expect(
      driver.state.transcriptEntries
        .filter((entry) => entry.kind === 'assistant')
        .map((entry) => entry.content),
    ).toEqual([
      'answer 2',
      'answer 3',
      'answer 4',
      'answer 5',
      'answer 6',
      'answer 7',
      'answer 8',
      'answer 9',
      'answer 10',
      'answer 11',
    ]);
  });

  it('renders replayed compaction records as completed compaction blocks', async () => {
    const driver = await replayIntoDriver([
      message('user', [{ type: 'text', text: 'prompt before compaction' }]),
      {
        time: REPLAY_TIME,
        type: 'compaction',
        result: {
          summary: 'Compacted transcript summary.',
          compactedCount: 4,
          keptUserMessageCount: 1,
          tokensBefore: 120,
          tokensAfter: 24,
        },
        instruction: 'preserve implementation notes',
      },
      message('user', [{ type: 'text', text: 'prompt after compaction' }]),
    ]);

    const compactionEntry = driver.state.transcriptEntries.find(
      (entry) => entry.compactionData !== undefined,
    );
    expect(compactionEntry?.compactionData).toEqual({
      tokensBefore: 120,
      tokensAfter: 24,
      instruction: 'preserve implementation notes',
    });
    const transcript = paintedReplay(driver, 120);
    expect(transcript).toContain('Compaction complete');
    expect(transcript).toContain('120 → 24 tokens');
    expect(transcript).toContain('preserve implementation notes');
    expect(transcript).not.toContain('Compacted transcript summary.');
  });

  it('renders replayed cancelled compaction records as cancelled compaction blocks', async () => {
    const driver = await replayIntoDriver([
      message('user', [{ type: 'text', text: 'prompt before cancellation' }]),
      {
        time: REPLAY_TIME,
        type: 'compaction',
        result: 'cancelled',
        instruction: 'preserve implementation notes',
      },
      message('user', [{ type: 'text', text: 'prompt after cancellation' }]),
    ]);

    const compactionEntry = driver.state.transcriptEntries.find(
      (entry) => entry.compactionData !== undefined,
    );
    expect(compactionEntry?.compactionData).toEqual({
      result: 'cancelled',
      instruction: 'preserve implementation notes',
    });
    const transcript = paintedReplay(driver, 120);
    expect(transcript).toContain('Compaction cancelled');
    expect(transcript).toContain('preserve implementation notes');
    expect(transcript).not.toContain('Compaction complete');
  });

  it('renders permission and approval replay notices', async () => {
    const driver = await replayIntoDriver([
      { time: REPLAY_TIME, type: 'permission_updated', mode: 'auto' },
      { time: REPLAY_TIME, type: 'permission_updated', mode: 'yolo' },
      { time: REPLAY_TIME, type: 'permission_updated', mode: 'manual' },
      {
        time: REPLAY_TIME,
        type: 'approval_result',
        record: {
          turnId: 0,
          toolCallId: 'call_bash',
          action: 'run command',
          toolName: 'Bash',
          result: {
            decision: 'approved',
            scope: 'session',
          },
        },
      },
    ]);

    const transcript = paintedReplay(driver, 120);

    expect(transcript).toContain('Permission mode: auto');
    expect(transcript).toContain('YOLO mode: ON');
    expect(transcript).toContain('YOLO mode: OFF');
    expect(transcript).toContain('Approved for session: run command');
  });

  it('caps tool mounts within a single long-running replayed turn', async () => {
    const toolCount = REPLAY_MAX_TOOL_MOUNTS_PER_TURN + 12;
    const tools = Array.from({ length: toolCount }, (_, index) =>
      toolCall(`call_${index}`, 'Bash', { command: `echo ${index}` }),
    );
    const results = tools.map((tool, index) =>
      message('tool', [{ type: 'text', text: `out ${index}` }], { toolCallId: tool.id }),
    );
    const driver = await replayIntoDriver([
      message('user', [{ type: 'text', text: 'run many tools' }]),
      message('assistant', [{ type: 'text', text: 'working' }], { toolCalls: tools }),
      ...results,
    ]);

    const mountedTools = driver.state.transcriptContainer.children.filter(
      (child) => child instanceof ToolCallComponent,
    );
    // Mount budget caps the storm, then mergeAllTurnSteps collapses older steps
    // into a summary — so the live tree stays well under the raw tool count.
    expect(mountedTools.length).toBeLessThanOrEqual(REPLAY_MAX_TOOL_MOUNTS_PER_TURN);
    expect(mountedTools.length).toBeLessThan(toolCount);
    expect(mountedTools.length).toBeGreaterThan(0);
    // Newest tools are kept (last window of the storm).
    const rendered = driver.state.transcriptContainer.render(120).join('\n');
    expect(rendered).toContain(`echo ${toolCount - 1}`);
    expect(rendered).not.toContain('echo 0');
    expect(
      driver.state.transcriptEntries.some(
        (entry) =>
          entry.kind === 'status' &&
          entry.content.includes('earlier tool step') &&
          entry.content.includes(String(toolCount - REPLAY_MAX_TOOL_MOUNTS_PER_TURN)),
      ),
    ).toBe(true);
    expect(driver.state.appState.isReplaying).toBe(false);
  });

  it('does not keep all messages in the render list for a large multi-turn fixture', async () => {
    const turnCount = REPLAY_TURN_LIMIT + 25;
    const records: AgentReplayRecord[] = [];
    for (let i = 0; i < turnCount; i++) {
      records.push(message('user', [{ type: 'text', text: `long-session prompt ${i}` }]));
      records.push(
        message('assistant', [{ type: 'text', text: `long-session reply ${i}` }]),
      );
    }

    const driver = await replayIntoDriver(records);
    // Assert the entry list, not transcriptContainer.render() — that is a
    // viewport slice and can sit mid-window on Windows after hydrate.
    const listed = driver.state.transcriptEntries.map((entry) => entry.content).join('\n');

    // Only the trailing turn window is projected into the transcript.
    expect(listed).toContain(`long-session prompt ${turnCount - 1}`);
    expect(listed).toContain(`long-session reply ${turnCount - 1}`);
    // Do not use a bare "prompt 0" substring — "prompt 30" contains it.
    expect(listed).not.toMatch(/long-session prompt 0(?!\d)/);
    expect(listed).not.toMatch(/long-session reply 0(?!\d)/);

    const userEntries = driver.state.transcriptEntries.filter((entry) => entry.kind === 'user');
    expect(userEntries.length).toBeLessThanOrEqual(REPLAY_TURN_LIMIT);
    expect(userEntries.length).toBeGreaterThan(0);
    expect(driver.state.appState.isReplaying).toBe(false);
  });

  it('finishes hydrate batch mount so later appends invalidate normally', async () => {
    const driver = await replayIntoDriver([
      message('user', [{ type: 'text', text: 'hello' }]),
      message('assistant', [{ type: 'text', text: 'hi' }]),
    ]);
    expect(driver.state.transcriptContainer.isBatchMounting).toBe(false);
    expect(driver.state.appState.isReplaying).toBe(false);
  });

  it('clears session loading overlay after hydrate completes', async () => {
    const driver = await replayIntoDriver([
      message('user', [{ type: 'text', text: 'hello' }]),
      message('assistant', [{ type: 'text', text: 'hi' }]),
    ]);
    expect(driver.isSessionLoadingOverlayActive()).toBe(false);
    expect(driver.state.activeDialog).not.toBe('session-loading');
    expect(driver.state.appState.isReplaying).toBe(false);
  });
});

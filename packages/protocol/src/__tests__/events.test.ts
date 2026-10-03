import { describe, it, expect } from 'vitest';

import {
  agentEventSchema,
  agentStatusUpdatedEventSchema,
  assistantDeltaEventSchema,
  eventSchema,
  subagentToolCallEventSchema,
  subagentToolProgressEventSchema,
  subagentToolResultEventSchema,
  toolCallStartedEventSchema,
} from '../events';

describe('native event payloads', () => {
  it('validates concrete agent event payloads with Zod schemas', () => {
    expect(
      assistantDeltaEventSchema.parse({
        type: 'assistant.delta',
        turnId: 1,
        delta: 'hello',
      }),
    ).toEqual({
      type: 'assistant.delta',
      turnId: 1,
      delta: 'hello',
    });

    expect(
      toolCallStartedEventSchema.safeParse({
        type: 'tool.call.started',
        turnId: 1,
        toolCallId: 'call_1',
        name: 'bash',
        args: { command: 'pwd' },
        display: { kind: 'command', command: 'pwd', language: 'bash' },
      }).success,
    ).toBe(true);
  });

  it('rejects unknown event types through the full agent event union', () => {
    expect(
      agentEventSchema.safeParse({
        type: 'unknown.event',
        turnId: 1,
      }).success,
    ).toBe(false);
  });

  it('rejects the retired automatic retry event instead of publishing synthetic attempts', () => {
    expect(agentEventSchema.safeParse({
      type: 'turn.step.retrying',
      turnId: 1,
      step: 1,
      stepId: 'step-1',
      failedAttempt: 1,
      nextAttempt: 2,
      maxAttempts: 3,
      delayMs: 300,
      errorName: 'APIConnectionError',
      errorMessage: 'connection lost',
    }).success).toBe(false);
  });

  it('parses compaction progress phase events through the full agent event union', () => {
    const parsed = agentEventSchema.safeParse({
      type: 'compaction.progress',
      phase: 'summarizing',
    });
    expect(parsed.success).toBe(true);
    expect(
      agentEventSchema.safeParse({ type: 'compaction.progress', phase: 'bogus' }).success,
    ).toBe(false);
  });

  it('parses compaction progress events carrying a streamed summary delta', () => {
    expect(
      agentEventSchema.safeParse({
        type: 'compaction.progress',
        phase: 'summarizing',
        delta: 'hello',
      }).success,
    ).toBe(true);
    expect(
      agentEventSchema.safeParse({
        type: 'compaction.progress',
        phase: 'summarizing',
        streamKind: 'block',
        blockIndex: 1,
        blockCount: 3,
        delta: 'block chunk',
      }).success,
    ).toBe(true);
    expect(
      agentEventSchema.safeParse({
        type: 'compaction.progress',
        phase: 'repairing',
        streamKind: 'repair',
        delta: 'repair chunk',
      }).success,
    ).toBe(true);
    expect(
      agentEventSchema.safeParse({
        type: 'compaction.progress',
        phase: 'bogus',
        delta: 'hello',
      }).success,
    ).toBe(false);
  });

  it('keeps blocksCompleted and fraction on compaction.progress (live TUI bar)', () => {
    const parsed = agentEventSchema.safeParse({
      type: 'compaction.progress',
      phase: 'summarizing',
      streamKind: 'block',
      blockIndex: 2,
      blockCount: 4,
      blocksCompleted: 2,
      fraction: 0.42,
      delta: 'chunk',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      type: 'compaction.progress',
      blocksCompleted: 2,
      fraction: 0.42,
      blockIndex: 2,
      blockCount: 4,
    });
  });

  it('accepts explicit compaction and rejects automatic triggers', () => {
    expect(agentEventSchema.safeParse({
      type: 'compaction.started',
      trigger: 'manual',
      instruction: 'Summarize the conversation',
      mode: 'blocking',
    }).success).toBe(true);
    expect(agentEventSchema.safeParse({
      type: 'compaction.started',
      trigger: 'auto',
    }).success).toBe(false);
  });

  it('validates session-scoped daemon events with agentId and sessionId', () => {
    const parsed = eventSchema.parse({
      type: 'turn.started',
      agentId: 'agent_1',
      sessionId: 'sess_1',
      turnId: 1,
      origin: { kind: 'user' },
    });

    expect(parsed.agentId).toBe('agent_1');
    expect(parsed.sessionId).toBe('sess_1');
  });

  it('validates selected provider route metadata on step completion events', () => {
    const parsed = eventSchema.parse({
      type: 'turn.step.completed',
      agentId: 'main',
      sessionId: 'sess_1',
      turnId: 1,
      step: 1,
      providerRouteSelection: {
        modelAlias: 'backup',
        providerName: 'anthropic',
        credentialLabel: 'api_key:2',
        providerModel: 'claude-backup',
        baseUrl: 'https://anthropic.example/v1',
      },
    });

    expect(parsed.type).toBe('turn.step.completed');
    expect(
      (parsed as { providerRouteSelection?: { credentialLabel?: string } })
        .providerRouteSelection?.credentialLabel,
    ).toBe('api_key:2');
    expect(
      (parsed as { providerRouteSelection?: { baseUrl?: string } }).providerRouteSelection
        ?.baseUrl,
    ).toBe('https://anthropic.example/v1');
  });

  it('validates prompt.submitted events', () => {
    const parsed = eventSchema.parse({
      type: 'prompt.submitted',
      agentId: 'main',
      sessionId: 'sess_1',
      promptId: 'prompt_1',
      userMessageId: 'msg_1',
      status: 'running',
      content: [{ type: 'text', text: 'hello' }],
      createdAt: '2026-06-11T00:00:00.000Z',
    });

    expect(parsed.type).toBe('prompt.submitted');
    expect((parsed as { promptId: string }).promptId).toBe('prompt_1');
  });


  it('preserves detached on background task events', () => {
    const parsed = eventSchema.parse({
      type: 'background.task.started',
      agentId: 'main',
      sessionId: 'sess_1',
      info: {
        kind: 'process',
        taskId: 'bash-deadbeef',
        description: 'Bash: sleep 10',
        status: 'running',
        detached: false,
        startedAt: 1,
        endedAt: null,
        command: 'sleep 10',
        pid: 123,
        exitCode: null,
      },
    });

    expect(parsed.type).toBe('background.task.started');
    expect((parsed as { info: { detached?: boolean } }).info.detached).toBe(false);
  });

  it('validates event.session.created events', () => {
    const parsed = eventSchema.parse({
      type: 'event.session.created',
      agentId: 'main',
      sessionId: 'sess_1',
      session: {
        id: 'sess_1',
        workspace_id: 'wd_project_123456abcdef',
        title: 'Created session',
        created_at: '2026-06-11T00:00:00.000Z',
        updated_at: '2026-06-11T00:00:00.000Z',
        status: 'idle',
        metadata: { cwd: '/tmp/project' },
        agent_config: { model: 'kimi-k2' },
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          total_cost_usd: 0,
          context_tokens: 0,
          context_limit: 0,
          turn_count: 0,
        },
        permission_rules: [],
        message_count: 0,
        last_seq: 0,
      },
    });

    expect(parsed.type).toBe('event.session.created');
    expect((parsed as { session: { id: string } }).session.id).toBe('sess_1');
  });

  it('validates workspace lifecycle events', () => {
    const workspace = {
      id: 'wd_project_123456abcdef',
      root: '/tmp/project',
      name: 'project',
      is_git_repo: true,
      branch: 'main',
      created_at: '2026-06-11T00:00:00.000Z',
      last_opened_at: '2026-06-11T00:00:00.000Z',
      session_count: 1,
    };

    const created = eventSchema.parse({
      type: 'event.workspace.created',
      agentId: 'main',
      sessionId: '__global__',
      workspace,
    });
    expect(created.type).toBe('event.workspace.created');

    const updated = eventSchema.parse({
      type: 'event.workspace.updated',
      agentId: 'main',
      sessionId: '__global__',
      workspace: { ...workspace, name: 'renamed' },
    });
    expect(updated.type).toBe('event.workspace.updated');

    const deleted = eventSchema.parse({
      type: 'event.workspace.deleted',
      agentId: 'main',
      sessionId: '__global__',
      workspace_id: workspace.id,
      root: workspace.root,
    });
    expect(deleted.type).toBe('event.workspace.deleted');
    expect((deleted as { root: string }).root).toBe('/tmp/project');
  });

  it('validates event.session.status_changed events', () => {
    const parsed = eventSchema.parse({
      type: 'event.session.status_changed',
      agentId: 'main',
      sessionId: 'sess_1',
      status: 'running',
      previous_status: 'idle',
      current_prompt_id: 'prompt_1',
    });

    expect(parsed.type).toBe('event.session.status_changed');
    expect((parsed as { status: string }).status).toBe('running');
    expect((parsed as { previous_status: string }).previous_status).toBe('idle');
    expect((parsed as { current_prompt_id: string }).current_prompt_id).toBe('prompt_1');
  });

  it('rejects event.session.status_changed with invalid status', () => {
    expect(
      eventSchema.safeParse({
        type: 'event.session.status_changed',
        agentId: 'main',
        sessionId: 'sess_1',
        status: 'unknown',
        previous_status: 'idle',
      }).success,
    ).toBe(false);
  });
});

describe('agentStatusUpdatedEventSchema', () => {
  it('preserves native context and permission intervention counters', () => {
    const status = {
      type: 'agent.status.updated',
      model: 'kimi-code',
      contextTokens: 100,
      maxContextTokens: 1000,
      contextUsage: 0.1,
      permission: 'manual',
      providerRoute: null,
      pendingInterventions: 2,
      staleInterventions: 1,
      oldestInterventionAgeMs: 120_001,
    } as const;
    expect(agentStatusUpdatedEventSchema.parse(status)).toEqual(status);
  });
});

describe('subagent tool streaming event schemas', () => {
  it('round-trips subagent.tool_call through its own schema and the union', () => {
    const event = {
      type: 'subagent.tool_call',
      subagentId: 'agent-0',
      subagentName: 'coder',
      parentToolCallId: 'tc-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      name: 'Bash',
      argsPreview: '{"command":"pwd"}',
    } as const;
    expect(subagentToolCallEventSchema.parse(event)).toEqual(event);
    expect(agentEventSchema.parse(event)).toEqual(event);
    // Minimal payload (all optional fields omitted) stays valid.
    expect(
      agentEventSchema.safeParse({
        type: 'subagent.tool_call',
        subagentId: 'agent-0',
        toolCallId: 'call-2',
        name: 'SessionControl',
      }).success,
    ).toBe(true);
    expect(
      subagentToolCallEventSchema.safeParse({ type: 'subagent.tool_call', subagentId: 'agent-0' })
        .success,
    ).toBe(false);
  });

  it('round-trips subagent.tool_result through its own schema and the union', () => {
    const event = {
      type: 'subagent.tool_result',
      subagentId: 'agent-0',
      runId: 'run-1',
      toolCallId: 'call-1',
      name: 'Bash',
      isError: true,
      resultPreview: 'error: conflict',
    } as const;
    expect(subagentToolResultEventSchema.parse(event)).toEqual(event);
    expect(agentEventSchema.parse(event)).toEqual(event);
    expect(
      agentEventSchema.safeParse({
        type: 'subagent.tool_result',
        subagentId: 'agent-0',
        toolCallId: 'call-2',
      }).success,
    ).toBe(true);
    expect(
      subagentToolResultEventSchema.safeParse({
        type: 'subagent.tool_result',
        toolCallId: 'call-2',
      }).success,
    ).toBe(false);
  });

  it('round-trips subagent.tool_progress through its own schema and the union', () => {
    const event = {
      type: 'subagent.tool_progress',
      subagentId: 'agent-0',
      runId: 'run-1',
      toolCallId: 'call-1',
      name: 'Bash',
      kind: 'stdout',
      textPreview: 'ok',
    } as const;
    expect(subagentToolProgressEventSchema.parse(event)).toEqual(event);
    expect(agentEventSchema.parse(event)).toEqual(event);
    expect(
      agentEventSchema.safeParse({
        type: 'subagent.tool_progress',
        subagentId: 'agent-0',
        toolCallId: 'call-2',
        kind: 'stderr',
      }).success,
    ).toBe(true);
    expect(
      subagentToolProgressEventSchema.safeParse({
        type: 'subagent.tool_progress',
        toolCallId: 'call-2',
      }).success,
    ).toBe(false);
    expect(
      subagentToolProgressEventSchema.safeParse({
        type: 'subagent.tool_progress',
        subagentId: 'agent-0',
        toolCallId: 'call-2',
        kind: 'custom',
      }).success,
    ).toBe(false);
  });

  it('keeps subagent tool events parseable on the session envelope', () => {
    const parsed = eventSchema.parse({
      type: 'subagent.tool_call',
      subagentId: 'agent-0',
      toolCallId: 'call-1',
      name: 'Bash',
      argsPreview: 'pnpm test',
      agentId: 'main',
      sessionId: 'session-0',
    });
    expect(parsed.agentId).toBe('main');
    expect(parsed.sessionId).toBe('session-0');
    expect(
      eventSchema.parse({
        type: 'subagent.tool_progress',
        subagentId: 'agent-0',
        toolCallId: 'call-1',
        kind: 'stdout',
        textPreview: 'ok\n',
        agentId: 'main',
        sessionId: 'session-0',
      }).type,
    ).toBe('subagent.tool_progress');
  });

  it('parses every subagent.tool_call detail variant and keeps detail optional', () => {
    const base = {
      type: 'subagent.tool_call',
      subagentId: 'agent-0',
      toolCallId: 'call-1',
      name: 'SessionControl',
    } as const;
    const details = [
      { kind: 'bash', command: 'pnpm test' },
      { kind: 'session', operation: 'spawn', description: 'Run the worker' },
    ] as const;
    for (const detail of details) {
      const event = { ...base, detail };
      expect(subagentToolCallEventSchema.parse(event)).toEqual(event);
      expect(agentEventSchema.parse(event)).toEqual(event);
    }
    // 1-A payloads without detail stay valid.
    expect(subagentToolCallEventSchema.parse(base)).toEqual(base);
  });

  it('rejects malformed subagent.tool_call detail payloads', () => {
    const base = {
      type: 'subagent.tool_call',
      subagentId: 'agent-0',
      toolCallId: 'call-1',
      name: 'SessionControl',
    } as const;
    // Unknown discriminator.
    expect(
      subagentToolCallEventSchema.safeParse({ ...base, detail: { kind: 'fetch', url: 'x' } })
        .success,
    ).toBe(false);
    // Known discriminator with missing fields.
    expect(
      subagentToolCallEventSchema.safeParse({ ...base, detail: { kind: 'session' } })
        .success,
    ).toBe(false);
    expect(
      subagentToolCallEventSchema.safeParse({ ...base, detail: { kind: 'bash' } }).success,
    ).toBe(false);
  });
});

describe('native worker settlement', () => {
  it('preserves worker result, changed files, context and actual provider usage', () => {
    const completed = {
      type: 'subagent.completed',
      subagentId: 'worker-1',
      resultSummary: 'Updated the parser',
      filesChanged: ['src/parser.ts'],
      contextTokens: 420,
      usage: { inputOther: 100, output: 20, inputCacheRead: 300, inputCacheCreation: 0 },
    } as const;
    expect(agentEventSchema.parse(completed)).toEqual(completed);
  });

  it('preserves explicit worker deadline and observed progress', () => {
    const progress = {
      type: 'subagent.progress',
      subagentId: 'worker-1',
      elapsedMs: 1000,
      tokens: 120,
      toolCount: 2,
      lastTool: 'Bash',
      lastTarget: 'pwd',
      budgetMs: 5000,
      budgetRemainingMs: 4000,
    } as const;
    expect(agentEventSchema.parse(progress)).toEqual(progress);
  });

  it('preserves a settled background worker without rewriting the native status', () => {
    const event = {
      type: 'background.task.terminated',
      info: {
        kind: 'agent',
        agentId: 'worker-1',
        subagentType: 'worker',
        taskId: 'agent-1',
        description: 'Stopped by operator',
        status: 'killed',
        startedAt: 1,
        endedAt: 2,
        stopReason: 'Operator requested stop',
      },
    } as const;
    expect(agentEventSchema.parse(event)).toEqual(event);
  });
});

describe('explicit SessionControl compaction', () => {
  it('preserves model-requested compaction as explicit agent activity', () => {
    const event = {
      type: 'compaction.started',
      trigger: 'agent',
      mode: 'blocking',
      instruction: 'Keep the parser constraints',
    } as const;
    expect(agentEventSchema.parse(event)).toEqual(event);
  });
});

describe('native terminal process metadata', () => {
  it('preserves an ACP-backed process without inventing an OS pid', () => {
    const event = {
      type: 'background.task.started',
      info: {
        kind: 'process',
        taskId: 'bash-acp',
        description: 'Native terminal command',
        command: 'pwd',
        status: 'running',
        startedAt: 1,
        endedAt: null,
        exitCode: null,
      },
    } as const;
    expect(agentEventSchema.parse(event)).toEqual(event);
  });
});

describe('native worker terminal output routing', () => {
  it('preserves the factual terminal identity alongside streamed worker output', () => {
    const event = {
      type: 'subagent.tool_progress',
      subagentId: 'worker-1',
      toolCallId: 'call-1',
      name: 'Bash',
      kind: 'stdout',
      textPreview: 'workspace\n',
      terminalId: 'terminal-from-provider',
    } as const;
    expect(subagentToolProgressEventSchema.parse(event)).toEqual(event);
    expect(agentEventSchema.parse(event)).toEqual(event);
  });
});

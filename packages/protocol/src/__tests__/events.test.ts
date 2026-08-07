import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  agentEventSchema,
  agentStatusUpdatedEventSchema,
  assistantDeltaEventSchema,
  eventSchema,
  subagentToolCallEventSchema,
  subagentToolResultEventSchema,
  toolCallStartedEventSchema,
} from '../events';
import type { Event } from '../events';
import type { ToolInputDisplay } from '../display';
import { workGraphNodeSchema, workGraphSchema } from '../work-graph';

type _AssertEventNonNever = Event extends never ? never : true;
const _assertEvent: _AssertEventNonNever = true;

type _AssertToolInputDisplayNonNever = ToolInputDisplay extends never ? never : true;
const _assertDisplay: _AssertToolInputDisplayNonNever = true;

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const sdkPackageName = ['@superliora', 'sdk'].join('/');

function readPackageFiles(): string {
  const files = ['package.json', ...sourceFiles(join(packageRoot, 'src'))];
  return files
    .map((file) => readFileSync(join(packageRoot, file), 'utf8'))
    .join('\n');
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      files.push(relative(packageRoot, full));
    }
  }
  return files;
}

describe('events / display re-exports', () => {
  it('does not depend on the node SDK package', () => {
    expect(readPackageFiles()).not.toContain(sdkPackageName);
  });

  it('Event re-export is non-never (compile-time check passed)', () => {
    expect(_assertEvent).toBe(true);
  });

  it('ToolInputDisplay re-export is non-never (12-arm union preserved)', () => {
    expect(_assertDisplay).toBe(true);
  });

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

  it('accepts overflow as compaction.started trigger (reactive recovery)', () => {
    const parsed = agentEventSchema.safeParse({
      type: 'compaction.started',
      trigger: 'overflow',
      instruction: 'CONTEXT_OVERFLOW_RECOVERY: compact',
      mode: 'blocking',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      type: 'compaction.started',
      trigger: 'overflow',
    });
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

  it('keeps minimal WorkGraph nodes valid while round-tripping harness metadata', () => {
    expect(
      workGraphNodeSchema.parse({
        id: 'ac_1',
        title: 'Implement the parser',
        stage: 'swarm',
        status: 'queued',
      }),
    ).toEqual({
      id: 'ac_1',
      title: 'Implement the parser',
      stage: 'swarm',
      status: 'queued',
    });

    const graph = workGraphSchema.parse({
      id: 'wg_1',
      runId: 'uw_1',
      rootGoal: 'Ship the Ouroboros harness',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z',
      nodes: [
        {
          id: 'ac_1',
          title: 'Implement the parser',
          kind: 'implementation',
          stage: 'swarm',
          parentId: 'root',
          acceptanceCriterionId: 'AC-1',
          laneId: 'implementation',
          ownerExpertId: 'backend-engineer',
          ownerAgentId: 'agent_1',
          status: 'done',
          dependsOn: ['research_1'],
          evidenceIds: ['evidence_1'],
          requiredEvidence: ['unit test'],
          verificationStatus: 'passed',
          verificationSummary: 'unit test passed',
        },
      ],
    });

    expect(graph.nodes[0]).toMatchObject({
      kind: 'implementation',
      acceptanceCriterionId: 'AC-1',
      evidenceIds: ['evidence_1'],
      verificationStatus: 'passed',
    });
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
  it('accepts contextOS health and null clear', () => {
    const withHealth = agentStatusUpdatedEventSchema.parse({
      type: 'agent.status.updated',
      model: 'kimi-code',
      contextTokens: 100,
      maxContextTokens: 1000,
      contextUsage: 0.1,
      planMode: false,
      premiumQualityMode: false,
      permission: 'manual',
      providerRoute: null,
      contextOS: {
        pageCount: 1,
        readyPageCount: 0,
        needsRehydrationPageCount: 1,
        atRiskPageCount: 0,
        missingEvidencePageCount: 1,
        evidenceIdRecallScore: 0.25,
        latestContinuityStatus: 'needs_rehydration',
      },
    });
    expect(withHealth.contextOS?.missingEvidencePageCount).toBe(1);

    const withMicro = agentStatusUpdatedEventSchema.parse({
      type: 'agent.status.updated',
      microCompaction: {
        total: 2,
        lastTrigger: 'swarm_pressure',
        lastContextUsageRatio: 0.7,
        byTrigger: { swarm_pressure: 2 },
      },
    });
    expect(withMicro.microCompaction?.total).toBe(2);

    const cleared = agentStatusUpdatedEventSchema.parse({
      type: 'agent.status.updated',
      contextOS: null,
      microCompaction: null,
    });
    expect(cleared.contextOS).toBeNull();
    expect(cleared.microCompaction).toBeNull();

    const withDream = agentStatusUpdatedEventSchema.parse({
      type: 'agent.status.updated',
      autoDream: {
        enabled: true,
        inFlight: false,
        runs: 1,
        lastDreamAt: 1_700_000_000_000,
        lastExamined: 10,
        lastMerged: 2,
        minHours: 4,
        minActiveRecords: 8,
      },
    });
    expect(withDream.autoDream?.runs).toBe(1);
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
      name: 'Edit',
      argsPreview: '{"path":"src/a.ts"}',
    } as const;
    expect(subagentToolCallEventSchema.parse(event)).toEqual(event);
    expect(agentEventSchema.parse(event)).toEqual(event);
    // Minimal payload (all optional fields omitted) stays valid.
    expect(
      agentEventSchema.safeParse({
        type: 'subagent.tool_call',
        subagentId: 'agent-0',
        toolCallId: 'call-2',
        name: 'Read',
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
      name: 'Edit',
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
  });

  it('parses every subagent.tool_call detail variant and keeps detail optional', () => {
    const base = {
      type: 'subagent.tool_call',
      subagentId: 'agent-0',
      toolCallId: 'call-1',
      name: 'Edit',
    } as const;
    const details = [
      { kind: 'edit', path: 'src/a.ts', addedLines: 3, removedLines: 1 },
      { kind: 'write', path: 'src/b.ts', lines: 12, bytes: 340 },
      { kind: 'read', path: 'src/c.ts' },
      { kind: 'bash', command: 'pnpm test' },
      { kind: 'search', pattern: 'foo.*' },
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
      name: 'Edit',
    } as const;
    // Unknown discriminator.
    expect(
      subagentToolCallEventSchema.safeParse({ ...base, detail: { kind: 'fetch', url: 'x' } })
        .success,
    ).toBe(false);
    // Known discriminator with missing fields.
    expect(
      subagentToolCallEventSchema.safeParse({ ...base, detail: { kind: 'edit', path: 'src/a.ts' } })
        .success,
    ).toBe(false);
    expect(
      subagentToolCallEventSchema.safeParse({ ...base, detail: { kind: 'bash' } }).success,
    ).toBe(false);
  });
});

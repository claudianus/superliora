import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  agentEventSchema,
  agentStatusUpdatedEventSchema,
  assistantDeltaEventSchema,
  eventSchema,
  toolCallStartedEventSchema,
} from '../events';
import type { Event } from '../events';
import type { ToolInputDisplay } from '../display';
import { workGraphNodeSchema, workGraphSchema } from '../ultrawork';

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

  it('validates Ultrawork stage and research events', () => {
    const run = {
      id: 'uw_1',
      objective: 'Ship the latest-library feature',
      status: 'running',
      stage: 'research',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:01.000Z',
    };

    const stageChanged = eventSchema.parse({
      type: 'ultrawork.stage.changed',
      agentId: 'main',
      sessionId: 'sess_1',
      run,
      from: 'plan',
      to: 'research',
      reason: 'latest API behavior may affect implementation',
    });

    expect(stageChanged.type).toBe('ultrawork.stage.changed');

    const researchStarted = eventSchema.parse({
      type: 'ultrawork.research.started',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      topic: 'latest-library feature',
      backends: [
        {
          id: 'local',
          kind: 'local_research_stack',
          role: 'assist',
          status: 'selected',
        },
        {
          id: 'kimi',
          kind: 'kimi_web_search',
          role: 'primary',
          status: 'available',
        },
      ],
    });

    expect(researchStarted.type).toBe('ultrawork.research.started');
  });

  it('validates Ultrawork team, verification, and knowledge events', () => {
    const staffed = eventSchema.parse({
      type: 'ultrawork.team.staffed',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      toolCallId: 'call_ultra_swarm',
      team: {
        id: 'team_1',
        runId: 'uw_1',
        intensity: 'premium',
        maxExperts: 24,
        experts: [
          {
            id: 'frontend-architect',
            name: 'Frontend Architect',
            role: 'architecture',
            focus: 'review',
            status: 'queued',
            division: 'engineering',
            emoji: 'A',
            color: '#0EA5E9',
            coverageLane: 'architecture_implementation',
            selectionReason: 'Owns the architecture review lane.',
            dependsOn: ['product-manager'],
            agentId: 'agent_architect',
          },
        ],
      },
    });

    expect(staffed.type).toBe('ultrawork.team.staffed');
    if (staffed.type !== 'ultrawork.team.staffed') {
      throw new Error('expected ultrawork.team.staffed');
    }
    expect(staffed.toolCallId).toBe('call_ultra_swarm');
    expect(staffed.team.experts[0]).toMatchObject({
      coverageLane: 'architecture_implementation',
      dependsOn: ['product-manager'],
      agentId: 'agent_architect',
    });

    const collaboration = eventSchema.parse({
      type: 'ultrawork.collaboration.message',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      message: {
        id: 'swarm-msg-1',
        runId: 'uw_1',
        parentToolCallId: 'call_ultra_swarm',
        at: '2026-07-01T00:00:01.000Z',
        from: {
          expertId: 'security-appsec-engineer',
          agentId: 'agent_sec',
          name: 'AppSec Engineer',
        },
        to: { expertId: 'impl-engineer' },
        channel: 'blocker',
        kind: 'mention',
        body: 'auth middleware missing tests',
      },
    });

    expect(collaboration.type).toBe('ultrawork.collaboration.message');
    if (collaboration.type !== 'ultrawork.collaboration.message') {
      throw new Error('expected ultrawork.collaboration.message');
    }
    expect(collaboration.message.channel).toBe('blocker');

    const mention = eventSchema.parse({
      type: 'ultrawork.collaboration.mention',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      message: collaboration.message,
      mentionExpertIds: ['impl-engineer'],
    });

    expect(mention.type).toBe('ultrawork.collaboration.mention');
    if (mention.type !== 'ultrawork.collaboration.mention') {
      throw new Error('expected ultrawork.collaboration.mention');
    }
    expect(mention.mentionExpertIds).toEqual(['impl-engineer']);

    const verified = eventSchema.parse({
      type: 'ultrawork.verification.completed',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      verification: {
        id: 'verify_1',
        runId: 'uw_1',
        status: 'passed',
        checks: [{ name: 'typecheck', status: 'passed', command: 'pnpm typecheck' }],
        completedAt: '2026-07-01T00:00:02.000Z',
      },
    });

    expect(verified.type).toBe('ultrawork.verification.completed');

    const promoted = eventSchema.parse({
      type: 'ultrawork.knowledge.promoted',
      agentId: 'main',
      sessionId: 'sess_1',
      runId: 'uw_1',
      promotion: {
        id: 'learn_1',
        runId: 'uw_1',
        target: 'llm_wiki',
        findingId: 'finding_1',
        title: 'Official API requirement',
        promotedAt: '2026-07-01T00:00:03.000Z',
        sourceEvidenceIds: ['evidence_1'],
      },
    });

    expect(promoted.type).toBe('ultrawork.knowledge.promoted');
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
      swarmMode: false,
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

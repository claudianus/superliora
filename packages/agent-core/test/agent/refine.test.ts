import { mkdtempSync, rmSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent/index';
import {
  AgentRefineService,
  AUTO_REFINE_COOLDOWN_MS,
  AUTO_REFINE_TURN_INTERVAL,
} from '../../src/agent/refine/service';
import { parseRefinePlan, RefinePlanError } from '../../src/agent/refine/plan';
import { parseAutoRefineReview, RefineReviewError } from '../../src/agent/refine/review';
import { HarnessInjector } from '../../src/agent/refine/injector';
import type { HarnessEntry } from '../../src/agent/refine/state';
import type { MemoryRecord } from '../../src/memory/types';

interface MockAgentOptions {
  readonly planText?: string;
  readonly withMemory?: boolean;
  readonly cwd?: string;
  readonly flagEnabled?: boolean;
}

function generateResult(text: string) {
  return {
    id: null,
    message: {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }],
      toolCalls: [],
    },
    usage: null,
    finishReason: null,
    rawFinishReason: null,
  };
}

function makeAgent(options: MockAgentOptions = {}) {
  const provider: { withThinking: ReturnType<typeof vi.fn> } = {
    withThinking: vi.fn(() => provider),
  };
  const planText =
    options.planText ?? JSON.stringify({ summary: 'nothing to do', edits: [] });
  const generate = vi.fn(async () => generateResult(planText));
  const records = { logRecord: vi.fn() };
  const memoryRecords = new Map<string, MemoryRecord>();
  let memorySeq = 0;
  const memory = {
    isEnabled: () => true,
    remember: vi.fn(async (input: { subject: string; content: string }) => {
      memorySeq += 1;
      const record = {
        id: `mem-${String(memorySeq)}`,
        type: 'rule',
        epistemic: 'inferred',
        scope: 'workspace',
        subject: input.subject,
        content: input.content,
        tags: [],
        confidence: 1,
        importance: 0.5,
        status: 'active',
        source: { kind: 'manual' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        recordedAt: Date.now(),
        accessCount: 0,
        supersedes: [],
        evidenceRefs: [],
        links: [],
        metadata: {},
      } as unknown as MemoryRecord;
      memoryRecords.set(record.id, record);
      return record;
    }),
    update: vi.fn(async (id: string, patch: { content?: string }) => {
      const existing = memoryRecords.get(id);
      if (existing === undefined) throw new Error(`memory ${id} not found`);
      const updated = { ...existing, ...patch, updatedAt: Date.now() } as MemoryRecord;
      memoryRecords.set(id, updated);
      return updated;
    }),
    forget: vi.fn(async (id: string) => memoryRecords.delete(id)),
    get: vi.fn(async (id: string) => memoryRecords.get(id)),
  };
  const registry = { register: vi.fn(), unregister: vi.fn() };
  const agent = {
    type: 'main',
    config: {
      cwd: options.cwd ?? '/tmp',
      modelAlias: 'test-model',
      modelCapabilities: { max_context_tokens: 100_000 },
      provider,
      maxOutputSize: undefined,
    },
    context: {
      history: [
        { role: 'user', content: [{ type: 'text', text: 'fix the flaky test' }], toolCalls: [] },
      ],
      tokenCount: 1_000,
    },
    generate,
    records,
    log: { info: vi.fn(), warn: vi.fn() },
    experimentalFlags: { enabled: vi.fn(() => options.flagEnabled ?? true) },
    memory: options.withMemory === false ? undefined : memory,
    skills: { registry },
    kimiConfig: undefined,
    runtimeConfig: undefined,
  } as unknown as Agent;
  return { agent, generate, records, memory, memoryRecords, registry };
}

function promptCreatePlan(entry: { title: string; content: string }): string {
  return JSON.stringify({
    summary: 'captured a lesson',
    edits: [
      {
        kind: 'prompt',
        operation: 'create',
        title: entry.title,
        content: entry.content,
        evidence: 'agent rediscovered the convention twice',
      },
    ],
  });
}

describe('parseRefinePlan', () => {
  it('parses a valid plan wrapped in prose', () => {
    const plan = parseRefinePlan(
      `Here is the plan:\n${promptCreatePlan({ title: 't', content: 'c' })}\nDone.`,
    );
    expect(plan.summary).toBe('captured a lesson');
    expect(plan.edits).toHaveLength(1);
  });

  it('rejects text without JSON', () => {
    expect(() => parseRefinePlan('no json here')).toThrow(RefinePlanError);
  });

  it('rejects edits missing evidence', () => {
    expect(() =>
      parseRefinePlan(
        JSON.stringify({
          summary: 'x',
          edits: [{ kind: 'prompt', operation: 'create', title: 't', content: 'c' }],
        }),
      ),
    ).toThrow(RefinePlanError);
  });
});

describe('AgentRefineService', () => {
  const envBackup = process.env['SUPERLIORA_HOME'];
  afterEach(() => {
    if (envBackup === undefined) delete process.env['SUPERLIORA_HOME'];
    else process.env['SUPERLIORA_HOME'] = envBackup;
  });

  it('applies a prompt note and persists local state to the record log', async () => {
    const { agent, records } = makeAgent({
      planText: promptCreatePlan({ title: 'ESM imports', content: 'Always use .js suffix.' }),
    });
    const refine = new AgentRefineService(agent);

    const result = await refine.refine();

    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    const entries = refine.state().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('prompt');
    expect(entries[0]!.content).toBe('Always use .js suffix.');
    expect(entries[0]!.version).toBe(1);
    expect(records.logRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'harness.state' }),
    );
  });

  it('fails an update with a stale expectedVersion and keeps the entry', async () => {
    const { agent } = makeAgent({
      planText: promptCreatePlan({ title: 'note', content: 'v1 content' }),
    });
    const refine = new AgentRefineService(agent);
    await refine.refine();
    const entry = refine.state().entries[0]!;

    const stalePlan = JSON.stringify({
      summary: 'stale update',
      edits: [
        {
          kind: 'prompt',
          operation: 'update',
          targetId: entry.id,
          expectedVersion: 99,
          content: 'v2 content',
          evidence: 'tried to update',
        },
      ],
    });
    (agent.generate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: stalePlan }], toolCalls: [] },
      usage: null,
      finishReason: null,
      rawFinishReason: null,
    });

    const result = await refine.refine();

    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.error).toMatch(/version conflict/);
    expect(refine.state().entries[0]!.content).toBe('v1 content');
  });

  it('rolls back an update, restoring the prior content', async () => {
    const { agent } = makeAgent({
      planText: promptCreatePlan({ title: 'note', content: 'original' }),
    });
    const refine = new AgentRefineService(agent);
    await refine.refine();
    const entry = refine.state().entries[0]!;

    const updatePlan = JSON.stringify({
      summary: 'update',
      edits: [
        {
          kind: 'prompt',
          operation: 'update',
          targetId: entry.id,
          expectedVersion: 1,
          content: 'rewritten',
          evidence: 'improve wording',
        },
      ],
    });
    (agent.generate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: updatePlan }], toolCalls: [] },
      usage: null,
      finishReason: null,
      rawFinishReason: null,
    });
    const second = await refine.refine();
    expect(refine.state().entries[0]!.content).toBe('rewritten');

    const event = await refine.rollback(second.applied[0]!.id);

    expect(event.status).toBe('rolled_back');
    expect(refine.state().entries[0]!.content).toBe('original');
    expect(refine.state().entries[0]!.version).toBe(1);
  });

  it('rolls back a create by removing the entry', async () => {
    const { agent } = makeAgent({
      planText: promptCreatePlan({ title: 'note', content: 'temporary' }),
    });
    const refine = new AgentRefineService(agent);
    const result = await refine.refine();

    await refine.rollback(result.applied[0]!.id);

    expect(refine.state().entries).toHaveLength(0);
  });

  it('refuses to roll back an event superseded by a newer one on the same target', async () => {
    const { agent } = makeAgent({
      planText: promptCreatePlan({ title: 'note', content: 'v1' }),
    });
    const refine = new AgentRefineService(agent);
    const first = await refine.refine();
    const entry = refine.state().entries[0]!;
    const updatePlan = JSON.stringify({
      summary: 'update',
      edits: [
        {
          kind: 'prompt',
          operation: 'update',
          targetId: entry.id,
          expectedVersion: 1,
          content: 'v2',
          evidence: 'wording',
        },
      ],
    });
    (agent.generate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: null,
      message: { role: 'assistant', content: [{ type: 'text', text: updatePlan }], toolCalls: [] },
      usage: null,
      finishReason: null,
      rawFinishReason: null,
    });
    await refine.refine();

    await expect(refine.rollback(first.applied[0]!.id)).rejects.toThrow(/newer refinement/);
  });

  it('writes memory edits through the memory runtime and rolls them back', async () => {
    const plan = JSON.stringify({
      summary: 'remember the convention',
      edits: [
        {
          kind: 'memory',
          operation: 'create',
          subject: 'import style',
          content: 'This repo uses .js suffixes in ESM imports.',
          evidence: 'agent fixed import errors twice',
        },
      ],
    });
    const { agent, memory } = makeAgent({ planText: plan });
    const refine = new AgentRefineService(agent);

    const result = await refine.refine();

    expect(result.applied).toHaveLength(1);
    expect(memory.remember).toHaveBeenCalledOnce();
    const memoryId = result.applied[0]!.targetId;
    expect(await memory.get(memoryId)).toBeDefined();

    await refine.rollback(result.applied[0]!.id);
    expect(memory.forget).toHaveBeenCalledWith(memoryId);
  });

  it('creates a skill file, registers it, and rollback removes it', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'refine-skill-'));
    try {
      // autoSkillsRoot walks up for a .git dir; give the temp root one.
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(cwd, '.git'));
      const plan = JSON.stringify({
        summary: 'capture the retry playbook',
        edits: [
          {
            kind: 'skill',
            operation: 'create',
            name: 'retry-flaky-e2e',
            description: 'Retry flaky e2e tests safely',
            body: '1. Re-run with --retries=2\n2. Quarantine on second failure',
            evidence: 'agent reran flaky tests three times',
          },
        ],
      });
      const { agent, registry } = makeAgent({ planText: plan, cwd });
      const refine = new AgentRefineService(agent);

      const result = await refine.refine();

      const skillMd = join(cwd, '.agents', 'skills', 'auto', 'retry-flaky-e2e', 'SKILL.md');
      expect(result.applied).toHaveLength(1);
      expect(existsSync(skillMd)).toBe(true);
      expect(readFileSync(skillMd, 'utf-8')).toContain('Retry flaky e2e tests safely');
      expect(registry.register).toHaveBeenCalledOnce();

      await refine.rollback(result.applied[0]!.id);
      expect(existsSync(skillMd)).toBe(false);
      expect(registry.unregister).toHaveBeenCalledWith('retry-flaky-e2e');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('persists global scope to the global harness file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'refine-home-'));
    process.env['SUPERLIORA_HOME'] = home;
    try {
      const { agent } = makeAgent({
        planText: promptCreatePlan({ title: 'global note', content: 'works everywhere' }),
      });
      const refine = new AgentRefineService(agent);

      await refine.refine({ scope: 'global' });

      const stateFile = join(home, 'harness', 'harness_state.json');
      expect(existsSync(stateFile)).toBe(true);
      const saved = JSON.parse(readFileSync(stateFile, 'utf-8')) as { entries: HarnessEntry[] };
      expect(saved.entries).toHaveLength(1);
      expect(saved.entries[0]!.scope).toBe('global');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('restores local state from a replayed snapshot record', async () => {
    const { agent, records } = makeAgent({
      planText: promptCreatePlan({ title: 'note', content: 'persisted' }),
    });
    const refine = new AgentRefineService(agent);
    await refine.refine();
    const record = records.logRecord.mock.calls[0]![0] as {
      type: string;
      state: { entries: HarnessEntry[]; refinements: unknown[] };
    };

    const restored = new AgentRefineService(agent);
    restored.restoreState(structuredClone(record.state) as never);

    expect(restored.state().entries).toHaveLength(1);
    expect(restored.state().entries[0]!.content).toBe('persisted');
  });

  it('auto-refine stays idle below the turn interval and fires at it', async () => {
    const { agent, generate } = makeAgent();
    let now = 1_000_000;
    const refine = new AgentRefineService(agent, { now: () => now });
    now += AUTO_REFINE_COOLDOWN_MS + 1; // past the first-run floor
    generate.mockResolvedValueOnce(
      generateResult('{"shouldRefine":true,"rationale":"repeated failure","instructions":"focus on retries"}'),
    );

    for (let turn = 0; turn < AUTO_REFINE_TURN_INTERVAL - 1; turn++) refine.maybeAutoRefine('turn');
    expect(generate).not.toHaveBeenCalled();

    refine.maybeAutoRefine('turn');
    // review gate approves → planner call follows
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  });

  it('auto-refine skips the planning call when the review gate says no', async () => {
    const { agent, generate } = makeAgent();
    let now = 1_000_000;
    const refine = new AgentRefineService(agent, { now: () => now });
    now += AUTO_REFINE_COOLDOWN_MS + 1;
    generate.mockResolvedValueOnce(
      generateResult('{"shouldRefine":false,"rationale":"ordinary progress"}'),
    );

    for (let turn = 0; turn < AUTO_REFINE_TURN_INTERVAL; turn++) refine.maybeAutoRefine('turn');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(generate).toHaveBeenCalledOnce(); // no planner call
    expect(refine.state().entries).toHaveLength(0);
  });

  it('auto-refine waits out the cooldown before the next attempt', async () => {
    const { agent, generate } = makeAgent();
    let now = 1_000_000;
    const refine = new AgentRefineService(agent, { now: () => now });
    now += AUTO_REFINE_COOLDOWN_MS + 1;
    generate.mockResolvedValue(generateResult('{"shouldRefine":false,"rationale":"nothing"}'));

    for (let turn = 0; turn < AUTO_REFINE_TURN_INTERVAL; turn++) refine.maybeAutoRefine('turn');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());

    now += AUTO_REFINE_COOLDOWN_MS - 1; // still cooling down
    for (let turn = 0; turn < AUTO_REFINE_TURN_INTERVAL; turn++) refine.maybeAutoRefine('turn');
    expect(generate).toHaveBeenCalledOnce();

    now += 2; // cooldown elapsed
    for (let turn = 0; turn < AUTO_REFINE_TURN_INTERVAL; turn++) refine.maybeAutoRefine('turn');
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
  });

  it('auto-refine never fires inside the first cooldown window', () => {
    const { agent, generate } = makeAgent();
    const refine = new AgentRefineService(agent);

    for (let turn = 0; turn < AUTO_REFINE_TURN_INTERVAL * 2; turn++) refine.maybeAutoRefine('turn');
    expect(generate).not.toHaveBeenCalled();
  });

  it('auto-refine respects the flag', () => {
    const { agent, generate } = makeAgent({ flagEnabled: false });
    const refine = new AgentRefineService(agent);

    for (let turn = 0; turn < 30; turn++) refine.maybeAutoRefine('turn');
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('measured refinement (gate outcomes)', () => {
  it('scores every active entry on terminal gate outcomes', async () => {
    const { agent } = makeAgent({
      planText: promptCreatePlan({ title: 'note', content: 'measured' }),
    });
    const refine = new AgentRefineService(agent);
    await refine.refine();

    await refine.recordGateOutcome('passed');
    expect(refine.state().entries[0]!.score).toEqual({ confirmed: 1, failed: 0 });

    await refine.recordGateOutcome('exhausted');
    expect(refine.state().entries[0]!.score).toEqual({ confirmed: 1, failed: 1 });
  });

  it('auto-rolls-back an entry whose failures outpace confirmations', async () => {
    const { agent } = makeAgent({
      planText: promptCreatePlan({ title: 'bad note', content: 'misleading' }),
    });
    const refine = new AgentRefineService(agent);
    const result = await refine.refine();

    await refine.recordGateOutcome('exhausted');
    expect(refine.state().entries).toHaveLength(1); // failed=1, below threshold

    await refine.recordGateOutcome('exhausted');
    expect(refine.state().entries).toHaveLength(0); // failed=2 > confirmed=0 → rolled back
    expect(refine.state().refinements.find((event) => event.id === result.applied[0]!.id)?.status).toBe(
      'rolled_back',
    );
  });

  it('keeps entries whose confirmations keep pace with failures', async () => {
    const { agent } = makeAgent({
      planText: promptCreatePlan({ title: 'note', content: 'fine' }),
    });
    const refine = new AgentRefineService(agent);
    await refine.refine();

    await refine.recordGateOutcome('passed');
    await refine.recordGateOutcome('passed');
    await refine.recordGateOutcome('exhausted');
    await refine.recordGateOutcome('exhausted');

    expect(refine.state().entries).toHaveLength(1); // failed=2, confirmed=2 → survives
    expect(refine.state().entries[0]!.score).toEqual({ confirmed: 2, failed: 2 });
  });
});

describe('parseAutoRefineReview', () => {
  it('parses a valid review wrapped in prose', () => {
    const review = parseAutoRefineReview(
      'Sure.\n{"shouldRefine":true,"rationale":"user corrected twice","instructions":"capture the convention"}\nDone.',
    );
    expect(review.shouldRefine).toBe(true);
    expect(review.instructions).toBe('capture the convention');
  });

  it('parses a rejection', () => {
    const review = parseAutoRefineReview('{"shouldRefine":false,"rationale":"ordinary work"}');
    expect(review.shouldRefine).toBe(false);
    expect(review.instructions).toBeUndefined();
  });

  it('rejects text without JSON and JSON missing fields', () => {
    expect(() => parseAutoRefineReview('no json')).toThrow(RefineReviewError);
    expect(() => parseAutoRefineReview('{"summary":"x","edits":[]}')).toThrow(RefineReviewError);
  });
});

describe('HarnessInjector', () => {
  it('injects prompt notes once and re-injects after they change', async () => {
    const { agent } = makeAgent({
      planText: promptCreatePlan({ title: 'note', content: 'use strict null checks' }),
    });
    const refine = new AgentRefineService(agent);
    (agent as unknown as { refine: AgentRefineService }).refine = refine;
    const appended: string[] = [];
    const context = agent.context as unknown as {
      history: unknown[];
      appendSystemReminder: (text: string) => void;
    };
    context.appendSystemReminder = (text: string) => {
      appended.push(text);
    };

    const injector = new HarnessInjector(agent);
    await injector.inject();
    expect(appended).toHaveLength(0); // nothing refined yet

    await refine.refine();
    await injector.inject();
    expect(appended).toHaveLength(1);
    expect(appended[0]).toContain('use strict null checks');

    await injector.inject(); // unchanged → no duplicate
    expect(appended).toHaveLength(1);
  });
});

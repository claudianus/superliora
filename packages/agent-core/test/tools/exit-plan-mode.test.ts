/**
 * ExitPlanModeTool tests against the current Agent-backed tool surface.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import { parseWorkGraphNodesFromPlan } from '../../src/agent/plan/work-graph-from-plan';
import {
  ExitPlanModeInputSchema,
  ExitPlanModeTool,
} from '../../src/tools/builtin/planning/exit-plan-mode';
import { TODO_STORE_KEY } from '../../src/tools/builtin/state/todo-list';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../../src/tools/builtin/state/ultrawork-graph';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

interface DriftFixture {
  readonly goalDrift: number;
  readonly constraintDrift: number;
  readonly ontologyDrift: number;
}

function workGraphSection(): string[] {
  return [
    '## WorkGraph',
    '| Node ID | AC ID | Stage | Owner/Lane | Dependencies | Required Evidence |',
    '| ac_1 | AC-1 | swarm | main/implementation | none | focused test evidence |',
  ];
}

function makeAgent(
  input: {
    readonly active?: boolean | undefined;
    readonly plan?: string | null | undefined;
    readonly path?: string | undefined;
    readonly planFilePath?: string | null | undefined;
    readonly ultra?: boolean | undefined;
    readonly phase?: string | undefined;
    readonly drift?: DriftFixture | undefined;
    readonly emit?: ((event: unknown) => void) | undefined;
  } = {},
): {
  agent: Agent;
  requestApproval: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  toolStore: Record<string, unknown>;
} {
  let active = input.active ?? true;
  let phase = input.phase ?? 'exit';
  const requestApproval = vi.fn(async () => ({ decision: 'approved' }));
  const emit = vi.fn((event: unknown) => {
    input.emit?.(event);
    if ((event as { type?: string }).type === 'plan_mode.exit') active = false;
  });
  const reopenUltraInterviewForDrift = vi.fn(() => {
    phase = 'interview';
  });
  const toolStore: Record<string, unknown> = {};
  const agent = {
    planMode: {
      get isActive() {
        return active;
      },
      get planFilePath() {
        return input.planFilePath ?? null;
      },
      get isUltraMode() {
        return input.ultra ?? false;
      },
      get phase() {
        return phase;
      },
      reopenUltraInterviewForDrift,
      ultraEngine: {
        seedSpec: null,
        calculateDrift: vi.fn(() => input.drift ?? {
          goalDrift: 0,
          constraintDrift: 0,
          ontologyDrift: 0,
        }),
      },
      data: vi.fn(async () => {
        if (input.plan === null) return null;
        return {
          content: input.plan ?? 'Step 1: read files\nStep 2: fix bug',
          path: input.path ?? '/tmp/kimi-plan.md',
        };
      }),
      exit: () => {
        emit({ type: 'plan_mode.exit' });
      },
    },
    rpc: { requestApproval },
    telemetry: { track: vi.fn() },
    emit,
    records: { logRecord: vi.fn() },
    ultraSwarmEngageGate: { engage: vi.fn(), isActive: false },
    tools: {
      updateStore: vi.fn((key: string, value: unknown) => {
        toolStore[key] = value;
      }),
      getStore: vi.fn(() => ({
        get: (key: string) => toolStore[key],
        set: (key: string, value: unknown) => {
          toolStore[key] = value;
        },
      })),
    },
    ultrawork: {
      getActiveRunId: () => undefined,
      getRun: () => null,
      syncWorkGraphFromStore: vi.fn(),
	      completeLearnStage: vi.fn(() => null),
    },
    goal: {
      getGoal: vi.fn(() => ({ goal: null })),
      createGoal: vi.fn(async () => ({ goalId: 'test-goal', objective: 'test', status: 'active' })),
    },
  } as unknown as Agent;
  return { agent, requestApproval, emit, toolStore };
}

describe('ExitPlanModeTool', () => {
  it('has name, description, and parameters from the current schema', () => {
    const { agent } = makeAgent();
    const tool = new ExitPlanModeTool(agent);

    expect(tool.name).toBe('ExitPlanMode');
    expect(tool.description.length).toBeGreaterThan(0);
    expect(tool.description).toContain('This tool does NOT take the plan content as a parameter');
    expect(tool.description).toContain('For research tasks');
    expect(tool.description).toContain('Reject and Revise controls');
    expect(tool.description).toContain('If rejected, revise based on feedback');
    // The description must teach what a good plan looks like (concrete, verifiable).
    expect(tool.description.toLowerCase()).toContain('verifiable');
    expect(ExitPlanModeInputSchema.safeParse({}).success).toBe(true);
    expect(ExitPlanModeInputSchema.safeParse({ plan: '' }).success).toBe(false);
    expect(ExitPlanModeInputSchema.safeParse({ plan: 'a plan' }).success).toBe(false);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        options: { type: 'array' },
      },
    });
    const optionsSchema = (tool.parameters['properties'] as Record<string, unknown>)[
      'options'
    ] as {
      description?: string;
      items?: {
        properties?: Record<string, { description?: string }>;
      };
    };
    expect(optionsSchema.description).toContain('up to 3 options');
    expect(optionsSchema.description).toContain('single option');
    expect(optionsSchema.items?.properties?.['label']?.description).toContain('(Recommended)');
    expect(optionsSchema.items?.properties?.['description']?.description).toContain('trade-offs');
    expect((tool.parameters['properties'] as Record<string, unknown>)['plan']).toBeUndefined();
  });

  it('refuses to exit when plan mode is inactive', async () => {
    const { agent, emit } = makeAgent({ active: false });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_1',
      args: {},
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('plan mode');
    expect(emit).not.toHaveBeenCalled();
  });

  it('exits with the current plan without consulting permission approval', async () => {
    const { agent, requestApproval, emit } = makeAgent({
      plan: '# File Plan',
      path: '/tmp/kimi-plan.md',
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_1',
      args: {},
      signal,
    });

    expect(result.isError).toBe(false);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith({ type: 'plan_mode.exit' });
    expect(result.output).toContain('Plan saved to: /tmp/kimi-plan.md');
    expect(result.output).toContain('# File Plan');
  });

  it('does not use inline plan fallback when no plan file exists', async () => {
    const { agent, emit } = makeAgent({ plan: null });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_inline',
      args: {},
      signal,
    });

    expect(result.isError).toBe(true);
    expect(emit).not.toHaveBeenCalled();
    expect(result.output).toContain('No plan file found');
  });

  it('returns an error when no plan content is available', async () => {
    const { agent, emit } = makeAgent({
      plan: '',
      path: '/tmp/kimi-plan.md',
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_empty',
      args: {},
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('Write your plan to /tmp/kimi-plan.md first');
    expect(emit).not.toHaveBeenCalled();
  });

  it('surfaces errors from plan exit as a tool error', async () => {
    const { agent } = makeAgent({
      emit: () => {
        throw new Error('journal write failed');
      },
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_fail',
      args: {},
      signal,
    });

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('journal write failed');
  });

  it('accepts a complete Ultra Plan written with Markdown bold field labels', async () => {
    const { agent, emit } = makeAgent({
      ultra: true,
      phase: 'exit',
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        '- **Verifiable UltraGoal:** True when the requested token is emitted by the prompt and the focused test asserts it; false otherwise.',
        '- **Completion Criterion:** Both the harness check and focused vitest command pass.',
        '- **Actors:** CLI user, implementation agent, verification owner.',
        '- **Inputs:** Source file, test file, harness verifier.',
        '- **Outputs:**',
        '  - Source guidance contains the requested token.',
        '  - Test asserts the prompt contains the token.',
        '- **Constraints:** No comments, no unrelated files.',
        '- **Non-goals:** No full-suite rewrite.',
        '- **Acceptance Criteria:** Token emitted, test assertion present, checks pass.',
        '- **Verification Plan:** Run harness check and focused vitest.',
        '- **Failure Modes:** Token in comment, vacuous assertion, missing verification.',
        '- **Runtime Context:** Local TypeScript monorepo.',
        '',
        '## AC Tree',
        '- Token emitted',
        '- Test coverage',
        '- Verification passes',
        '',
        ...workGraphSection(),
        '',
        '## Swarm Decision',
        'Swarm decision: DEFER - Bounded deterministic edit.; value: none; owner: main agent.',
        '- **Decision:** DEFER',
        '- **Reason:** Bounded deterministic edit.',
        '- **Specialist value:** none',
        '- **Verification owner:** main agent',
        '- **Swarm DEFER waiver:** Single-owner source/test edit with no external, subjective, security, performance, or independent-review lane.',
        '',
        '## Evaluation Plan',
        '- Mechanical and focused unit checks.',
        '',
        '## Execution Plan',
        '1. Edit source.',
        '2. Edit test.',
        '3. Run checks.',
      ].join('\n'),
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit',
      args: {},
      signal,
    });

    expect(result.isError).toBe(false);
    expect(emit).toHaveBeenCalledWith({ type: 'plan_mode.exit' });
    expect(result.output).not.toContain('UltraSwarm ENGAGE is binding');
  });

  it('keeps Ultra Plan active when drift exceeds the accepted threshold', async () => {
    const { agent, emit } = makeAgent({
      ultra: true,
      phase: 'exit',
      drift: {
        goalDrift: 0.964,
        constraintDrift: 0,
        ontologyDrift: 0.7,
      },
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        '- **Verifiable UltraGoal:** True when checks pass; false otherwise.',
        '- **Completion Criterion:** Both checks pass.',
        '- **Actors:** CLI user, agent, and verification owner.',
        '- **Inputs:** Source, tests, and user prompt.',
        '- **Outputs:** Source edits, tests, and verification evidence.',
        '- **Constraints:** Minimal change and no unrelated files.',
        '- **Non-goals:** No broad refactor.',
        '- **Acceptance Criteria:** Behavior works and checks pass.',
        '- **Verification Plan:** Run focused checks.',
        '- **Failure Modes:** Wrong scope or failing checks.',
        '- **Runtime Context:** Local TypeScript monorepo.',
        '',
        '## AC Tree',
        '- Done',
        '',
        ...workGraphSection(),
        '',
        '## Swarm Decision',
        'Swarm decision: DEFER - Bounded deterministic edit.; value: none; owner: main agent.',
        '- **Decision:** DEFER',
        '- **Reason:** Bounded deterministic edit.',
        '- **Specialist value:** none',
        '- **Verification owner:** main agent',
        '- **Swarm DEFER waiver:** Single-owner deterministic edit with focused checks and no specialist-only risk.',
        '',
        '## Evaluation Plan',
        '- Run focused checks.',
        '',
        '## Execution Plan',
        '1. Edit source.',
        '2. Run checks.',
      ].join('\n'),
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit_high_drift',
      args: {},
      signal,
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('ExitPlanMode blocked');
    expect(result.output).toContain('Combined Drift: 0.622 (threshold: 0.4)');
    expect(result.output).toContain('Status: BLOCKED');
    expect(result.output).toContain('Ultra Plan interview has been reopened');
    expect(result.output).toContain('Ask 1-3 focused AskUserQuestion questions');
    expect(agent.planMode.phase).toBe('interview');
    expect(agent.planMode.reopenUltraInterviewForDrift).toHaveBeenCalledWith({
      goalDrift: 0.964,
      constraintDrift: 0,
      ontologyDrift: 0.7,
    });
    expect(emit).not.toHaveBeenCalled();
  });

  it('tells approved Ultra Plan ENGAGE decisions to call UltraSwarm next', async () => {
    const { agent, emit, toolStore } = makeAgent({
      ultra: true,
      phase: 'exit',
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        '- **Verifiable UltraGoal:** True when the requested behavior is implemented and verified; false otherwise.',
        '- **Completion Criterion:** Implementation, expert review, and focused checks pass.',
        '- **Actors:** CLI user, implementation agent, specialist reviewers, verification owner.',
        '- **Inputs:** Source files, tests, coverage matrix, and runtime evidence.',
        '- **Outputs:** Source changes, tests, specialist verdicts, and verification evidence.',
        '- **Constraints:** No unrelated refactors; specialists must report concrete evidence.',
        '- **Non-goals:** No full-suite rewrite.',
        '- **Acceptance Criteria:** Behavior works, tests pass, specialist review returns PASS or explicit blocker.',
        '- **Verification Plan:** Run focused checks and review specialist evidence.',
        '- **Failure Modes:** Skipped specialist review, missing evidence, or unverified implementation.',
        '- **Runtime Context:** Local TypeScript monorepo.',
        '',
        '## AC Tree',
        '- Behavior implemented',
        '- Specialist review complete',
        '- Verification passes',
        '',
        ...workGraphSection(),
        '',
        '## Swarm Decision',
        'Swarm decision: ENGAGE - Architecture and QA review materially reduce risk.; value: architecture and QA specialist review; owner: verification owner.',
        '- **Decision:** ENGAGE',
        '- **Reason:** Architecture and QA review materially reduce risk.',
        '- **Specialist value:** architecture and QA specialist review',
        '- **Verification owner:** verification owner',
        '',
        '## Evaluation Plan',
        '- Mechanical checks plus specialist verdicts.',
        '',
        '## Execution Plan',
        '1. Call UltraSwarm with the WorkGraph node.',
        '2. Integrate specialist output.',
        '3. Run checks.',
      ].join('\n'),
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit_engage',
      args: {},
      signal,
    });

    expect(result.isError).toBe(false);
    expect(emit).toHaveBeenCalledWith({ type: 'plan_mode.exit' });
    expect(result.output).toContain('UltraSwarm ENGAGE is binding');
    expect(result.output).toContain('call UltraSwarm as the only tool call');
    expect(result.output).toContain('work_node_ids: ac_1');
    expect(result.output).toContain('## UltraworkGraph Seed');
    expect(toolStore[ULTRAWORK_GRAPH_STORE_KEY]).toMatchObject({
      runId: 'ultra-plan-kimi-plan',
      nodes: [expect.objectContaining({ id: 'ac_1', acceptanceCriterionId: 'AC-1', stage: 'swarm' })],
    });
    expect(toolStore[TODO_STORE_KEY]).toEqual([
      { title: '[ac_1] [AC-1] focused test evidence', status: 'pending' },
    ]);
  });

  it('blocks Ultra Plan exit when the Swarm decision lacks specialist value and owner', async () => {
    const { agent, emit } = makeAgent({
      ultra: true,
      phase: 'exit',
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        '- **Verifiable UltraGoal:** True when checks pass; false otherwise.',
        '- **Completion Criterion:** Both checks pass.',
        '- **Actors:** CLI user and agent.',
        '- **Inputs:** Source and test.',
        '- **Outputs:** Source and test changes.',
        '- **Constraints:** Minimal change.',
        '- **Non-goals:** No unrelated edits.',
        '- **Acceptance Criteria:** Assertions pass.',
        '- **Verification Plan:** Run checks.',
        '- **Failure Modes:** Missing token.',
        '- **Runtime Context:** Local repo.',
        '',
        '## AC Tree',
        '- Done',
        '',
        ...workGraphSection(),
        '',
        '## Evaluation Plan',
        '- Run checks.',
        '',
        '## Execution Plan',
        '1. Swarm decision: DEFER — bounded deterministic edit.',
      ].join('\n'),
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit_missing',
      args: {},
      signal,
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Specialist value');
    expect(result.output).toContain('Verification owner');
    expect(emit).not.toHaveBeenCalled();
  });

  it('blocks Ultra Plan exit when the WorkGraph section is missing', async () => {
    const { agent, emit } = makeAgent({
      ultra: true,
      phase: 'exit',
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        '- **Verifiable UltraGoal:** True when checks pass; false otherwise.',
        '- **Completion Criterion:** Both checks pass.',
        '- **Actors:** CLI user and agent.',
        '- **Inputs:** Source and test.',
        '- **Outputs:** Source and test changes.',
        '- **Constraints:** Minimal change.',
        '- **Non-goals:** No unrelated edits.',
        '- **Acceptance Criteria:** Assertions pass.',
        '- **Verification Plan:** Run checks.',
        '- **Failure Modes:** Missing token.',
        '- **Runtime Context:** Local repo.',
        '',
        '## AC Tree',
        '- Done',
        '',
        '## Swarm Decision',
        'Swarm decision: DEFER - Bounded deterministic edit.; value: none; owner: main agent.',
        '- **Decision:** DEFER',
        '- **Reason:** Bounded deterministic edit.',
        '- **Specialist value:** none',
        '- **Verification owner:** main agent',
        '- **Swarm DEFER waiver:** Single-owner deterministic edit.',
        '',
        '## Evaluation Plan',
        '- Run checks.',
        '',
        '## Execution Plan',
        '1. Edit source.',
      ].join('\n'),
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit_missing_work_graph',
      args: {},
      signal,
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('WorkGraph');
    expect(emit).not.toHaveBeenCalled();
  });

  it('blocks Ultra Plan exit when the Swarm decision lacks the audit line', async () => {
    const { agent, emit } = makeAgent({
      ultra: true,
      phase: 'exit',
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        '- **Verifiable UltraGoal:** True when checks pass; false otherwise.',
        '- **Completion Criterion:** Both checks pass.',
        '- **Actors:** CLI user and agent.',
        '- **Inputs:** Source and test.',
        '- **Outputs:** Source and test changes.',
        '- **Constraints:** Minimal change.',
        '- **Non-goals:** No unrelated edits.',
        '- **Acceptance Criteria:** Assertions pass.',
        '- **Verification Plan:** Run checks.',
        '- **Failure Modes:** Missing token.',
        '- **Runtime Context:** Local repo.',
        '',
        '## AC Tree',
        '- Done',
        '',
        ...workGraphSection(),
        '',
        '## Swarm Decision',
        '- **Decision:** DEFER',
        '- **Reason:** Bounded deterministic edit.',
        '- **Specialist value:** none',
        '- **Verification owner:** main agent',
        '- **Swarm DEFER waiver:** Single-owner deterministic edit.',
        '',
        '## Evaluation Plan',
        '- Run checks.',
        '',
        '## Execution Plan',
        '1. Edit source.',
      ].join('\n'),
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit_missing_audit_line',
      args: {},
      signal,
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Swarm decision audit line');
    expect(emit).not.toHaveBeenCalled();
  });

  it('blocks Ultra Plan DEFER without a waiver', async () => {
    const { agent, emit } = makeAgent({
      ultra: true,
      phase: 'exit',
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        '- **Verifiable UltraGoal:** True when checks pass; false otherwise.',
        '- **Completion Criterion:** Both checks pass.',
        '- **Actors:** CLI user and agent.',
        '- **Inputs:** Source and test.',
        '- **Outputs:** Source and test changes.',
        '- **Constraints:** Minimal change.',
        '- **Non-goals:** No unrelated edits.',
        '- **Acceptance Criteria:** Assertions pass.',
        '- **Verification Plan:** Run checks.',
        '- **Failure Modes:** Missing token.',
        '- **Runtime Context:** Local repo.',
        '',
        '## AC Tree',
        '- Done',
        '',
        ...workGraphSection(),
        '',
        '## Swarm Decision',
        'Swarm decision: DEFER - Bounded deterministic edit.; value: none; owner: main agent.',
        '- **Decision:** DEFER',
        '- **Reason:** Bounded deterministic edit.',
        '- **Specialist value:** none',
        '- **Verification owner:** main agent',
        '',
        '## Evaluation Plan',
        '- Run checks.',
        '',
        '## Execution Plan',
        '1. Edit source.',
      ].join('\n'),
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit_missing_defer_waiver',
      args: {},
      signal,
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Swarm DEFER waiver');
    expect(emit).not.toHaveBeenCalled();
  });

  it('blocks Ultra Plan DEFER with a placeholder waiver', async () => {
    const { agent, emit } = makeAgent({
      ultra: true,
      phase: 'exit',
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        '- **Verifiable UltraGoal:** True when checks pass; false otherwise.',
        '- **Completion Criterion:** Both checks pass.',
        '- **Actors:** CLI user and agent.',
        '- **Inputs:** Source and test.',
        '- **Outputs:** Source and test changes.',
        '- **Constraints:** Minimal change.',
        '- **Non-goals:** No unrelated edits.',
        '- **Acceptance Criteria:** Assertions pass.',
        '- **Verification Plan:** Run checks.',
        '- **Failure Modes:** Missing token.',
        '- **Runtime Context:** Local repo.',
        '',
        '## AC Tree',
        '- Done',
        '',
        ...workGraphSection(),
        '',
        '## Swarm Decision',
        'Swarm decision: DEFER - Bounded deterministic edit.; value: none; owner: main agent.',
        '- **Decision:** DEFER',
        '- **Reason:** Bounded deterministic edit.',
        '- **Specialist value:** none',
        '- **Verification owner:** main agent',
        '- **Swarm DEFER waiver:** none',
        '',
        '## Evaluation Plan',
        '- Run checks.',
        '',
        '## Execution Plan',
        '1. Edit source.',
      ].join('\n'),
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit_placeholder_defer_waiver',
      args: {},
      signal,
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Swarm DEFER waiver');
    expect(emit).not.toHaveBeenCalled();
  });

  it('accepts Ultra Plan required fields written as markdown headings with body text', async () => {
    const { agent, emit } = makeAgent({
      ultra: true,
      phase: 'exit',
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        'Summary of the bounded implementation task.',
        '',
        '## Verifiable UltraGoal',
        'True when the requested prompt token is emitted and covered by the focused test; false otherwise.',
        '',
        '## Completion Criterion',
        'The harness verifier and focused vitest command both pass.',
        '',
        '## Actors',
        'CLI user, implementation agent, and verification owner.',
        '',
        '## Inputs',
        'Source file, test file, and harness verifier.',
        '',
        '## Outputs',
        'Source/test edits and passing verification evidence.',
        '',
        '## Constraints',
        'No comments-only token and no unrelated edits.',
        '',
        '## Non-goals',
        'No command rename or broad refactor.',
        '',
        '## Acceptance Criteria',
        'Token emitted, test assertion present, checks pass.',
        '',
        '## Verification Plan',
        'Run the harness verifier and focused vitest.',
        '',
        '## Failure Modes',
        'Token in wrong location or vacuous assertion.',
        '',
        '## Runtime Context',
        'Local TypeScript monorepo worktree.',
        '',
        '## Reason',
        'The task is bounded and deterministic.',
        '',
        '## AC Tree',
        '- Source edit',
        '- Test edit',
        '- Verification',
        '',
        ...workGraphSection(),
        '',
        '## Evaluation Plan',
        '- Mechanical checks.',
        '',
        '## Execution Plan',
        'Edit source, edit test, run checks.',
        '',
        '## Swarm Decision',
        'Swarm decision: DEFER. Bounded deterministic edit. value: none; owner: main agent.',
        'Swarm DEFER waiver: Single-owner source/test edit with no specialist lane.',
      ].join('\n'),
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit_headings',
      args: {},
      signal,
    });

    expect(result.isError).toBe(false);
    expect(emit).toHaveBeenCalledWith({ type: 'plan_mode.exit' });
  });

  it('auto-creates an UltraGoal from the run objective when none exists', async () => {
    const { agent, emit } = makeAgent({
      ultra: true,
      phase: 'exit',
      plan: [
        '# Ultra Plan',
        '',
        '## Seed Spec',
        'Summary of the bounded implementation task.',
        '',
        '## Verifiable UltraGoal',
        'True when the requested prompt token is emitted and covered by the focused test; false otherwise.',
        '',
        '## Completion Criterion',
        'The harness verifier and focused vitest command both pass.',
        '',
        '## Actors',
        'CLI user, implementation agent, and verification owner.',
        '',
        '## Inputs',
        'Source file, test file, and harness verifier.',
        '',
        '## Outputs',
        'Source/test edits and passing verification evidence.',
        '',
        '## Constraints',
        'Minimal change; no unrelated edits.',
        '',
        '## Non-goals',
        'No full-suite rewrite.',
        '',
        '## Acceptance Criteria',
        'Token emitted and focused test passes.',
        '',
        '## Verification Plan',
        'Run the harness verifier and the focused vitest command.',
        '',
        '## Failure Modes',
        'Missing token or failing test.',
        '',
        '## Runtime Context',
        'Local TypeScript monorepo.',
        '',
        '## AC Tree',
        '- Token emitted',
        '- Focused test passes',
        '',
        ...workGraphSection(),
        '',
        '## Evaluation Plan',
        '- Harness verifier and focused vitest.',
        '',
        '## Execution Plan',
        'Edit source, edit test, run checks.',
        '',
        '## Swarm Decision',
        'Swarm decision: DEFER. Bounded deterministic edit. value: none; owner: main agent.',
        'Swarm DEFER waiver: Single-owner source/test edit with no specialist lane.',
      ].join('\n'),
    });
    // Override getRun to return a run with an objective so the goal
    // auto-creation path triggers.
    (agent.ultrawork as { getRun: () => unknown }).getRun = () => ({
      id: 'uw-auto-goal',
      objective: 'Ship the auto-created UltraGoal',
      status: 'running',
      stage: 'goal',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });

    const result = await executeTool(new ExitPlanModeTool(agent), {
      turnId: '0',
      toolCallId: 'call_ultra_exit_auto_goal',
      args: {},
      signal,
    });

    expect(result.isError).toBe(false);
    expect(emit).toHaveBeenCalledWith({ type: 'plan_mode.exit' });
    expect(agent.goal.createGoal).toHaveBeenCalledWith(
      { objective: 'Ship the auto-created UltraGoal' },
      'runtime',
    );
  });
  it('exposes options[].description as optional with a default of empty string', () => {
    const { agent } = makeAgent();
    const tool = new ExitPlanModeTool(agent);

    const optionItems = (
      (tool.parameters['properties'] as Record<string, unknown>)['options'] as {
        items?: {
          required?: readonly string[];
          properties?: Record<string, { default?: unknown }>;
        };
      }
    ).items;

    expect(optionItems?.required).toEqual(['label']);
    expect(optionItems?.required).not.toContain('description');
    expect(optionItems?.properties?.['description']?.default).toBe('');
  });

  it('accepts an option that omits description', () => {
    const result = ExitPlanModeInputSchema.safeParse({
      options: [{ label: 'Approach A' }],
    });

    expect(result.success).toBe(true);
  });

  it('defaults a missing option description to an empty string', () => {
    const result = ExitPlanModeInputSchema.safeParse({
      options: [{ label: 'Approach A' }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.options?.[0]?.description).toBe('');
    }
  });
});

import type { ToolCall } from '@moonshot-ai/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import type {
  PermissionMode,
  PermissionPolicyContext,
  PermissionPolicyResult,
} from '../../src/agent/permission';
import { PlanModeGuardDenyPermissionPolicy } from '../../src/agent/permission/policies/plan-mode-guard-deny';
import { PlanMode } from '../../src/agent/plan';
import { ToolAccesses } from '../../src/loop';
import type { ToolExecutionHookContext } from '../../src/loop';
import { NextPhaseTool } from '../../src/tools/builtin/planning/next-phase';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

async function activePlanAgent(
  options: { ultra?: boolean } = {},
): Promise<{ agent: Agent; planMode: PlanMode }> {
  const agent = {
    homedir: '/tmp/kimi-plan-test',
    emitStatusUpdated: vi.fn(),
    records: { logRecord: vi.fn() },
    replayBuilder: { push: vi.fn() },
    telemetry: { track: vi.fn() },
    kaos: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Agent;
  const planMode = new PlanMode(agent);
  Object.assign(agent, { planMode });
  await planMode.enter('current-plan', false, true, options.ultra ?? false);
  return { agent, planMode };
}

function hookContext(toolName: string, args: unknown): ToolExecutionHookContext {
  return {
    turnId: '0',
    stepNumber: 1,
    signal,
    llm: {} as ToolExecutionHookContext['llm'],
    args,
    toolCall: {
      type: 'function',
      id: `call_${toolName}`,
      name: toolName,
      arguments: JSON.stringify(args),
    } satisfies ToolCall,
    toolCalls: [
      {
        type: 'function',
        id: `call_${toolName}`,
        name: toolName,
        arguments: JSON.stringify(args),
      },
    ],
  };
}

function policyContext(
  toolName: string,
  args: unknown,
  _mode: PermissionMode = 'manual',
  accesses = toolAccesses(toolName, args),
): PermissionPolicyContext {
  return {
    ...hookContext(toolName, args),
    execution: {
      accesses,
      approvalRule: toolName,
      execute: async () => ({ output: '' }),
    },
  };
}

function evaluatePlanPolicy(
  agent: Agent,
  toolName: string,
  args: unknown,
  mode: PermissionMode = 'manual',
) {
  return new PlanModeGuardDenyPermissionPolicy(agent).evaluate(policyContext(toolName, args, mode));
}

describe('Plan mode permission policy', () => {
  it('allows Write and Edit to the active plan file', async () => {
    const { agent, planMode } = await activePlanAgent();
    const planPath = planMode.planFilePath;
    if (planPath === null) throw new Error('expected plan path');

    expect(evaluatePlanPolicy(agent, 'Write', { path: planPath })).toBeUndefined();
    expect(
      evaluatePlanPolicy(
        agent,
        'Edit',
        {
          path: planPath,
          old_string: 'A',
          new_string: 'B',
        },
      ),
    ).toBeUndefined();
  });

  it('blocks Write and Edit to non-plan files before permission approval', async () => {
    const { agent } = await activePlanAgent();

    const write = evaluatePlanPolicy(agent, 'Write', {
      path: '/workspace/src/main.ts',
      content: 'x',
    });
    const edit = evaluatePlanPolicy(agent, 'Edit', {
      path: '/workspace/src/main.ts',
      old_string: 'A',
      new_string: 'B',
    });

    const writeDeny = expectDeny(write);
    expect(writeDeny.message ?? '').toContain('current plan file');
    expect(writeDeny.message ?? '').toContain('ExitPlanMode');
    const editDeny = expectDeny(edit);
    expect(editDeny.message ?? '').toContain('current plan file');
  });

  it('blocks file edits when plan mode has no selected plan file path', async () => {
    const { agent, planMode } = await activePlanAgent();
    (planMode as unknown as { _planFilePath: string | null })._planFilePath = null;

    const result = evaluatePlanPolicy(agent, 'Edit', {
      path: '/workspace/src/other.ts',
      old_string: 'A',
      new_string: 'B',
    });

    const deny = expectDeny(result);
    expect(deny.message ?? '').toContain('(no plan file selected yet)');
    expect(deny.message ?? '').toContain('ExitPlanMode');
  });

  it('blocks file writes when plan mode has no selected plan file path', async () => {
    const { agent, planMode } = await activePlanAgent();
    (planMode as unknown as { _planFilePath: string | null })._planFilePath = null;

    const result = evaluatePlanPolicy(agent, 'Write', {
      path: '/workspace/src/other.ts',
      content: 'x',
    });

    const deny = expectDeny(result);
    expect(deny.message ?? '').toContain('(no plan file selected yet)');
    expect(deny.message ?? '').toContain('ExitPlanMode');
  });

  it('blocks Write and Edit with no file write access while plan mode is active', async () => {
    const { agent } = await activePlanAgent();

    const write = new PlanModeGuardDenyPermissionPolicy(agent).evaluate(
      policyContext('Write', { content: 'x' }, 'manual', ToolAccesses.none()),
    );
    const edit = new PlanModeGuardDenyPermissionPolicy(agent).evaluate(
      policyContext(
        'Edit',
        { old_string: 'A', new_string: 'B' },
        'manual',
        ToolAccesses.none(),
      ),
    );

    expectDeny(write);
    expectDeny(edit);
  });

  it('allows multiple writes when every write access targets the active plan file', async () => {
    const { agent, planMode } = await activePlanAgent();
    const planPath = planMode.planFilePath;
    if (planPath === null) throw new Error('expected plan path');

    const result = new PlanModeGuardDenyPermissionPolicy(agent).evaluate(
      policyContext(
        'Write',
        { path: planPath, content: 'x' },
        'manual',
        [
          { kind: 'file', operation: 'write', path: planPath },
          { kind: 'file', operation: 'readwrite', path: planPath },
        ],
      ),
    );

    expect(result).toBeUndefined();
  });

  it('blocks mixed plan-file and non-plan-file write accesses', async () => {
    const { agent, planMode } = await activePlanAgent();
    const planPath = planMode.planFilePath;
    if (planPath === null) throw new Error('expected plan path');

    const result = new PlanModeGuardDenyPermissionPolicy(agent).evaluate(
      policyContext(
        'Edit',
        { path: planPath, old_string: 'A', new_string: 'B' },
        'manual',
        [
          { kind: 'file', operation: 'readwrite', path: planPath },
          { kind: 'file', operation: 'write', path: '/workspace/src/main.ts' },
        ],
      ),
    );

    const deny = expectDeny(result);
    expect(deny.message ?? '').toContain('current plan file');
  });

  it('does not block read-only tools while plan mode is active', async () => {
    const { agent } = await activePlanAgent();

    expect(evaluatePlanPolicy(agent, 'Read', { path: '/workspace/src/main.ts' })).toBeUndefined();
    expect(evaluatePlanPolicy(agent, 'Grep', { pattern: 'TODO', path: '/workspace' })).toBeUndefined();
  });

  it('starts Ultra Plan in research phase before user questions are allowed', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });

    expect(planMode.phase).toBe('research');
    expect(evaluatePlanPolicy(agent, 'WebSearch', { query: 'current API release notes' })).toBeUndefined();
    expect(evaluatePlanPolicy(agent, 'FetchURL', { url: 'https://example.com' })).toBeUndefined();
    expect(evaluatePlanPolicy(agent, 'KimiContext', { query: 'ultrawork' })).toBeUndefined();
    expect(evaluatePlanPolicy(agent, 'SearchExpert', { query: 'architecture review' })).toBeUndefined();

    const questionDeny = expectDeny(
      evaluatePlanPolicy(agent, 'AskUserQuestion', { question: 'Which option?' }),
    );
    expect(questionDeny.message ?? '').toContain('blocked in Research phase');
    expect(questionDeny.message ?? '').toContain('NextPhase({ phase: "interview" })');
  });

  it('advances Ultra Plan from research to interview after evidence collection', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });

    const result = await executeTool(new NextPhaseTool(agent), {
      turnId: '0',
      toolCallId: 'call_next_phase_interview',
      args: { phase: 'interview' },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Advanced from research phase to interview phase');
    expect(result.output).toContain('Use AskUserQuestion');
    expect(planMode.phase).toBe('interview');
  });

  it('keeps ultra interview in interview after repeated question rounds when seed gaps remain', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('interview');

    expect(
      evaluatePlanPolicy(agent, 'AskUserQuestion', { question: 'What matters most?' }),
    ).toBeUndefined();
    expect(planMode.phase).toBe('interview');
    expect(planMode.interviewRoundCount).toBe(1);

    expect(
      evaluatePlanPolicy(agent, 'AskUserQuestion', { question: 'What should be verified?' }),
    ).toBeUndefined();
    expect(planMode.phase).toBe('interview');
    expect(planMode.interviewRoundCount).toBe(2);

    expect(
      evaluatePlanPolicy(agent, 'AskUserQuestion', { question: 'What can wait?' }),
    ).toBeUndefined();
    expect(planMode.phase).toBe('interview');
    expect(planMode.interviewRoundCount).toBe(3);
  });

  it('blocks actionable ultra plans from advancing until the seed ledger is ready', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('interview');

    const result = await executeTool(new NextPhaseTool(agent), {
      turnId: '0',
      toolCallId: 'call_next_phase',
      args: { phase: 'design' },
      signal,
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('UltraPlan interview is not ready for Design.');
    expect(result.output).toContain('open_gaps=');
    expect(planMode.phase).toBe('interview');
    expect(planMode.interviewRoundCount).toBe(0);
  });

  it('lets ultra interview advance once the seed ledger and verifiable goal are closed', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('interview');
    planMode.ultraEngine.addInterviewRound(
      'Close the UltraPlan seed ledger.',
      [
        'Goal: implement guarded Ultrawork mode with a verifiable UltraGoal.',
        'Actors: CLI user, agent, verification owner.',
        'Inputs: user prompt, TUI state, session status, and focused tests.',
        'Outputs: updated TUI mode, prompt contract, and passing tests.',
        'Constraints: no regex promotion for plain tasks, no product edits before plan approval, no unrelated refactors.',
        'Non-goals: do not rewrite the full app or change provider auth.',
        'Acceptance Criteria: Shift-Tab mode routes tasks through UltraPlan; plain prompts stay normal; tests pass.',
        'Verification Plan: run focused TUI and agent-core tests.',
        'Failure Modes: stale badges, premature goal creation, skipped Swarm decision, and blocked existing goals.',
        'Runtime Context: local TypeScript monorepo CLI workspace.',
        'Completion Criterion: true when the checks pass and the mode follows the gated order, false otherwise.',
      ].join('\n'),
    );
    planMode.ultraEngine.calculateAmbiguityScore();
    planMode.ultraEngine.addInterviewRound(
      'Confirm the seed-ready contract.',
      'Confirmed: the required Seed sections, verification plan, failure modes, runtime context, and true/false completion criterion are complete without adding scope.',
    );

    const result = await executeTool(new NextPhaseTool(agent), {
      turnId: '0',
      toolCallId: 'call_next_phase',
      args: { phase: 'design' },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Advanced from interview phase to design phase');
    expect(result.output).toContain("call NextPhase({ phase: 'review' })");
    expect(planMode.phase).toBe('design');
    expect(planMode.ultraEngine.seedSpec?.goal).toContain('implement guarded Ultrawork mode');
  });

  it('tells Ultra Plan review to advance to write after verification', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('review');

    const result = await executeTool(new NextPhaseTool(agent), {
      turnId: '0',
      toolCallId: 'call_next_phase_write',
      args: { phase: 'write' },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Advanced from review phase to write phase');
    expect(result.output).toContain('Write Phase');
    expect(planMode.phase).toBe('write');
  });

  it('mentions web verification when entering Ultra Plan review', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('design');

    const result = await executeTool(new NextPhaseTool(agent), {
      turnId: '0',
      toolCallId: 'call_next_phase_review',
      args: { phase: 'review' },
      signal,
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Advanced from design phase to review phase');
    expect(result.output).toContain('WebSearch');
    expect(result.output).toContain('FetchURL');
    expect(planMode.phase).toBe('review');
  });

  it('allows current web verification during Ultra Plan review', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('review');

    expect(evaluatePlanPolicy(agent, 'WebSearch', { query: 'current library best practices' })).toBeUndefined();
    expect(evaluatePlanPolicy(agent, 'FetchURL', { url: 'https://example.com/docs' })).toBeUndefined();
  });

  it.each([
    ['ReadMediaFile', { path: '/workspace/screenshot.png' }],
    ['KimiContext', { query: 'plan mode guard' }],
    ['SearchSkill', { query: 'tui review workflow' }],
    ['Skill', { skill: 'write-tui' }],
    ['SearchExpert', { query: 'testing evidence review' }],
    ['TaskList', {}],
    ['TaskOutput', { task_id: 'task_123' }],
  ] as const)('allows %s as read-only Ultra Plan review context', async (toolName, args) => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('review');

    expect(evaluatePlanPolicy(agent, toolName, args)).toBeUndefined();
  });

  it('points blocked interview tools toward NextPhase when no question is needed', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('interview');

    const deny = expectDeny(evaluatePlanPolicy(agent, 'ExitPlanMode', {}));

    expect(deny.message ?? '').toContain('call NextPhase');
    expect(deny.message ?? '').not.toContain('at least 3 interview rounds');
  });

  it('explains that EnterPlanMode is not a phase transition tool in ultra interview', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('interview');

    const deny = expectDeny(evaluatePlanPolicy(agent, 'EnterPlanMode', {}));

    expect(deny.message ?? '').toContain('EnterPlanMode is already active');
    expect(deny.message ?? '').toContain('Use NextPhase');
  });

  it.each([
    ['design', 'review'],
    ['review', 'write'],
    ['write', 'exit'],
  ] as const)('allows NextPhase from %s to %s in Ultra Plan', async (phase, nextPhase) => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase(phase);

    expect(evaluatePlanPolicy(agent, 'NextPhase', { phase: nextPhase })).toBeUndefined();
  });

  it.each([
    ['SearchSkill', { query: 'tui design best practices' }],
    ['Skill', { skill: 'write-tui' }],
    ['SearchExpert', { query: 'frontend ux accessibility review' }],
  ] as const)('allows %s in Ultra Plan design as read-only discovery', async (toolName, args) => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('design');

    expect(evaluatePlanPolicy(agent, toolName, args)).toBeUndefined();
  });

  it.each([
    'pwd',
    'ls -la /Users/modumaru/Desktop/code/test',
    'cat /tmp/dcbest.html',
    'head -40 packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts',
    'tail -n 80 packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts',
    'wc -l packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts',
    'file package.json',
    'stat package.json',
    'find packages/agent-core -maxdepth 2 -type f -name *.ts',
    'rg -n "Review phase" packages/agent-core',
    'grep -R "Review phase" packages/agent-core/src/agent',
    "sed -n '1360,1400p' /tmp/dcbest.html",
    "sed -n -e '1,10p' package.json",
    'nl -ba packages/agent-core/src/agent/permission/policies/plan-mode-guard-deny.ts',
    "jq '.scripts' package.json",
    'git status --short --branch',
    'git -C /workspace status --short',
    'git diff --stat',
    'git diff --name-only',
    'git diff --check',
    'git log --oneline -5',
    'git show --stat HEAD',
  ])('allows read-only Bash inspection in Ultra Plan review: %s', async (command) => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('review');

    expect(evaluatePlanPolicy(agent, 'Bash', { command })).toBeUndefined();
  });

  it.each([
    'cat package.json',
    "sed -n '1,10p' package.json",
    'rg -n "Review phase" packages/agent-core',
  ])(
    'keeps Research phase Bash inspection narrow: %s',
    async (command) => {
      const { agent, planMode } = await activePlanAgent({ ultra: true });
      planMode.setPhase('research');

      const deny = expectDeny(evaluatePlanPolicy(agent, 'Bash', { command }));

      expect(deny.message ?? '').toContain('simple read-only workspace inspection');
    },
  );

  it.each([
    'node scripts/build.js',
    'touch generated.txt',
    'ls -la /tmp && rm -rf /tmp/generated',
    'cat ~/.ssh/id_rsa',
    "sed -i 's/a/b/' package.json",
    'find . -delete',
    'find . -exec rm {} +',
    'tree -o tree.txt',
    'git diff --output=/tmp/diff.txt',
    'git show --output=/tmp/show.txt HEAD',
  ])('blocks non-inspection Bash in Ultra Plan review: %s', async (command) => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('review');

    const deny = expectDeny(evaluatePlanPolicy(agent, 'Bash', { command }));

    expect(deny.message ?? '').toContain('read-only inspection command');
  });

  it('allows Ultra Plan exit phase to repair only the plan file', async () => {
    const { agent, planMode } = await activePlanAgent({ ultra: true });
    planMode.setPhase('exit');
    const planPath = planMode.planFilePath;
    if (planPath === null) throw new Error('expected plan path');

    expect(evaluatePlanPolicy(agent, 'Read', { path: planPath })).toBeUndefined();
    expect(evaluatePlanPolicy(agent, 'Write', { path: planPath, content: '# fixed' })).toBeUndefined();

    const readDeny = expectDeny(evaluatePlanPolicy(agent, 'Read', { path: '/workspace/src/main.ts' }));
    expect(readDeny.message ?? '').toContain('current plan-file reads');

    const deny = expectDeny(
      evaluatePlanPolicy(agent, 'Write', {
        path: '/workspace/src/main.ts',
        content: 'x',
      }),
    );
    expect(deny.message ?? '').toContain('current plan file');
  });

  it.each(['manual', 'yolo', 'auto'] as const)(
    'defers Bash to ordinary %s permission handling while plan mode is active',
    async (mode) => {
      const { agent } = await activePlanAgent();

      expect(evaluatePlanPolicy(agent, 'Bash', { command: 'rm foo.txt' }, mode)).toBeUndefined();
      expect(evaluatePlanPolicy(agent, 'Bash', { command: 'ls -la' }, mode)).toBeUndefined();
    },
  );

  it.each(['manual', 'yolo', 'auto'] as const)(
    'blocks TaskStop while plan mode is active in %s mode',
    async (mode) => {
      const { agent } = await activePlanAgent();

      const result = evaluatePlanPolicy(
        agent,
        'TaskStop',
        { task_id: 'bash-abc12345' },
        mode,
      );

      const deny = expectDeny(result);
      expect(deny.message ?? '').toContain('plan mode');
      expect(deny.message ?? '').toContain('ExitPlanMode');
    },
  );

  it('denies CronCreate when plan mode is active', async () => {
    const { agent } = await activePlanAgent();

    const result = evaluatePlanPolicy(agent, 'CronCreate', {
      cron: '*/5 * * * *',
      prompt: 'ping',
    });

    const deny = expectDeny(result);
    expect(deny.message ?? '').toContain('CronCreate');
    expect(deny.message ?? '').toContain('plan mode');
  });

  it('denies CronDelete when plan mode is active', async () => {
    const { agent } = await activePlanAgent();

    const result = evaluatePlanPolicy(agent, 'CronDelete', { id: 'job_1' });

    const deny = expectDeny(result);
    expect(deny.message ?? '').toContain('CronDelete');
    expect(deny.message ?? '').toContain('plan mode');
  });

  it('allows CronList when plan mode is active', async () => {
    const { agent } = await activePlanAgent();

    expect(evaluatePlanPolicy(agent, 'CronList', {})).toBeUndefined();
  });

  it('does not block anything once plan mode has exited', async () => {
    const { agent, planMode } = await activePlanAgent();
    planMode.exit();

    expect(evaluatePlanPolicy(agent, 'Write', { path: '/workspace/src/main.ts' })).toBeUndefined();
    expect(evaluatePlanPolicy(agent, 'Bash', { command: 'rm foo.txt' })).toBeUndefined();
    expect(evaluatePlanPolicy(agent, 'TaskStop', { task_id: 'bash-abc12345' })).toBeUndefined();
  });
});

function toolAccesses(toolName: string, args: unknown) {
  const path = args !== null && typeof args === 'object' ? (args as { path?: unknown }).path : undefined;
  if (typeof path !== 'string') return ToolAccesses.none();
  if (toolName === 'Read') return ToolAccesses.readFile(path);
  if (toolName === 'Write') return ToolAccesses.writeFile(path);
  if (toolName === 'Edit') return ToolAccesses.readWriteFile(path);
  return ToolAccesses.none();
}

function expectDeny(
  result: PermissionPolicyResult | undefined,
): Extract<PermissionPolicyResult, { kind: 'deny' }> {
  expect(result).toMatchObject({ kind: 'deny' });
  if (result?.kind !== 'deny') throw new Error('expected deny result');
  return result;
}

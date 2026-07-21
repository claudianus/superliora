import { describe, expect, it } from 'vitest';

import type { Agent } from '../../../src/agent';
import { PlanModeInjector } from '../../../src/agent/injection/plan-mode';
import { UltraPlanModeEngine } from '../../../src/agent/plan/ultra-plan-mode';

interface PlanModeStub {
  isActive: boolean;
  planFilePath?: string | null;
  isUltraMode?: boolean;
  phase?: string;
}

function planAgent(stub: PlanModeStub): Agent {
  const history: unknown[] = [];
  const ultraEngine = new UltraPlanModeEngine({
    context: { history: [] },
    config: { provider: undefined },
  } as unknown as Agent);
  ultraEngine.interviewReadiness = async () => ({
    ready: false,
    stableReady: false,
    openGaps: ['actors', 'inputs', 'outputs'],
    ambiguityScore: {
      overallScore: 0.45,
      milestone: 'initial',
      floorFailures: [],
      isReadyForSeed: false,
      breakdown: [],
    },
    verifiableGoal: false,
    completionCandidateStreak: 0,
    floorFailures: [],
  });
  return {
    type: 'main',
    planMode: {
      get isActive() {
        return stub.isActive;
      },
      get planFilePath() {
        return stub.planFilePath ?? null;
      },
      get isUltraMode() {
        return stub.isUltraMode ?? false;
      },
      get phase() {
        return stub.phase ?? 'interview';
      },
      ultraEngine,
    },
    ultrawork: {
      getRun: () => null,
    },
    context: {
      history,
      appendSystemReminder: (content: string) => {
        history.push({
          role: 'user',
          content: [{ type: 'text', text: content }],
          origin: { kind: 'injection', variant: 'plan_mode' },
        });
      },
    },
  } as unknown as Agent;
}

function history(agent: Agent): Array<{ role: string; content?: ReadonlyArray<{ text?: string }> }> {
  return agent.context.history as unknown as Array<{
    role: string;
    content?: ReadonlyArray<{ text?: string }>;
  }>;
}

function lastReminder(agent: Agent): string {
  const last = history(agent).findLast((message) => message.role === 'user');
  return last?.content?.map((part) => part.text ?? '').join('') ?? '';
}

describe('PlanModeInjector content', () => {
  it('injects the full reminder with the current plan file footer', async () => {
    const agent = planAgent({ isActive: true, planFilePath: '/tmp/plan.md' });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    const text = lastReminder(agent);

    expect(text).toContain('Plan mode is active');
    expect(text).toContain('current plan file');
    expect(text).toContain('Write');
    expect(text).toContain('Edit');
    expect(text).toContain('ExitPlanMode');
    expect(text).toContain('TodoList is the live board during planning');
    expect(text).toContain('Plan file: /tmp/plan.md');
    // TaskStop/CronCreate/CronDelete are hard-denied in plan mode
    // (plan-mode-guard-deny.ts); the reminder must name them.
    expect(text).toContain('TaskStop');
  });

  it('uses the inline reminder when no plan file path is available', async () => {
    const agent = planAgent({ isActive: true, planFilePath: null });
    const injector = new PlanModeInjector(agent);

    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('Plan mode is active');
    expect(text).toContain('Wait for the host to provide a plan file path');
    expect(text).not.toContain('Plan file:');
  });

  it('injects the exit reminder when plan mode turns off after being active', async () => {
    const stub: PlanModeStub = { isActive: true, planFilePath: '/tmp/plan.md' };
    const agent = planAgent(stub);
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    stub.isActive = false;
    await injector.inject();

    expect(lastReminder(agent)).toContain('Plan mode is no longer active');
  });

  it('does not inject anything when plan mode is inactive from the start', async () => {
    const agent = planAgent({ isActive: false });
    const injector = new PlanModeInjector(agent);

    await injector.inject();

    expect(history(agent)).toHaveLength(0);
  });

  it('routes Ultra Plan research before the interview creates question options', async () => {
    const agent = planAgent({
      isActive: true,
      isUltraMode: true,
      phase: 'research',
      planFilePath: '/tmp/ultra-plan.md',
    });
    const injector = new PlanModeInjector(agent);

    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('Research Phase');
    expect(text).toContain('Context7Resolve');
    expect(text).toContain('Context7Docs');
    expect(text).toContain('Context7Resolve → Context7Docs');
    expect(text).toContain('improvement levers');
    expect(text).toContain('AskUserQuestion');
    expect(text).toContain('BLOCKED');
    expect(text).toContain("call NextPhase({ phase: 'interview' })");
    expect(text).not.toContain('No-AI-Slop skill mandate (MANDATORY)');
  });

  it('requires dynamic anti-slop routing in the write phase', async () => {
    const agent = planAgent({
      isActive: true,
      isUltraMode: true,
      phase: 'write',
      planFilePath: '/tmp/ultra-plan.md',
    });
    const injector = new PlanModeInjector(agent);

    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('No-AI-Slop skill routing');
    expect(text).toContain('response language');
  });

  it('recommends a verifiable UltraGoal before Design without hard-blocking', async () => {
    const agent = planAgent({
      isActive: true,
      isUltraMode: true,
      phase: 'interview',
      planFilePath: '/tmp/ultra-plan.md',
    });
    const injector = new PlanModeInjector(agent);

    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('interview quality drives plan quality');
    expect(text).toContain('expert leader who teaches');
    expect(text).toContain('unknown-unknowns');
    expect(text).toContain('Baseline + 1-3 Upgrades');
    expect(text).toContain('UltraGoal must be judgeable as complete/incomplete, true/false, or pass/fail');
    expect(text).toContain('Recommended for NextPhase to Design: a verifiable UltraGoal');
    expect(text).toContain('Soft seed gaps, ambiguity floors, and open_gaps are recommendations');
    expect(text).toContain('assumption-led');
    expect(text).toContain('Research-first before AskUserQuestion');
    expect(text).toContain('Context7Resolve/Context7Docs for library APIs');
    expect(text).toContain('WebSearch/FetchURL for external facts');
    expect(text).toContain('Perspective: researcher');
    expect(text).not.toContain('{{perspective}}');
    expect(text).toContain('benchmarks, best practices');
    expect(text).toContain('Your turn MUST end with AskUserQuestion, RecordInterviewFinding, or NextPhase');
    expect(text).toContain('Same-turn investigation (including product Write/Edit prototypes) is allowed');
    expect(text).toContain('Do not call EnterPlanMode while already in Ultra Plan');
    expect(text).toContain('Do not advance just because the task feels actionable');
    expect(text).toContain('live readiness checklist below');
    expect(text).toContain('Prefer not to Write the formal plan file during Interview');
    expect(text).toContain('Interview readiness:');
    expect(text).toContain('through the researcher perspective');
  });

  it('keeps expert-leader essentials in sparse Ultra Plan interview reminders', async () => {
    const agent = planAgent({
      isActive: true,
      isUltraMode: true,
      phase: 'interview',
      planFilePath: '/tmp/ultra-plan.md',
    });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    const messages = history(agent);
    messages.push({ role: 'assistant' }, { role: 'assistant' });
    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('Expert-leader interview');
    expect(text).toContain('Baseline + Upgrades');
    expect(text).toContain('current perspective lens');
    expect(text).toContain('Perspective: researcher');
    expect(text).toContain('Interview readiness:');
  });

  it('does not re-flood full plan guidance for injection-origin user messages', async () => {
    const agent = planAgent({ isActive: true, planFilePath: '/tmp/plan.md' });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    const before = history(agent).length;
    history(agent).push({
      role: 'user',
      content: [{ type: 'text', text: '<system-reminder>other injector</system-reminder>' }],
      origin: { kind: 'injection', variant: 'current_time' },
    } as never);
    history(agent).push({ role: 'assistant' } as never);

    await injector.inject();
    expect(history(agent)).toHaveLength(before + 2);
  });

  it('re-injects full plan guidance after a real user prompt', async () => {
    const agent = planAgent({ isActive: true, planFilePath: '/tmp/plan.md' });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    history(agent).push({
      role: 'user',
      content: [{ type: 'text', text: 'continue planning' }],
      origin: { kind: 'user' },
    } as never);
    await injector.inject();

    expect(lastReminder(agent)).toContain('Plan mode is active');
    expect(lastReminder(agent)).toContain('Plan file: /tmp/plan.md');
  });


  it('routes Ultra Plan design to review before write', async () => {
    const agent = planAgent({
      isActive: true,
      isUltraMode: true,
      phase: 'design',
      planFilePath: '/tmp/ultra-plan.md',
    });
    const injector = new PlanModeInjector(agent);

    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain("call NextPhase({ phase: 'review' })");
    expect(text).toContain('Do not skip directly to write');
    expect(text).toContain('SearchSkill');
    expect(text).toContain('Skill');
    expect(text).toContain('TodoList progress tracking');
    expect(text).toContain('TodoList for the live design board');
  });

  it('routes Ultra Plan review to write after verification', async () => {
    const agent = planAgent({
      isActive: true,
      isUltraMode: true,
      phase: 'review',
      planFilePath: '/tmp/ultra-plan.md',
    });
    const injector = new PlanModeInjector(agent);

    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain("call NextPhase({ phase: 'write' })");
    expect(text).toContain('WebSearch');
    expect(text).toContain('FetchURL');
    expect(text).toContain('Re-search when external claims stay uncertain');
    expect(text).toContain('read-only Bash');
    expect(text).toContain('cat, sed -n, head/tail');
    expect(text).toContain('TodoList progress tracking');
    expect(text).toContain('TodoList for verification gaps');
  });

  it('keeps Ultra Plan write instructions scoped to the plan file', async () => {
    const agent = planAgent({
      isActive: true,
      isUltraMode: true,
      phase: 'write',
      planFilePath: '/tmp/ultra-plan.md',
    });
    const injector = new PlanModeInjector(agent);

    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('You may ONLY write to the current plan file');
    expect(text).toContain('for quick verification');
    expect(text).toContain('TodoList for progress');
    expect(text).toContain('NextPhase or ExitPlanMode');
  });

  it('tells Ultra Plan exit how to repair missing plan sections', async () => {
    const agent = planAgent({
      isActive: true,
      isUltraMode: true,
      phase: 'exit',
      planFilePath: '/tmp/ultra-plan.md',
    });
    const injector = new PlanModeInjector(agent);

    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('Read/fix only that plan file');
    expect(text).toContain('retry');
  });
});

describe('PlanModeInjector cadence', () => {
  it('skips reinjection before the assistant-turn threshold', async () => {
    const agent = planAgent({ isActive: true, planFilePath: '/tmp/plan.md' });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    const messages = history(agent);
    messages.push({ role: 'assistant' });
    await injector.inject();

    expect(messages).toHaveLength(2);
  });

  it('injects the sparse reminder after the short assistant-turn threshold', async () => {
    const agent = planAgent({ isActive: true, planFilePath: '/tmp/plan.md' });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    const messages = history(agent);
    messages.push({ role: 'assistant' }, { role: 'assistant' });
    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('Plan mode still active');
    expect(text).toContain('full instructions earlier');
    expect(text).toContain('Plan file: /tmp/plan.md');
  });

  it('stays sparse mid-loop before the long full-refresh threshold', async () => {
    const agent = planAgent({ isActive: true, planFilePath: '/tmp/plan.md' });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    const messages = history(agent);
    for (let i = 0; i < 4; i += 1) {
      messages.push({ role: 'assistant' });
    }
    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('Plan mode still active');
    expect(text).toContain('full instructions earlier');
  });

  it('refreshes the full reminder after the long assistant-turn threshold', async () => {
    const agent = planAgent({ isActive: true, planFilePath: '/tmp/plan.md' });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    const messages = history(agent);
    for (let i = 0; i < 7; i += 1) {
      messages.push({ role: 'assistant' });
    }
    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('Plan mode is active');
    expect(text).not.toContain('Plan mode still active');
  });

  it('refreshes the full reminder if a user message appears after the last injection', async () => {
    const agent = planAgent({ isActive: true, planFilePath: '/tmp/plan.md' });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    history(agent).push({ role: 'user', content: [{ text: 'next task' }] });
    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain('Plan mode is active');
    expect(text).not.toContain('Plan mode still active');
  });

  it('uses phase-stable sparse for Ultra Plan instead of periodic full refresh', async () => {
    const agent = planAgent({
      isActive: true,
      isUltraMode: true,
      phase: 'interview',
      planFilePath: '/tmp/ultra-plan.md',
    });
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    const messages = history(agent);
    for (let i = 0; i < 5; i += 1) {
      messages.push({ role: 'assistant' });
    }
    await injector.inject();

    const text = lastReminder(agent);
    // After 5 assistant turns without a user prompt, Ultra Plan stays sparse (not full phase dump).
    expect(text).toContain('Expert-leader interview');
    expect(text).not.toContain('PATH 1 auto-answer from code/config');
  });

  it('re-sends full Ultra Plan phase instructions when the phase changes', async () => {
    const stub = {
      isActive: true,
      isUltraMode: true,
      phase: 'research' as string,
      planFilePath: '/tmp/ultra-plan.md',
    };
    const agent = planAgent(stub);
    const injector = new PlanModeInjector(agent);

    await injector.inject();
    expect(lastReminder(agent)).toContain('Research Phase');

    stub.phase = 'interview';
    history(agent).push({ role: 'assistant' } as never);
    await injector.inject();
    expect(lastReminder(agent)).toContain('Interview Phase');
    expect(lastReminder(agent)).toContain('PATH 1 auto-answer from code/config');
  });
});

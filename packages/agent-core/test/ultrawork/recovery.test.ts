import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { UltraworkRun } from '@superliora/protocol';

import { Agent } from '../../src/agent';
import { testKaos } from '../fixtures/test-kaos';

import {
  applyUltraworkResumeSkipInterview,
  buildUltraworkRecoveryPrompt,
  injectUltraworkPostCompactionContinuation,
  injectUltraworkPostSwarmContinuation,
  inferResumeStageFloor,
  maybeAdvanceUltraworkStage,
  maybeAdvanceUltraworkOnGoalComplete,
  maybeFinishUltraworkRun,
  promoteUltraworkRunStageForResume,
  releaseUltraworkPlanModeIfComplete,
  reconcileUltraworkRunForResume,
  shouldKeepPlanModeForUltraworkRun,
  shouldSkipInterviewOnUltraworkResume,
} from '../../src/ultrawork/recovery';
import { inferEffectiveUltraworkStage } from '../../src/ultrawork/stage-progress';
import { ULTRAWORK_GRAPH_STORE_KEY } from '../../src/tools/builtin/state/ultrawork-graph';
import type { WorkGraph } from '@superliora/protocol';


/** PlanMode without homedir writes to cwd/plan — isolate from package tree. */
function agentWithTempCwd(): { agent: Agent; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'uw-recovery-'));
  const agent = new Agent({ kaos: testKaos.withCwd(dir) });
  return {
    agent,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

function sampleRun(overrides: Partial<UltraworkRun> = {}): UltraworkRun {
  return {
    id: 'run-1',
    objective: 'Ship feature',
    status: 'blocked',
    stage: 'swarm',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:05:00.000Z',
    workGraph: {
      id: 'run-1:work_graph',
      runId: 'run-1',
      nodes: [
        {
          id: 'node-1',
          title: 'Implement API',
          stage: 'integrate',
          status: 'running',
        },
      ],
    },
    ...overrides,
  };
}

function ultraworkActivation(id: string) {
  return {
    source: 'manual' as const,
    replaceGoal: false,
    evidenceRoot: `.superliora/evidence/ultrawork-runs/${id}`,
    workDir: '/tmp',
  };
}

function createUltraworkAtPlan(agent: Agent, id: string): void {
  agent.ultrawork.create({
    id,
    objective: 'Ship feature',
    activation: ultraworkActivation(id),
  });
}

describe('Ultrawork goal completion', () => {
  it('completeLearnStage from plan finishes run', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    createUltraworkAtPlan(agent, 'run-goal-complete-plan');
    expect(agent.ultrawork.getRun()?.stage).toBe('plan');

    const run = agent.ultrawork.completeLearnStage('UltraGoal completed');
    expect(run?.status).toBe('done');
    expect(run?.stage).toBe('done');
    expect(agent.ultrawork.isModeEnabled()).toBe(false);
  });

  it('markComplete with empty WorkGraph is rejected (false-complete guard)', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    createUltraworkAtPlan(agent, 'run-mark-complete-plan');
    await agent.goal.createGoal({ objective: 'Ship docs', source: 'ultrawork' });

    const snapshot = await agent.goal.markComplete({}, 'model');
    expect(snapshot).toBeNull();
    expect(agent.goal.getGoal().goal).not.toBeNull();
    expect(agent.goal.getGoal().goal?.status).toBe('active');
    expect(agent.ultrawork.getRun()?.status).toBe('running');
    expect(agent.goal.getLastCompletionRejection()?.code).toBe('empty_work_graph');
  });

  it('markComplete succeeds after WorkGraph is fully done', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    createUltraworkAtPlan(agent, 'run-mark-complete-with-graph');
    await agent.goal.createGoal({ objective: 'Ship docs', source: 'ultrawork' });
    agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, {
      id: 'run-mark-complete-with-graph:work_graph',
      runId: 'run-mark-complete-with-graph',
      nodes: [{ id: 'node-1', title: 'Implement', stage: 'integrate', status: 'done' }],
    });
    agent.ultrawork.syncWorkGraphFromStore();

    const snapshot = await agent.goal.markComplete({}, 'model');
    expect(snapshot?.status).toBe('complete');
    expect(agent.goal.getGoal().goal).toBeNull();
    expect(agent.ultrawork.getRun()?.status).toBe('done');
  });

  it('maybeAdvanceUltraworkOnGoalComplete from plan does not force-finish empty graph', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    createUltraworkAtPlan(agent, 'run-advance-on-goal-complete');
    await agent.goal.createGoal({ objective: 'Ship docs' });

    maybeAdvanceUltraworkOnGoalComplete(agent);
    // False-complete guard: empty WorkGraph must keep the run open.
    expect(agent.ultrawork.getRun()?.status).toBe('running');
    expect(agent.ultrawork.getRun()?.stage).toBe('plan');
  });

  it('finishing the run when the work graph completes also closes the active goal', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    createUltraworkAtPlan(agent, 'run-graph-done-closes-goal');
    await agent.goal.createGoal({ objective: 'Ship docs' });
    agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, {
      id: 'run-graph-done-closes-goal:work_graph',
      runId: 'run-graph-done-closes-goal',
      nodes: [{ id: 'node-1', title: 'Implement', stage: 'integrate', status: 'done' }],
    });
    agent.ultrawork.syncWorkGraphFromStore();

    void maybeFinishUltraworkRun(agent);
    expect(agent.ultrawork.getRun()?.status).toBe('done');
    await vi.waitFor(() => {
      expect(agent.goal.getGoal().goal).toBeNull();
    });
  });

  it('syncWorkGraphFromStore + maybeFinishUltraworkRun closes goal (UltraSwarm path)', async () => {
    // UltraSwarm's updateWorkNodes calls syncWorkGraphFromStore() then
    // maybeFinishUltraworkRun() after marking work nodes done. This test
    // verifies that path terminates both the run and the active goal.
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    createUltraworkAtPlan(agent, 'run-swarm-path-closes-goal');
    await agent.goal.createGoal({ objective: 'Ship feature' });
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.ultrawork.advance('staff', 'test');
    agent.ultrawork.advance('swarm', 'test');
    agent.ultrawork.advance('integrate', 'test');

    agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, {
      id: 'run-swarm-path-closes-goal:work_graph',
      runId: 'run-swarm-path-closes-goal',
      nodes: [
        { id: 'node-1', title: 'Implement', stage: 'swarm', status: 'done' },
        {
          id: 'node-2',
          title: 'Verify',
          stage: 'verify',
          status: 'done',
          kind: 'verification',
          requiredEvidence: ['test'],
          evidenceIds: ['unit-test-report'],
          verificationStatus: 'passed',
        },
      ],
    });
    agent.ultrawork.syncWorkGraphFromStore();
    void maybeFinishUltraworkRun(agent);

    expect(agent.ultrawork.getRun()?.status).toBe('done');
    await vi.waitFor(() => {
      expect(agent.goal.getGoal().goal).toBeNull();
    });
  });

  it('maybeFinishUltraworkRun rejects graphs with status=failed nodes', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    createUltraworkAtPlan(agent, 'run-finish-rejects-failed');
    await agent.goal.createGoal({ objective: 'Ship feature' });
    agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, {
      id: 'run-finish-rejects-failed:work_graph',
      runId: 'run-finish-rejects-failed',
      nodes: [
        { id: 'node-ok', title: 'Done work', stage: 'integrate', status: 'done' },
        { id: 'node-fail', title: 'Broken work', stage: 'implement', status: 'failed' },
      ],
    });
    agent.ultrawork.syncWorkGraphFromStore();
    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    void maybeFinishUltraworkRun(agent);
    expect(agent.ultrawork.getRun()?.status).toBe('running');
    expect(agent.goal.getGoal().goal).not.toBeNull();
    const text = String(
      append.mock.calls.find((call) =>
        String(call[0]).includes('<ultrawork_completion_rejected>'),
      )?.[0] ?? '',
    );
    expect(text).toContain('<ultrawork_completion_rejected>');
    expect(text).toContain('run-finish-rejects-failed');
    expect(text).toContain('Ship feature');
    expect(text).toContain('node-fail');
  });

  it('maybeFinishUltraworkRun accepts cancelled nodes as success-terminal', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    createUltraworkAtPlan(agent, 'run-finish-allows-cancelled');
    await agent.goal.createGoal({ objective: 'Ship feature' });
    agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, {
      id: 'run-finish-allows-cancelled:work_graph',
      runId: 'run-finish-allows-cancelled',
      nodes: [
        { id: 'node-ok', title: 'Done work', stage: 'integrate', status: 'done' },
        { id: 'node-drop', title: 'Dropped scope', stage: 'swarm', status: 'cancelled' },
      ],
    });
    agent.ultrawork.syncWorkGraphFromStore();
    void maybeFinishUltraworkRun(agent);
    expect(agent.ultrawork.getRun()?.status).toBe('done');
    await vi.waitFor(() => {
      expect(agent.goal.getGoal().goal).toBeNull();
    });
  });

  it('maybeAdvanceUltraworkOnGoalComplete does not force-finish blocked run without WorkGraph', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    createUltraworkAtPlan(agent, 'run-blocked-on-goal-complete');
    await agent.goal.createGoal({ objective: 'Ship docs' });
    await agent.ultrawork.markInterrupted({ reason: 'Paused after interruption' });
    expect(agent.ultrawork.getRun()?.status).toBe('blocked');

    maybeAdvanceUltraworkOnGoalComplete(agent);
    // Blocked + empty WorkGraph must not force completeLearnStage.
    expect(agent.ultrawork.getRun()?.status).toBe('blocked');
  });

  it('completeLearnStage from learn transitions to done', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    createUltraworkAtPlan(agent, 'run-goal-complete-learn');
    for (const stage of ['research', 'goal', 'staff', 'swarm', 'integrate', 'verify', 'learn'] as const) {
      agent.ultrawork.advance(stage, 'test');
    }
    expect(agent.ultrawork.getRun()?.stage).toBe('learn');

    const run = agent.ultrawork.completeLearnStage('Ultrawork completed');
    expect(run?.status).toBe('done');
    expect(run?.stage).toBe('done');
    expect(agent.ultrawork.isModeEnabled()).toBe(false);
  });
});

describe('Ultrawork recovery', () => {
  it('keeps plan mode only while the effective stage is still plan or research', () => {
    const run = sampleRun({
      stage: 'research',
      workGraph: {
        id: 'run-1:work_graph',
        runId: 'run-1',
        nodes: [
          { id: 'wg1', title: 'Scaffold', stage: 'integrate', status: 'done' },
          { id: 'wg8', title: 'Performance', stage: 'verify', status: 'running' },
        ],
      },
    });
    expect(shouldKeepPlanModeForUltraworkRun(run)).toBe(false);
  });

  it('skips interview on resume when the plan phase is already interview', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-skip-interview',
      objective: 'Ship landing page',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-skip-interview',
        workDir: '/tmp',
      },
    });
    await agent.planMode.enter('resume-plan', false, true, true, 'Ship landing page');
    agent.planMode.setPhase('interview');

    expect(
      shouldSkipInterviewOnUltraworkResume(agent, agent.ultrawork.getRun()!, {
        phase: 'interview',
        interviewRoundCount: 0,
      }),
    ).toBe(true);

    const result = applyUltraworkResumeSkipInterview(agent, agent.ultrawork.getRun()!, {
      phase: 'interview',
      interviewRoundCount: 0,
    });
    expect(result.skippedInterview).toBe(true);
    expect(agent.planMode.phase).toBe('design');
  });
  it('exits plan mode on resume once a goal exists instead of parking in design', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-resume-goal-exits-plan',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-resume-goal-exits-plan',
        workDir: '/tmp',
      },
    });
    await agent.goal.createGoal({ objective: 'Ship feature' });
    await agent.planMode.enter('resume-plan', false, true, true, 'Ship feature');
    agent.planMode.setPhase('design');
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');

    const result = applyUltraworkResumeSkipInterview(agent, agent.ultrawork.getRun()!, {
      phase: 'design',
      interviewRoundCount: 2,
    });

    expect(result.skippedInterview).toBe(true);
    expect(agent.planMode.isActive).toBe(false);
    expect(result.planContext).toBeUndefined();
    expect(result.run.stage).toBe('goal');
  });

  it('exits plan mode on resume when WorkGraph already has pending nodes', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-resume-graph-exits-plan',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-resume-graph-exits-plan',
        workDir: '/tmp',
      },
    });
    await agent.planMode.enter('resume-plan', false, true, true, 'Ship feature');
    agent.planMode.setPhase('design');
    agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, {
      id: 'run-resume-graph-exits-plan:work_graph',
      runId: 'run-resume-graph-exits-plan',
      nodes: [
        { id: 'node-1', title: 'Implement API', stage: 'integrate', status: 'running' },
      ],
    });
    agent.ultrawork.syncWorkGraphFromStore();

    const result = applyUltraworkResumeSkipInterview(agent, agent.ultrawork.getRun()!, {
      phase: 'design',
      interviewRoundCount: 1,
    });

    expect(result.skippedInterview).toBe(true);
    expect(agent.planMode.isActive).toBe(false);
    expect(result.run.stage).toBe('integrate');
  });

  it('preserves write phase on resume when still planning (no goal/work graph)', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-resume-write-phase',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-resume-write-phase',
        workDir: '/tmp',
      },
    });
    await agent.planMode.enter('resume-plan', false, true, true, 'Ship feature');
    agent.planMode.setPhase('write');

    const result = applyUltraworkResumeSkipInterview(agent, agent.ultrawork.getRun()!, {
      phase: 'write',
      interviewRoundCount: 2,
    });

    expect(result.skippedInterview).toBe(true);
    expect(agent.planMode.isActive).toBe(true);
    expect(agent.planMode.phase).toBe('write');
    expect(result.planContext?.phase).toBe('write');
  });

  it('does not keep plan mode once WorkGraph progress exists', () => {
    const run = sampleRun({
      stage: 'plan',
      workGraph: {
        id: 'run-1:work_graph',
        runId: 'run-1',
        nodes: [{ id: 'wg1', title: 'Scaffold', stage: 'integrate', status: 'queued' }],
      },
    });
    expect(shouldKeepPlanModeForUltraworkRun(run)).toBe(false);
  });
  it('resume() exits design-phase plan mode when execution has already started', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-resume-api-design-trap',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-resume-api-design-trap',
        workDir: '/tmp',
      },
    });
    await agent.goal.createGoal({ objective: 'Ship feature' });
    await agent.planMode.enter('resume-plan', false, true, true, 'Ship feature');
    agent.planMode.setPhase('design');
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, {
      id: 'run-resume-api-design-trap:work_graph',
      runId: 'run-resume-api-design-trap',
      nodes: [
        { id: 'node-1', title: 'Implement API', stage: 'integrate', status: 'running' },
      ],
    });
    agent.ultrawork.syncWorkGraphFromStore();
    await agent.ultrawork.markInterrupted({ reason: 'Paused after provider rate limit' });

    const resumed = await agent.ultrawork.resume();

    expect(resumed).not.toBeNull();
    expect(agent.planMode.isActive).toBe(false);
    expect(resumed?.run.stage).toBe('integrate');
    expect(resumed?.run.status).toBe('running');
    expect(resumed?.recoveryPrompt).toContain('Continue WorkGraph node node-1');
    expect(resumed?.recoveryPrompt).not.toContain('UltraPlan phase:');
    expect(resumed?.recoveryPrompt).not.toContain('plan_phase:');
  });

  it('builds a recovery prompt that skips interview on resume', () => {
    const prompt = buildUltraworkRecoveryPrompt(
      {
        run: sampleRun({ stage: 'research' }),
        interruptReason: 'Paused after interruption',
        orphanedWorkNodes: [],
        orphanedExperts: [],
        lostBackgroundTasks: [],
        nextActions: ['Continue design and implementation from the saved checkpoint'],
        skippedInterview: true,
      },
      {
        planFilePath: '/tmp/plans/quasar-archangel-falcon.md',
        phase: 'design',
        interviewRoundCount: 2,
      },
      {
        stage: 'research',
        planPhase: 'design',
        interviewRound: 2,
      },
    );
    expect(prompt).toContain('Skip UltraPlan interview');
    expect(prompt).toContain('Do not ask blocking interview questions');
  });

  it('releases ultrawork plan mode after execution has started', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-exit-plan',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-exit-plan',
        workDir: '/tmp',
      },
    });
    void agent.planMode.enter('exit-plan', false, true, true, 'Ship feature');
    agent.planMode.setPhase('exit');
    agent.ultrawork.attachTeamPlan({
      id: 'team-1',
      runId: 'run-exit-plan',
      intensity: 'balanced',
      maxExperts: 4,
      experts: [{ id: 'expert-1', name: 'QA', role: 'reviewer', focus: 'review', status: 'queued' }],
    });
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.ultrawork.advance('staff', 'test');
    agent.ultrawork.advance('swarm', 'test');
    agent.ultrawork.advance('integrate', 'test');
    agent.ultrawork.advance('verify', 'test');

    expect(releaseUltraworkPlanModeIfComplete(agent, agent.ultrawork.getRun())).toBe(true);
    expect(agent.planMode.isActive).toBe(false);
  });

  it('promotes resume stage from teamPlan even when checkpoint lags at plan', () => {
    const run = sampleRun({
      stage: 'research',
      teamPlan: {
        id: 'team-1',
        runId: 'run-1',
        intensity: 'balanced',
        maxExperts: 4,
        experts: [{ id: 'expert-1', name: 'QA', role: 'reviewer', focus: 'review', status: 'queued' }],
      },
    });
    expect(inferResumeStageFloor(run)).toBe('integrate');
    expect(promoteUltraworkRunStageForResume(run).stage).toBe('integrate');
  });

  it('does not regress ultrawork stage during maybeAdvanceUltraworkStage', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-no-regress',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-no-regress',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.advance('plan', 'test');
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.ultrawork.advance('staff', 'test');
    agent.ultrawork.advance('swarm', 'test');
    agent.ultrawork.advance('integrate', 'test');
    agent.ultrawork.attachTeamPlan({
      id: 'team-1',
      runId: 'run-no-regress',
      intensity: 'balanced',
      maxExperts: 4,
      experts: [{ id: 'expert-1', name: 'QA', role: 'reviewer', focus: 'review', status: 'queued' }],
    });

    maybeAdvanceUltraworkStage(agent, 'research', 'Ultra plan research phase');
    expect(agent.ultrawork.getRun()?.stage).toBe('integrate');
  });

  it('reconciles orphaned running graph nodes and experts', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    const graph = sampleRun().workGraph!;
    agent.tools.updateStore('ultrawork_graph', graph);

    const result = reconcileUltraworkRunForResume(agent, sampleRun({
      teamPlan: {
        id: 'team-1',
        runId: 'run-1',
        intensity: 'balanced',
        maxExperts: 4,
        experts: [
          {
            id: 'expert-1',
            name: 'QA',
            role: 'reviewer',
            focus: 'review',
            status: 'running',
          },
        ],
      },
    }));

    expect(result.run.status).toBe('running');
    expect(result.workGraph?.nodes[0]?.status).toBe('blocked');
    expect(result.teamPlan?.experts[0]?.status).toBe('queued');
    expect(result.orphanedWorkNodes).toEqual(['node-1']);
    expect(result.orphanedExperts).toEqual(['expert-1']);
  });

  it('interrupt → resume reconciles running nodes and preserves interrupt reason', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-interrupt-reconcile',
      objective: 'Resume after interrupt',
      activation: ultraworkActivation('run-interrupt-reconcile'),
    });
    const graph: WorkGraph = {
      id: 'run-interrupt-reconcile:work_graph',
      runId: 'run-interrupt-reconcile',
      nodes: [
        {
          id: 'node-running',
          title: 'In flight implement',
          stage: 'swarm',
          status: 'running',
        },
        {
          id: 'node-queued',
          title: 'Waiting',
          stage: 'swarm',
          status: 'queued',
          dependsOn: ['node-running'],
        },
      ],
    };
    agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, graph);
    agent.ultrawork.syncWorkGraphFromStore();

    await agent.ultrawork.markInterrupted({
      reason: 'Provider aborted mid-swarm phase',
    });

    const resumed = await agent.ultrawork.resume();
    expect(resumed).toBeTruthy();
    expect(resumed?.recoveryPrompt).toContain('Provider aborted mid-swarm phase');

    const run = agent.ultrawork.getRun();
    expect(run?.status).toBe('running');
    const nodes = run?.workGraph?.nodes ?? [];
    const runningNode = nodes.find((n) => n.id === 'node-running');
    // running → blocked with recovery summary (reconcile path)
    expect(runningNode?.status).toBe('blocked');
    expect(runningNode?.verificationSummary ?? '').toMatch(/Recovered after interruption|interrupt/i);

    const queuedNode = nodes.find((n) => n.id === 'node-queued');
    // queued stays queued — only running is orphaned
    expect(queuedNode?.status).toBe('queued');
  });

  it('builds a recovery prompt with next actions', () => {
    const prompt = buildUltraworkRecoveryPrompt({
      run: sampleRun(),
      interruptReason: 'Paused after interruption',
      orphanedWorkNodes: ['node-1'],
      orphanedExperts: [],
      lostBackgroundTasks: [],
      nextActions: ['Reconcile Swarm staffing'],
    });
    expect(prompt).toContain('<ultrawork_recovery>');
    expect(prompt).toContain('Paused after interruption');
    expect(prompt).toContain('Reconcile Swarm staffing');
  });

  it('seeds empty WorkGraph guidance in recovery prompt body', () => {
    const prompt = buildUltraworkRecoveryPrompt({
      run: sampleRun({
        stage: 'integrate',
        workGraph: {
          id: 'run-1:work_graph',
          runId: 'run-1',
          nodes: [],
        },
      }),
      interruptReason: 'Paused after interruption',
      orphanedWorkNodes: [],
      orphanedExperts: [],
      lostBackgroundTasks: [],
      nextActions: ['Seed WorkGraph via UltraworkGraph'],
    });
    expect(prompt).toContain('WorkGraph empty or missing');
    expect(prompt).toContain('seed via UltraworkGraph');
    expect(prompt).toContain('requiredEvidence');
    expect(prompt).not.toContain('Pending WorkGraph nodes');
  });

  it('excludes cancelled WorkGraph nodes from recovery pending lists', () => {
    const prompt = buildUltraworkRecoveryPrompt({
      run: sampleRun({
        stage: 'integrate',
        workGraph: {
          id: 'run-1:work_graph',
          runId: 'run-1',
          nodes: [
            {
              id: 'node-done',
              title: 'Finished AC',
              stage: 'integrate',
              status: 'done',
            },
            {
              id: 'node-cancel',
              title: 'Dropped scope',
              stage: 'integrate',
              status: 'cancelled',
            },
            {
              id: 'node-run',
              title: 'Still open',
              stage: 'integrate',
              status: 'running',
            },
            {
              id: 'node-fail',
              title: 'Broken verify',
              stage: 'verify',
              status: 'failed',
            },
          ],
        },
      }),
      interruptReason: 'Paused after interruption',
      orphanedWorkNodes: [],
      orphanedExperts: [],
      lostBackgroundTasks: [],
      nextActions: ['Resume WorkGraph node node-run'],
    });
    expect(prompt).toContain('Pending WorkGraph nodes (2)');
    expect(prompt).toContain('[running] node-run');
    expect(prompt).toContain('[failed] node-fail');
    expect(prompt).toContain('Failed WorkGraph nodes');
    expect(prompt).toContain('Ownerless running WorkGraph nodes');
    expect(prompt).not.toContain('node-cancel');
    expect(prompt).not.toContain('Dropped scope');
    expect(prompt).not.toContain('[done] node-done');
  });

  it('classifies multi-stall WorkGraph nodes in recovery prompt body', () => {
    const prompt = buildUltraworkRecoveryPrompt({
      run: sampleRun({
        stage: 'integrate',
        workGraph: {
          id: 'run-1:work_graph',
          runId: 'run-1',
          nodes: [
            {
              id: 'node-fail',
              title: 'Broken verify',
              stage: 'verify',
              status: 'failed',
            },
            {
              id: 'node-int',
              title: 'Specialist handoff',
              stage: 'integrate',
              status: 'needs_integration',
            },
            {
              id: 'node-block',
              title: 'Blocked dep',
              stage: 'integrate',
              status: 'blocked',
            },
            {
              id: 'node-orphan',
              title: 'Ownerless run',
              stage: 'integrate',
              status: 'running',
            },
            {
              id: 'node-wait',
              title: 'Waiting queue',
              stage: 'integrate',
              status: 'queued',
              dependsOn: ['node-block'],
            },
            {
              id: 'node-gap',
              title: 'Done without evidence',
              stage: 'verify',
              status: 'done',
              requiredEvidence: ['test-log'],
              evidenceIds: [],
            },
          ],
        },
      }),
      interruptReason: 'Paused after interruption',
      orphanedWorkNodes: [],
      orphanedExperts: [],
      lostBackgroundTasks: [],
      nextActions: ['Repair failed WorkGraph node node-fail'],
    });
    expect(prompt).toContain('Failed WorkGraph nodes');
    expect(prompt).toContain('node-fail');
    expect(prompt).toContain('Needs-integration WorkGraph nodes');
    expect(prompt).toContain('node-int');
    expect(prompt).toContain('Blocked WorkGraph nodes');
    expect(prompt).toContain('node-block');
    expect(prompt).toContain('Ownerless running WorkGraph nodes');
    expect(prompt).toContain('node-orphan');
    // dependsOn waits only when no blocked nodes (match injectors)
    expect(prompt).not.toContain('Queued waiting on dependsOn');
    expect(prompt).toContain('Verification-gap WorkGraph nodes');
    expect(prompt).toContain('node-gap');
  });

  it('omits pending WorkGraph section when only done/cancelled remain', () => {
    const prompt = buildUltraworkRecoveryPrompt({
      run: sampleRun({
        stage: 'integrate',
        workGraph: {
          id: 'run-1:work_graph',
          runId: 'run-1',
          nodes: [
            {
              id: 'node-done',
              title: 'Finished AC',
              stage: 'integrate',
              status: 'done',
            },
            {
              id: 'node-cancel',
              title: 'Dropped scope',
              stage: 'integrate',
              status: 'cancelled',
            },
          ],
        },
      }),
      interruptReason: 'Paused after interruption',
      orphanedWorkNodes: [],
      orphanedExperts: [],
      lostBackgroundTasks: [],
      nextActions: ['Continue Ultrawork'],
    });
    expect(prompt).not.toContain('Pending WorkGraph nodes');
    expect(prompt).not.toContain('node-cancel');
  });

  it('preserves interrupt reason in recovery prompt after resume', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-resume',
      objective: 'Resume test',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-resume',
        workDir: '/tmp',
      },
    });
    await agent.ultrawork.markInterrupted({ reason: 'Paused after interruption' });

    const resumed = await agent.ultrawork.resume();
    expect(resumed?.recoveryPrompt).toContain('Paused after interruption');
  });

  it('builds a recovery prompt with plan checkpoint context', () => {
    const prompt = buildUltraworkRecoveryPrompt(
      {
        run: sampleRun(),
        interruptReason: 'Paused after interruption',
        orphanedWorkNodes: ['node-1'],
        orphanedExperts: [],
        lostBackgroundTasks: [],
        nextActions: ['Reconcile Swarm staffing'],
      },
      {
        planFilePath: '/tmp/plans/quasar-archangel-falcon.md',
        phase: 'interview',
        interviewRoundCount: 3,
      },
      {
        stage: 'plan',
        planPhase: 'interview',
        interviewRound: 3,
        journalOffset: 42,
      },
    );
    expect(prompt).toContain('Plan file: /tmp/plans/quasar-archangel-falcon.md');
    expect(prompt).toContain('UltraPlan phase: interview');
    expect(prompt).toContain('Interview rounds completed: 3');
    expect(prompt).toContain('continue_interview_from_round: 4');
    expect(prompt).toContain('do not restart interview from round 1.');
    expect(prompt).toContain('journal_offset: 42');
  });

  it('promotes resume stage from WorkGraph progress when checkpoint lags', () => {
    const run = sampleRun({
      stage: 'research',
      workGraph: {
        id: 'run-1:work_graph',
        runId: 'run-1',
        nodes: [
          { id: 'wg1', title: 'Scaffold', stage: 'integrate', status: 'done' },
          { id: 'wg8', title: 'Performance', stage: 'verify', status: 'running' },
        ],
      },
    });
    expect(inferEffectiveUltraworkStage(run.stage, run.workGraph)).toBe('verify');

    const prompt = buildUltraworkRecoveryPrompt({
      run,
      interruptReason: 'Paused after provider API error: 500',
      orphanedWorkNodes: [],
      orphanedExperts: [],
      lostBackgroundTasks: [],
      nextActions: ['Resume WorkGraph node wg8: Performance'],
    });
    expect(prompt).toContain('Effective resume stage: verify');
    expect(prompt).toContain('Do not restart UltraResearch');
  });

  it('restores ultra plan phase and interview state through records', async () => {
    const homedir = join(tmpdir(), `ultrawork-plan-state-${String(Date.now())}`);
    mkdirSync(homedir, { recursive: true });

    const agent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    await agent.planMode.enter('resume-plan', false, true, true, 'Resume plan state');
    agent.planMode.setPhase('interview');
    agent.planMode.ultraEngine.addInterviewRound('Scope?', 'README only');
    agent.planMode.incrementInterviewRound();
    agent.planMode.setPhase('interview');
    await agent.records.flush();

    const replayAgent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    await replayAgent.resume();

    expect(replayAgent.planMode.isActive).toBe(true);
    expect(replayAgent.planMode.phase).toBe('interview');
    expect(replayAgent.planMode.ultraEngine.interviewState.rounds).toHaveLength(1);
  });

  it('checkpoints and restores run state through records', async () => {
    const homedir = join(tmpdir(), `ultrawork-recovery-${String(Date.now())}`);
    mkdirSync(homedir, { recursive: true });

    const agent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    agent.ultrawork.create({
      id: 'run-checkpoint',
      objective: 'Recover me',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-checkpoint',
        workDir: homedir,
      },
    });
    await agent.records.flush();

    const snapshot = agent.ultrawork.getRun();
    expect(snapshot?.stage).toBe('plan');
    expect(snapshot?.status).toBe('running');

    const replayAgent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    await replayAgent.resume();
    expect(replayAgent.ultrawork.getRun()?.id).toBe('run-checkpoint');
    expect(replayAgent.ultrawork.getRun()?.status).toBe('blocked');
  });

  it('syncs ultrawork stage forward when work graph progress advances', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-sync',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-sync',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.advance('plan', 'test');
    agent.ultrawork.advance('research', 'test');
    expect(agent.ultrawork.getRun()?.stage).toBe('research');

    const graph = {
      id: 'run-sync:work_graph',
      runId: 'run-sync',
      nodes: [
        { id: 'wg1', title: 'Scaffold', stage: 'integrate' as const, status: 'done' as const },
        { id: 'wg8', title: 'Performance', stage: 'verify' as const, status: 'running' as const },
      ],
    };
    agent.tools.updateStore('ultrawork_graph', graph);
    agent.ultrawork.syncWorkGraphFromStore();

    expect(agent.ultrawork.getRun()?.stage).toBe('verify');
    expect(agent.ultrawork.getRun()?.workGraph?.nodes).toHaveLength(2);
  });

  it('injects post-swarm continuation only when the run reaches integrate', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-integrate',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-integrate',
        workDir: '/tmp',
      },
    });
    const append = vi.spyOn(agent.context, 'appendSystemReminder');

    injectUltraworkPostSwarmContinuation(agent);
    expect(append).not.toHaveBeenCalled();

    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.ultrawork.advance('staff', 'test');
    agent.ultrawork.advance('swarm', 'test');
    agent.ultrawork.advance('integrate', 'test');
    append.mockClear();

    injectUltraworkPostSwarmContinuation(agent);
    expect(append).toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_post_swarm>'),
      expect.objectContaining({ variant: 'ultrawork_post_swarm' }),
    );
    const swarmText = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_post_swarm>'))?.[0] ??
        '',
    );
    expect(swarmText).toContain('Run: run-integrate');
    expect(swarmText).toContain('Objective:');
    expect(swarmText).toContain('status=running');
    expect(swarmText).toMatch(/journal_offset: \d+/);
  });

  it('includes pending WorkGraph nodes in post-swarm injection', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    const run = agent.ultrawork.create({
      id: 'run-post-swarm-graph',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-post-swarm-graph',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.ultrawork.advance('staff', 'test');
    agent.ultrawork.advance('swarm', 'test');
    agent.ultrawork.advance('integrate', 'test');
    agent.ultrawork.applyMirrorRunQuiet({
      run: {
        ...agent.ultrawork.getRun()!,
        status: 'running',
        stage: 'integrate',
        workGraph: {
          id: 'run-post-swarm-graph:work_graph',
          runId: 'run-post-swarm-graph',
          rootGoal: 'Ship feature',
          nodes: [
            {
              id: 'node-1',
              title: 'Integrate API',
              stage: 'integrate',
              status: 'running',
            },
            {
              id: 'node-fail',
              title: 'Broken specialist wave',
              stage: 'swarm',
              status: 'failed',
            },
          ],
        },
      },
      interruptReason: 'Context compacted mid-swarm',
    });
    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    injectUltraworkPostSwarmContinuation(agent);
    const text = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_post_swarm>'))?.[0] ??
        '',
    );
    expect(text).toContain('Pending WorkGraph nodes');
    expect(text).toContain('node-1[running]');
    expect(text).toContain('Integrate API');
    expect(text).toContain('Failed WorkGraph nodes');
    expect(text).toContain('node-fail');
    expect(text).toContain('Broken specialist wave');
    expect(text).toContain('Next actions:');
    expect(text).toContain('Interrupt reason: Context compacted mid-swarm');
    expect(text).toContain('run-post-swarm-graph');
    expect(text).toContain('stuck_nodes:');
    expect(text).toContain('re-queue blocked nodes');
    expect(run.id).toBe('run-post-swarm-graph');
  });

  it('surfaces long_running_stage in post-compaction injection', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    const oldEnteredAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const run = agent.ultrawork.create({
      id: 'run-compact-long-stage',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-compact-long-stage',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.applyMirrorRunQuiet({
      run: {
        ...run,
        status: 'running',
        stage: 'integrate',
        stageHistory: [
          ...(run.stageHistory ?? []),
          {
            stage: 'integrate',
            enteredAt: oldEnteredAt,
            reason: 'test long stage',
          },
        ],
        workGraph: {
          id: 'run-compact-long-stage:work_graph',
          runId: 'run-compact-long-stage',
          rootGoal: 'Ship feature',
          nodes: [
            {
              id: 'node-1',
              title: 'Long integrate',
              stage: 'integrate',
              status: 'running',
            },
          ],
        },
      },
    });
    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    injectUltraworkPostCompactionContinuation(agent);
    const text = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_post_compaction>'))?.[0] ??
        '',
    );
    expect(text).toContain('long_running_stage: integrate');
    expect(text).toContain('expected <15min');
    expect(text).toContain('stuck_nodes:');
  });

  it('includes needs_integration WorkGraph nodes in post-swarm injection', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    agent.ultrawork.create({
      id: 'run-post-swarm-needs-int',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-post-swarm-needs-int',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.ultrawork.advance('staff', 'test');
    agent.ultrawork.advance('swarm', 'test');
    agent.ultrawork.advance('integrate', 'test');
    agent.ultrawork.applyMirrorRunQuiet({
      run: {
        ...agent.ultrawork.getRun()!,
        status: 'running',
        stage: 'integrate',
        workGraph: {
          id: 'run-post-swarm-needs-int:work_graph',
          runId: 'run-post-swarm-needs-int',
          rootGoal: 'Ship feature',
          nodes: [
            {
              id: 'node-int',
              title: 'Specialist handoff',
              stage: 'integrate',
              status: 'needs_integration',
            },
            {
              id: 'node-done',
              title: 'Already merged',
              stage: 'integrate',
              status: 'done',
            },
          ],
        },
      },
    });
    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    injectUltraworkPostSwarmContinuation(agent);
    const text = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_post_swarm>'))?.[0] ??
        '',
    );
    expect(text).toContain('Needs-integration WorkGraph nodes');
    expect(text).toContain('node-int');
    expect(text).toContain('Specialist handoff');
    expect(text).toContain('needs_integration blocks UpdateGoal(complete)');
    expect(text).toContain('Integrate specialist handoffs');
    expect(text).toContain('node-int[needs_integration]');
    expect(text).not.toContain('node-done[done]');
  });

  it('includes queued dependsOn waits in post-swarm injection', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    agent.ultrawork.create({
      id: 'run-post-swarm-queued-deps',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-post-swarm-queued-deps',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.ultrawork.advance('staff', 'test');
    agent.ultrawork.advance('swarm', 'test');
    agent.ultrawork.advance('integrate', 'test');
    agent.ultrawork.applyMirrorRunQuiet({
      run: {
        ...agent.ultrawork.getRun()!,
        status: 'running',
        stage: 'integrate',
        workGraph: {
          id: 'run-post-swarm-queued-deps:work_graph',
          runId: 'run-post-swarm-queued-deps',
          rootGoal: 'Ship feature',
          nodes: [
            {
              id: 'node-dep',
              title: 'Upstream work',
              stage: 'integrate',
              status: 'running',
              ownerExpertId: 'expert-1',
            },
            {
              id: 'node-wait',
              title: 'Waiting integrate',
              stage: 'integrate',
              status: 'queued',
              dependsOn: ['node-dep'],
            },
          ],
        },
      },
    });
    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    injectUltraworkPostSwarmContinuation(agent);
    const text = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_post_swarm>'))?.[0] ??
        '',
    );
    expect(text).toContain('Queued waiting on dependsOn');
    expect(text).toContain('node-wait');
    expect(text).toContain('dependsOn=node-dep');
    expect(text).toContain('finish or cancel deps');
  });

  it('seeds empty WorkGraph guidance in post-swarm injection', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    agent.ultrawork.create({
      id: 'run-post-swarm-empty-graph',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-post-swarm-empty-graph',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.ultrawork.advance('staff', 'test');
    agent.ultrawork.advance('swarm', 'test');
    agent.ultrawork.advance('integrate', 'test');
    agent.ultrawork.applyMirrorRunQuiet({
      run: {
        ...agent.ultrawork.getRun()!,
        status: 'running',
        stage: 'integrate',
        workGraph: {
          id: 'run-post-swarm-empty-graph:work_graph',
          runId: 'run-post-swarm-empty-graph',
          rootGoal: 'Ship feature',
          nodes: [],
        },
      },
    });
    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    injectUltraworkPostSwarmContinuation(agent);
    const text = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_post_swarm>'))?.[0] ??
        '',
    );
    expect(text).toContain('WorkGraph empty or missing');
    expect(text).toContain('seed via UltraworkGraph');
    expect(text).toContain('requiredEvidence');
  });

  it('injects post-compaction continuation for an active ultrawork run', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-compact-cont',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-compact-cont',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.advance('research', 'test');
    const append = vi.spyOn(agent.context, 'appendSystemReminder');

    injectUltraworkPostCompactionContinuation(agent);
    expect(append).toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_post_compaction>'),
      expect.objectContaining({ variant: 'ultrawork_post_compaction' }),
    );
    const compactionCall = append.mock.calls.find((call) =>
      String(call[0]).includes('<ultrawork_post_compaction>'),
    );
    const text = String(compactionCall?.[0] ?? '');
    expect(text).toContain('run-compact-cont');
    expect(text).toContain('do not restart UltraPlan');
    expect(text).toContain('Objective:');
    expect(text).toContain('status=');
    expect(text).toMatch(/journal_offset: \d+/);
  });

  it('includes pending WorkGraph nodes and interrupt reason in post-compaction injection', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    const run = agent.ultrawork.create({
      id: 'run-compact-graph',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-compact-graph',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.applyMirrorRunQuiet({
      run: {
        ...run,
        status: 'running',
        stage: 'integrate',
        workGraph: {
          id: 'run-compact-graph:work_graph',
          runId: 'run-compact-graph',
          rootGoal: 'Ship feature',
          nodes: [
            {
              id: 'node-1',
              title: 'Implement API',
              stage: 'integrate',
              status: 'running',
            },
            {
              id: 'node-2',
              title: 'Done already',
              stage: 'integrate',
              status: 'done',
            },
            {
              id: 'node-fail',
              title: 'Broken verify',
              stage: 'verify',
              status: 'failed',
            },
          ],
        },
      },
      interruptReason: 'Context pressure mid-run',
    });
    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    injectUltraworkPostCompactionContinuation(agent);
    const text = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_post_compaction>'))?.[0] ??
        '',
    );
    expect(text).toContain('Pending WorkGraph nodes');
    expect(text).toContain('node-1[running]');
    expect(text).toContain('Implement API');
    expect(text).toContain('Failed WorkGraph nodes');
    expect(text).toContain('node-fail');
    expect(text).toContain('Broken verify');
    expect(text).toContain('Repair failed WorkGraph node');
    expect(text).not.toContain('node-2[done]');
    expect(text).toContain('Interrupt reason: Context pressure mid-run');
    expect(text).toContain('Ship feature');
    expect(text).toContain('stuck_nodes:');
    expect(text).toContain('node-1[running]');
    expect(text).toContain('re-queue blocked nodes');
  });

  it('seeds empty WorkGraph guidance in post-compaction injection', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    const run = agent.ultrawork.create({
      id: 'run-compact-empty-graph',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-compact-empty-graph',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.applyMirrorRunQuiet({
      run: {
        ...run,
        status: 'running',
        stage: 'integrate',
        workGraph: {
          id: 'run-compact-empty-graph:work_graph',
          runId: 'run-compact-empty-graph',
          rootGoal: 'Ship feature',
          nodes: [],
        },
      },
    });
    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    injectUltraworkPostCompactionContinuation(agent);
    const text = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_post_compaction>'))?.[0] ??
        '',
    );
    expect(text).toContain('WorkGraph empty or missing');
    expect(text).toContain('seed via UltraworkGraph');
    expect(text).toContain('requiredEvidence');
  });

  it('reinjects ultrawork graph status after compaction even during swarm', async () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), "uw-rec-"))) });
    agent.ultrawork.create({
      id: 'run-graph-inject',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-graph-inject',
        workDir: '/tmp',
      },
    });
    const graph: WorkGraph = {
      id: 'run-graph-inject:work_graph',
      runId: 'run-graph-inject',
      updatedAt: '2026-07-06T00:00:00.000Z',
      nodes: [
        {
          id: 'node-1',
          title: 'Implement API',
          status: 'running',
          stage: 'swarm',
        },
        {
          id: 'node-2',
          title: 'Verify docs',
          status: 'queued',
          stage: 'verify',
        },
      ],
    };
    agent.tools.getStore().set(ULTRAWORK_GRAPH_STORE_KEY, graph);
    Object.defineProperty(agent, 'ultraSwarmRun', { value: { runId: 'swarm-1' }, configurable: true });

    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    await agent.injection.injectAfterCompaction();

    expect(append).toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_graph_status>'),
      expect.objectContaining({ variant: 'ultrawork_graph_status' }),
    );
    const graphText = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_graph_status>'))?.[0] ?? '',
    );
    expect(graphText).toContain('run_id: run-graph-inject');
    expect(graphText).toContain('node-1');
    expect(append).toHaveBeenCalledWith(
      expect.stringContaining('<ultrawork_post_compaction>'),
      expect.objectContaining({ variant: 'ultrawork_post_compaction' }),
    );
  });
});

describe('suggestNextActions fallbacks', () => {
  it('never returns an empty action list', async () => {
    const { suggestNextActions } = await import('../../src/ultrawork/recovery-prompt');
    const actions = suggestNextActions({
      id: 'run-empty-actions',
      objective: 'Ship feature',
      status: 'running',
      stage: 'intake',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-empty-actions',
        workDir: '/tmp',
      },
    } as UltraworkRun);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]).toMatch(/Plan|checkpoint|evidence|WorkGraph|stage|Continue|Seed/i);
  });

  it('prioritizes seeding WorkGraph when graph is missing or empty', async () => {
    const { suggestNextActions } = await import('../../src/ultrawork/recovery-prompt');
    const missing = suggestNextActions({
      id: 'run-no-graph',
      objective: 'Ship feature',
      status: 'running',
      stage: 'integrate',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-no-graph',
        workDir: '/tmp',
      },
    } as UltraworkRun);
    expect(missing.some((a) => a.includes('Seed WorkGraph'))).toBe(true);

    const empty = suggestNextActions({
      id: 'run-empty-graph',
      objective: 'Ship feature',
      status: 'running',
      stage: 'integrate',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-empty-graph',
        workDir: '/tmp',
      },
      workGraph: {
        id: 'run-empty-graph:work_graph',
        runId: 'run-empty-graph',
        rootGoal: 'Ship feature',
        nodes: [],
      },
    } as UltraworkRun);
    expect(empty.some((a) => a.includes('Seed WorkGraph'))).toBe(true);
    expect(empty.some((a) => a.includes('empty graph is rejected'))).toBe(true);
  });

  it('fills a defensive fallback when stage guidance is empty', async () => {
    const { suggestNextActions } = await import('../../src/ultrawork/recovery-prompt');
    // Force an empty path by skipping interrupt/plan context and using a stage
    // that still produces stage guidance — assert non-empty is the contract.
    const actions = suggestNextActions({
      id: 'run-fallback-actions',
      objective: 'Ship feature',
      status: 'running',
      stage: 'done',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-fallback-actions',
        workDir: '/tmp',
      },
    } as UltraworkRun);
    expect(actions.length).toBeGreaterThan(0);
  });

  it('surfaces queued nodes waiting on dependsOn when not blocked', async () => {
    const { suggestNextActions } = await import('../../src/ultrawork/recovery-prompt');
    const actions = suggestNextActions({
      id: 'run-queued-deps',
      objective: 'Ship feature',
      status: 'running',
      stage: 'integrate',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-queued-deps',
        workDir: '/tmp',
      },
      workGraph: {
        id: 'run-queued-deps:work_graph',
        runId: 'run-queued-deps',
        rootGoal: 'Ship feature',
        nodes: [
          {
            id: 'node-dep',
            title: 'Upstream work',
            stage: 'integrate',
            status: 'running',
            ownerExpertId: 'expert-1',
          },
          {
            id: 'node-wait',
            title: 'Waiting integrate',
            stage: 'integrate',
            status: 'queued',
            dependsOn: ['node-dep'],
          },
        ],
      },
    } as UltraworkRun);
    expect(actions.some((a) => a.includes('Queued node(s) waiting on dependsOn'))).toBe(true);
    expect(actions.some((a) => a.includes('node-wait'))).toBe(true);
    expect(actions.some((a) => a.includes('dependsOn: node-dep'))).toBe(true);
  });

  it('prioritizes blocked WorkGraph nodes in next actions', async () => {
    const { suggestNextActions } = await import('../../src/ultrawork/recovery-prompt');
    const actions = suggestNextActions({
      id: 'run-blocked-actions',
      objective: 'Ship feature',
      status: 'running',
      stage: 'integrate',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-blocked-actions',
        workDir: '/tmp',
      },
      workGraph: {
        id: 'run-blocked-actions:work_graph',
        runId: 'run-blocked-actions',
        rootGoal: 'Ship feature',
        nodes: [
          {
            id: 'node-blocked',
            title: 'Waiting on review',
            stage: 'integrate',
            status: 'blocked',
            dependsOn: ['node-dep'],
          },
          {
            id: 'node-open',
            title: 'Open work',
            stage: 'integrate',
            status: 'queued',
          },
        ],
      },
    } as UltraworkRun);
    expect(actions.some((a) => a.includes('Unblock WorkGraph node'))).toBe(true);
    expect(actions.some((a) => a.includes('node-blocked'))).toBe(true);
    expect(actions.some((a) => a.includes('Waiting on review'))).toBe(true);
    expect(actions.some((a) => a.includes('dependsOn: node-dep'))).toBe(true);
  });

  it('surfaces verification gaps with missing required evidence', async () => {
    const { suggestNextActions } = await import('../../src/ultrawork/recovery-prompt');
    const actions = suggestNextActions({
      id: 'run-verify-gaps',
      objective: 'Ship feature',
      status: 'running',
      stage: 'verify',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-verify-gaps',
        workDir: '/tmp',
      },
      workGraph: {
        id: 'run-verify-gaps:work_graph',
        runId: 'run-verify-gaps',
        rootGoal: 'Ship feature',
        nodes: [
          {
            id: 'node-verify',
            title: 'AC1 runtime check',
            stage: 'verify',
            status: 'done',
            verificationStatus: 'pending',
            requiredEvidence: ['ev-runtime', 'ev-tests'],
            evidenceIds: ['ev-tests'],
          },
          {
            id: 'node-failed-verify',
            title: 'AC2 surface check',
            stage: 'verify',
            status: 'done',
            verificationStatus: 'failed',
            requiredEvidence: ['ev-ui'],
          },
        ],
      },
    } as UltraworkRun);
    expect(actions.some((a) => a.includes('Close verification gaps'))).toBe(true);
    expect(actions.some((a) => a.includes('node-verify'))).toBe(true);
    expect(actions.some((a) => a.includes('missing evidence: ev-runtime'))).toBe(true);
    expect(actions.some((a) => a.includes('node-failed-verify'))).toBe(true);
    expect(actions.some((a) => a.includes('verify=failed'))).toBe(true);
  });

  it('includes verification-gap nodes in post-swarm injection', () => {
    const agent = new Agent({ kaos: testKaos.withCwd(mkdtempSync(join(tmpdir(), 'uw-rec-'))) });
    agent.ultrawork.create({
      id: 'run-post-swarm-verify-gaps',
      objective: 'Ship feature',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-post-swarm-verify-gaps',
        workDir: '/tmp',
      },
    });
    agent.ultrawork.advance('research', 'test');
    agent.ultrawork.advance('goal', 'test');
    agent.ultrawork.advance('staff', 'test');
    agent.ultrawork.advance('swarm', 'test');
    agent.ultrawork.advance('integrate', 'test');
    agent.ultrawork.applyMirrorRunQuiet({
      run: {
        ...agent.ultrawork.getRun()!,
        status: 'running',
        stage: 'integrate',
        workGraph: {
          id: 'run-post-swarm-verify-gaps:work_graph',
          runId: 'run-post-swarm-verify-gaps',
          rootGoal: 'Ship feature',
          nodes: [
            {
              id: 'node-gap',
              title: 'AC runtime',
              stage: 'verify',
              status: 'done',
              verificationStatus: 'pending',
              requiredEvidence: ['ev-runtime'],
              evidenceIds: [],
            },
          ],
        },
      },
    });
    const append = vi.spyOn(agent.context, 'appendSystemReminder');
    injectUltraworkPostSwarmContinuation(agent);
    const text = String(
      append.mock.calls.find((call) => String(call[0]).includes('<ultrawork_post_swarm>'))?.[0] ??
        '',
    );
    expect(text).toContain('Verification-gap WorkGraph nodes');
    expect(text).toContain('node-gap');
    expect(text).toContain('missing=ev-runtime');
    expect(text).toContain('attach requiredEvidence');
  });

  it('flags ownerless running WorkGraph nodes in next actions', async () => {
    const { suggestNextActions } = await import('../../src/ultrawork/recovery-prompt');
    const actions = suggestNextActions({
      id: 'run-orphan-running',
      objective: 'Ship feature',
      status: 'running',
      stage: 'swarm',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-orphan-running',
        workDir: '/tmp',
      },
      workGraph: {
        id: 'run-orphan-running:work_graph',
        runId: 'run-orphan-running',
        rootGoal: 'Ship feature',
        nodes: [
          {
            id: 'node-orphan',
            title: 'Specialist wave without owner',
            stage: 'swarm',
            status: 'running',
          },
          {
            id: 'node-owned',
            title: 'Owned wave',
            stage: 'swarm',
            status: 'running',
            ownerExpertId: 'expert-1',
          },
        ],
      },
    } as UltraworkRun);
    expect(actions.some((a) => a.includes('orphan running node'))).toBe(true);
    expect(actions.some((a) => a.includes('node-orphan'))).toBe(true);
    expect(actions.some((a) => a.includes('Specialist wave without owner'))).toBe(true);
    // Owned running nodes are not listed in the orphan guidance.
    expect(
      actions.some((a) => a.includes('orphan running') && a.includes('node-owned')),
    ).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import { maybeFinishUltraworkRun } from '../../src/ultrawork/finish-run';
import { testKaos } from '../fixtures/test-kaos';

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

async function enterUltraPlan(agent: Agent, id: string): Promise<void> {
  await agent.planMode.enter(id, false, false, true, 'Ship feature');
}

interface StageChangedLike {
  type: string;
  run?: { status?: string };
  reason?: string;
}

describe('Ultrawork plan-mode release on terminal transitions', () => {
  it('releases Ultra Plan when a run reaches done', async () => {
    const agent = new Agent({ kaos: testKaos });
    createUltraworkAtPlan(agent, 'run-done-releases-plan');
    await enterUltraPlan(agent, 'done-release-plan');
    expect(agent.planMode.isActive).toBe(true);
    expect(agent.planMode.isUltraMode).toBe(true);

    agent.ultrawork.completeLearnStage('Ultrawork completed');

    expect(agent.ultrawork.getRun()?.status).toBe('done');
    expect(agent.planMode.isActive).toBe(false);
  });

  it('cancel() releases Ultra Plan and emits a terminal stage-changed event', async () => {
    const agent = new Agent({ kaos: testKaos });
    createUltraworkAtPlan(agent, 'run-cancel-releases-plan');
    await enterUltraPlan(agent, 'cancel-release-plan');
    await agent.goal.createGoal({ objective: 'Ship feature' });
    const emitSpy = vi.spyOn(agent, 'emitEvent');

    await agent.ultrawork.cancel('Cancelled by user');

    expect(agent.ultrawork.getRun()?.status).toBe('failed');
    expect(agent.planMode.isActive).toBe(false);

    const events = emitSpy.mock.calls.map((call) => call[0]) as StageChangedLike[];
    const terminal = events.find(
      (event) => event.type === 'ultrawork.stage.changed' && event.run?.status === 'failed',
    );
    expect(terminal).toBeDefined();
    expect(terminal?.reason).toBe('Cancelled by user');
  });

  it('finishes a terminal empty-WorkGraph run and releases stranded Ultra Plan', async () => {
    const agent = new Agent({ kaos: testKaos });
    createUltraworkAtPlan(agent, 'run-empty-graph-terminal');
    await enterUltraPlan(agent, 'empty-graph-plan');
    await agent.goal.createGoal({ objective: 'Ship feature' });

    await agent.ultrawork.cancel('Cancelled by user');
    const run = agent.ultrawork.getRun();
    expect(run?.status).toBe('failed');
    expect(run?.workGraph?.nodes.length ?? 0).toBe(0);

    // cancel() released plan mode already; simulate a stranded session where
    // Ultra Plan is still engaged (e.g. restored from a mirror) and prove
    // maybeFinishUltraworkRun releases it instead of returning early.
    await enterUltraPlan(agent, 'empty-graph-plan-reenter');
    expect(agent.planMode.isActive).toBe(true);

    maybeFinishUltraworkRun(agent);

    expect(agent.planMode.isActive).toBe(false);
  });

  it('closes the goal for a done run even when the WorkGraph is empty', async () => {
    const agent = new Agent({ kaos: testKaos });
    createUltraworkAtPlan(agent, 'run-empty-graph-done');
    await agent.goal.createGoal({ objective: 'Ship feature' });

    agent.ultrawork.completeLearnStage('Ultrawork completed');
    expect(agent.ultrawork.getRun()?.status).toBe('done');
    expect(agent.goal.getGoal().goal).not.toBeNull();

    void maybeFinishUltraworkRun(agent);

    await vi.waitFor(() => {
      expect(agent.goal.getGoal().goal).toBeNull();
    });
  });

  it('does not prematurely close a running run that has no WorkGraph yet', async () => {
    const agent = new Agent({ kaos: testKaos });
    createUltraworkAtPlan(agent, 'run-empty-graph-running');
    await agent.goal.createGoal({ objective: 'Ship feature' });

    const result = maybeFinishUltraworkRun(agent);

    expect(result).toBeUndefined();
    expect(agent.ultrawork.getRun()?.status).toBe('running');
    expect(agent.goal.getGoal().goal).not.toBeNull();
  });
});

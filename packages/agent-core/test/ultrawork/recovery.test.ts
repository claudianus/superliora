import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import type { UltraworkRun } from '@superliora/protocol';
import { Agent } from '../../src/agent';
import { testKaos } from '../fixtures/test-kaos';
import { buildUltraworkRecoveryPrompt, reconcileUltraworkRunForResume } from '../../src/ultrawork/recovery';

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

describe('Ultrawork recovery', () => {
  it('reconciles orphaned running graph nodes and experts', () => {
    const agent = new Agent({ kaos: testKaos });
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

  it('preserves interrupt reason in recovery prompt after resume', async () => {
    const agent = new Agent({ kaos: testKaos });
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
});

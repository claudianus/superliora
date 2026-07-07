import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it, vi } from 'vitest';

import type { UltraworkRun } from '@superliora/protocol';
import { Agent } from '../../src/agent';
import { testKaos } from '../fixtures/test-kaos';
import {
  buildUltraworkRecoveryPrompt,
  injectUltraworkPostSwarmContinuation,
  reconcileUltraworkRunForResume,
} from '../../src/ultrawork/recovery';

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
      },
    );
    expect(prompt).toContain('Plan file: /tmp/plans/quasar-archangel-falcon.md');
    expect(prompt).toContain('UltraPlan phase: interview');
    expect(prompt).toContain('Interview rounds completed: 3');
    expect(prompt).toContain('continue_interview_from_round: 4');
    expect(prompt).toContain('Do not restart the UltraPlan interview from round 1.');
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

  it('injects post-swarm continuation only when the run reaches integrate', () => {
    const agent = new Agent({ kaos: testKaos });
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
  });
});

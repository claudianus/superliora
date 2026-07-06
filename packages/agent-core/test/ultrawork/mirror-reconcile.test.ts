import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/agent';
import { buildUltraworkCompactionEnvelope } from '../../src/ultrawork/envelope';
import {
  inferUltraPlanPhaseFromPlanContent,
  reconcileUltraworkFromMirror,
} from '../../src/ultrawork/mirror-reconcile';
import { mirrorUltraworkRunToDisk } from '../../src/ultrawork/run-store';
import { testKaos } from '../fixtures/test-kaos';

describe('Ultrawork mirror reconcile', () => {
  it('infers write phase from a populated plan file', () => {
    const phase = inferUltraPlanPhaseFromPlanContent(`# Ultra Plan

## Seed Spec
- Verifiable UltraGoal: Ship docs
- Completion Criterion: README updated
- Acceptance Criteria: docs build passes
- Verification Plan: pnpm build

## WorkGraph
- node-1

Swarm decision: DEFER - single owner; value: none; owner: main

## Execution Plan
1. Update README
`);
    expect(phase).toBe('exit');
  });

  it('restores plan checkpoint from run-state mirror when records lack interview state', async () => {
    const homedir = join(tmpdir(), `ultrawork-mirror-${String(Date.now())}`);
    mkdirSync(homedir, { recursive: true });

    const agent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    await agent.planMode.enter('mirror-plan', false, true, true, 'Mirror restore');
    agent.ultrawork.create({
      id: 'run-mirror',
      objective: 'Mirror restore',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-mirror',
        workDir: homedir,
      },
    });

    agent.planMode.setPhase('interview');
    agent.planMode.ultraEngine.addInterviewRound('Scope?', 'README only');
    agent.planMode.incrementInterviewRound();
    const checkpoint = agent.planMode.captureStateCheckpoint();
    expect(checkpoint).not.toBeNull();

    const run = agent.ultrawork.getRun()!;
    mirrorUltraworkRunToDisk({
      workDir: homedir,
      run,
      planCheckpoint: {
        planFilePath: agent.planMode.planFilePath ?? undefined,
        phase: 'interview',
        interviewRoundCount: 1,
        ultraPlan: checkpoint?.ultraPlan,
      },
    });

    const replayAgent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    await replayAgent.planMode.enter('mirror-plan', false, false, true, 'Mirror restore');
    replayAgent.ultrawork.restoreRun({
      type: 'ultrawork.run',
      run,
      time: Date.now(),
    });
    await reconcileUltraworkFromMirror(replayAgent);

    expect(replayAgent.planMode.phase).toBe('interview');
    expect(replayAgent.planMode.ultraEngine.interviewState.rounds).toHaveLength(1);
  });

  it('embeds an ultrawork envelope into compaction output', async () => {
    const homedir = join(tmpdir(), `ultrawork-compact-${String(Date.now())}`);
    mkdirSync(homedir, { recursive: true });
    const agent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    agent.ultrawork.create({
      id: 'run-compact',
      objective: 'Compact me',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-compact',
        workDir: '/tmp',
      },
    });
    await agent.planMode.enter('compact-plan', false, true, true, 'Compact me');
    agent.planMode.setPhase('interview');
    agent.planMode.ultraEngine.addInterviewRound('Scope?', 'README');

    const envelope = buildUltraworkCompactionEnvelope(agent);
    expect(envelope).toContain('## Ultrawork Run Envelope');
    expect(envelope).toContain('run_id: run-compact');
    expect(envelope).toContain('ultraplan_phase: interview');
    expect(envelope).toContain('resume_policy:');
  });

  it('rejects creating a second active ultrawork run', () => {
    const agent = new Agent({ kaos: testKaos });
    agent.ultrawork.create({
      id: 'run-active',
      objective: 'Active',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-active',
        workDir: '/tmp',
      },
    });
    expect(() =>
      agent.ultrawork.create({
        id: 'run-next',
        objective: 'Duplicate',
        activation: {
          source: 'manual',
          replaceGoal: false,
          evidenceRoot: '.superliora/evidence/ultrawork-runs/run-next',
          workDir: '/tmp',
        },
      }),
    ).toThrow(/already active/i);
  });
});

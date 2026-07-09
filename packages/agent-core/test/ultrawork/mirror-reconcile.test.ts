import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/agent';
import { validateUltraworkCompactionContinuity } from '../../src/agent/compaction/quality';
import { buildUltraworkCompactionEnvelope, renderUltraworkRunsMemorySection, captureUltraworkEnvelopeSnapshot } from '../../src/ultrawork/envelope';
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

  it('restores approved plan file path from mirror checkpoint', async () => {
    const homedir = join(tmpdir(), `ultrawork-plan-path-${String(Date.now())}`);
    mkdirSync(homedir, { recursive: true });
    const plansDir = join(homedir, 'plans');
    mkdirSync(plansDir, { recursive: true });
    const approvedPath = join(plansDir, 'spoiler-storm-cannonball.md');
    const stalePath = join(plansDir, 'vision-hal-jordan-thunder.md');
    writeFileSync(
      approvedPath,
      `# Ultra Plan

## Seed Spec
- Verifiable UltraGoal: Ship feature
- Acceptance Criteria: build passes
- Verification Plan: pnpm test

## WorkGraph
| node id | stage | description |
| WG-1 | integrate | scaffold |

Swarm decision: ENGAGE

## Execution Plan
1. Build
`,
      'utf8',
    );
    writeFileSync(stalePath, '# Draft only\n', 'utf8');

    const agent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    await agent.planMode.enter('vision-hal-jordan-thunder', false, false, true, 'Resume');
    agent.ultrawork.create({
      id: 'run-plan-path',
      objective: 'Resume plan path',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-plan-path',
        workDir: homedir,
      },
    });
    const run = agent.ultrawork.getRun()!;
    agent.ultrawork.attachTeamPlan({
      id: 'team-1',
      runId: run.id,
      intensity: 'balanced',
      maxExperts: 4,
      experts: [{ id: 'expert-1', name: 'QA', role: 'reviewer', focus: 'review', status: 'queued' }],
    });
    mirrorUltraworkRunToDisk({
      workDir: homedir,
      run: agent.ultrawork.getRun()!,
      planCheckpoint: {
        planFilePath: stalePath,
        phase: 'interview',
        interviewRoundCount: 1,
      },
    });

    const replayAgent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    await replayAgent.planMode.enter('vision-hal-jordan-thunder', false, false, true, 'Resume');
    replayAgent.ultrawork.restoreRun({
      type: 'ultrawork.run',
      run: agent.ultrawork.getRun()!,
      time: Date.now(),
    });
    await reconcileUltraworkFromMirror(replayAgent);

    expect(replayAgent.planMode.isActive).toBe(false);
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

    const envelope = buildUltraworkCompactionEnvelope(agent, { compactionBoundary: true });
    expect(envelope).toContain('## Ultrawork Run Envelope');
    expect(envelope).toContain('run_id: run-compact');
    expect(envelope).toContain('ultraplan_phase: interview');
    expect(envelope).toContain('compaction_boundary: true');
    expect(envelope).toContain('resume_cursor:');
    expect(envelope).toContain('resume_policy:');

    const snapshot = captureUltraworkEnvelopeSnapshot(agent, { compactionBoundary: true });
    expect(snapshot).not.toBeUndefined();
    const runsSection = renderUltraworkRunsMemorySection(snapshot!);
    expect(runsSection).toContain('ultrawork_runs:');
    expect(runsSection).toContain('run_id=run-compact');

    const quality = validateUltraworkCompactionContinuity(
      `${envelope}\n\n${runsSection}\nnext_actions:\n- Continue Ultrawork`,
      snapshot!,
    );
    expect(quality.critical).toHaveLength(0);
  });

  it('flushes ultrawork checkpoint before compaction begins', async () => {
    const homedir = join(tmpdir(), `ultrawork-flush-${String(Date.now())}`);
    mkdirSync(homedir, { recursive: true });
    const agent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    agent.ultrawork.create({
      id: 'run-flush',
      objective: 'Flush checkpoint',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-flush',
        workDir: homedir,
      },
    });

    const mirrorPath = join(
      homedir,
      '.superliora/evidence/ultrawork-runs/run-flush/run-state.json',
    );
    agent.ultrawork.flushCheckpoint();
    const mirror = JSON.parse(readFileSync(mirrorPath, 'utf8')) as { run: { id: string } };
    expect(mirror.run.id).toBe('run-flush');
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

  it('treats the journal as authoritative: a mirror whose offset lags is ignored', async () => {
    // The on-disk mirror is auxiliary. When it carries a journalOffset that is
    // behind the replayed journal, resume must keep the journal's run (even if
    // the mirror is "newer" by timestamp) so a stale mirror cannot regress
    // progress that is durably recorded in the wire log.
    const homedir = join(tmpdir(), `ultrawork-offset-${String(Date.now())}`);
    mkdirSync(homedir, { recursive: true });

    const agent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    agent.ultrawork.create({
      id: 'run-offset',
      objective: 'Offset authority',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-offset',
        workDir: homedir,
      },
    });

    // Advance the in-memory run to a richer state than the mirror will claim.
    const advancedRun = agent.ultrawork.getRun()!;
    const richerRun = {
      ...advancedRun,
      workGraph: {
        ...advancedRun.workGraph,
        nodes: [
          ...(advancedRun.workGraph?.nodes ?? []),
          {
            id: 'WG-journal',
            stage: 'integrate',
            description: 'node only the journal knows',
            status: 'done' as const,
          },
        ],
      },
    };

    // Write a mirror whose journalOffset is BEHIND the journal (0 < the live
    // record count), with an older, smaller workGraph. The mirror must lose.
    mirrorUltraworkRunToDisk({
      workDir: homedir,
      run: advancedRun,
      journalOffset: 0,
    });

    const replayAgent = new Agent({ kaos: testKaos.withCwd(homedir), homedir });
    // Simulate the journal having replayed the richer run state.
    replayAgent.ultrawork.restoreRun({
      type: 'ultrawork.run',
      run: richerRun,
      time: Date.now(),
    });

    await reconcileUltraworkFromMirror(replayAgent);

    const after = replayAgent.ultrawork.getRun();
    // The journal's richer graph survives; the stale mirror did not regress it.
    expect(after?.workGraph?.nodes.some((n) => n.id === 'WG-journal')).toBe(true);
  });
});

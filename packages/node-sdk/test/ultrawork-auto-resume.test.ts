import { describe, expect, it, vi } from 'vitest';

import type { UltraworkRun } from '#/types';
import {
  ensureUltraworkResumeSetup,
  tryAutoResumeUltrawork,
  type UltraworkAutoResumeSession,
} from '#/ultrawork-auto-resume';

function sampleStatus(overrides: { swarmMode?: boolean; planMode?: boolean } = {}) {
  return {
    thinkingLevel: 'off',
    permission: 'manual' as const,
    planMode: overrides.planMode ?? false,
    swarmMode: overrides.swarmMode ?? true,
    contextTokens: 0,
    maxContextTokens: 1000,
    contextUsage: 0,
  };
}

function sampleResume(run: UltraworkRun = sampleRun()) {
  return {
    run,
    report: {
      run,
      interruptReason: 'test',
      orphanedWorkNodes: [],
      orphanedExperts: [],
      lostBackgroundTasks: [],
      nextActions: [],
    },
    goalResumed: false,
    recoveryPrompt: 'resume',
  };
}

function sampleRun(overrides: Partial<UltraworkRun> = {}): UltraworkRun {
  return {
    id: 'run-1',
    objective: 'Ship feature',
    status: 'blocked',
    stage: 'integrate',
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:05:00.000Z',
    teamPlan: {
      id: 'team-1',
      runId: 'run-1',
      intensity: 'balanced',
      maxExperts: 4,
      experts: [{ id: 'expert-1', name: 'QA', role: 'reviewer', focus: 'review', status: 'queued' }],
    },
    ...overrides,
  };
}

describe('ultrawork auto resume', () => {
  it('exits plan mode when the run is past planning but plan mode is still active', async () => {
    const setPlanMode = vi.fn(async () => {});
    const session = {
      getUltraworkRun: vi.fn(async () => sampleRun()),
      resumeUltrawork: vi.fn(async () => sampleResume()),
      getStatus: vi.fn(async () => sampleStatus({ swarmMode: true, planMode: true })),
      setSwarmMode: vi.fn(async () => {}),
      setPlanMode,
    } as unknown as UltraworkAutoResumeSession;

    const changed = await ensureUltraworkResumeSetup(session, sampleRun());
    expect(changed).toBe(true);
    expect(setPlanMode).toHaveBeenCalledWith(false);
  });

  it('does not re-enable plan mode when the run is past planning', async () => {
    const setPlanMode = vi.fn(async () => {});
    const session = {
      getUltraworkRun: vi.fn(async () => sampleRun()),
      resumeUltrawork: vi.fn(async () => sampleResume()),
      getStatus: vi.fn(async () => sampleStatus({ swarmMode: true, planMode: false })),
      setSwarmMode: vi.fn(async () => {}),
      setPlanMode,
    } as unknown as UltraworkAutoResumeSession;

    const changed = await ensureUltraworkResumeSetup(session, sampleRun());
    expect(changed).toBe(false);
    expect(setPlanMode).not.toHaveBeenCalled();
  });

  it('enables swarm and plan mode for early-stage runs', async () => {
    const setPlanMode = vi.fn(async () => {});
    const session = {
      getUltraworkRun: vi.fn(async () => sampleRun({ stage: 'plan', teamPlan: undefined })),
      resumeUltrawork: vi.fn(async () => sampleResume(sampleRun({ stage: 'plan' }))),
      getStatus: vi.fn(async () => sampleStatus({ swarmMode: false, planMode: false })),
      setSwarmMode: vi.fn(async () => {}),
      setPlanMode,
    } as unknown as UltraworkAutoResumeSession;

    const changed = await ensureUltraworkResumeSetup(session, sampleRun({ stage: 'plan', teamPlan: undefined }));
    expect(changed).toBe(true);
    expect(setPlanMode).toHaveBeenCalledWith(true, true, 'Ship feature');
  });

  it('auto-resumes blocked runs', async () => {
    const resumed = sampleResume();
    const session = {
      getUltraworkRun: vi.fn(async () => sampleRun()),
      resumeUltrawork: vi.fn(async () => resumed),
      getStatus: vi.fn(async () => sampleStatus({ swarmMode: true, planMode: false })),
      setSwarmMode: vi.fn(async () => {}),
      setPlanMode: vi.fn(async () => {}),
    } as unknown as UltraworkAutoResumeSession;

    const result = await tryAutoResumeUltrawork(session);
    expect(result?.resumed).toBe(resumed);
    expect(result?.setupChanged).toBe(false);
  });
});

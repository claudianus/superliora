/**
 * Conductor × Matt Pocock harness bindings — seams, TDD, debug repro, DAG blockers.
 */

import { describe, expect, it } from 'vitest';

import { renderStructuredBriefSections } from '../../src/tools/builtin/job/job-brief';
import { createJob } from '../../src/tools/builtin/job/job-ledger';
import { blockersAllowSchedule, nextQueuedJobs } from '../../src/tools/builtin/job/job-runtime';
import { JobCreateTool } from '../../src/tools/builtin/job/job-tools';
import { jobPrompt } from '../../src/tools/builtin/job/job-worker';
import { buildPlanDeskBrief } from '../../src/tools/builtin/planning/plan-desk';
import {
  assessSkillWritingQuality,
} from '../../src/tools/builtin/fleet/skill-writing-quality';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get(key) {
      return data[key] as never;
    },
    set(key, value) {
      data[key] = value;
    },
  };
}

describe('tdd_mode / test_seams JobCreate', () => {
  it('rejects tdd_mode=required without test_seams', () => {
    const tool = new JobCreateTool(memoryStore());
    const exec = tool.resolveExecution({
      title: 'Add checkout',
      kind: 'implement',
      success_criteria: ['checkout happy path passes'],
      tdd_mode: 'required',
    });
    expect(exec.isError).toBe(true);
    expect(String(exec.output)).toMatch(/test_seams/);
  });

  it('stores seams and defaults tdd_mode=preferred for coding Jobs', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'Add checkout',
      kind: 'implement',
      success_criteria: ['checkout happy path passes'],
      test_seams: ['CheckoutService.placeOrder'],
      staff: false,
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    const job = store.get('job_ledger')?.jobs[0]!;
    expect(job.testSeams).toEqual(['CheckoutService.placeOrder']);
    expect(job.tddMode).toBe('preferred');
    expect(renderStructuredBriefSections(job)).toMatch(/Test seams/);
  });
});

describe('worker TDD / debug contracts', () => {
  it('includes TDD DoD and seam lines for implement Jobs', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Feature',
      kind: 'implement',
      successCriteria: ['tests pass'],
      testSeams: ['PublicAPI.handle'],
      tddMode: 'required',
    });
    const prompt = jobPrompt(job);
    expect(prompt).toMatch(/TDD DoD \(required\)/);
    expect(prompt).toMatch(/PublicAPI\.handle/);
    expect(prompt).toMatch(/CONTEXT\.md/);
  });

  it('includes diagnosing Phase 1 for debug Jobs', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Debug: flaky',
      kind: 'implement',
      successCriteria: ['repro goes green'],
      reproCommand: 'node scripts/test-local.mjs packages/foo -t flake',
    });
    const prompt = jobPrompt(job);
    expect(prompt).toMatch(/Diagnosing Phase 1|tight red-capable/i);
    expect(prompt).toContain('node scripts/test-local.mjs packages/foo -t flake');
  });

  it('includes prototype contract for explore prototype Jobs', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Prototype checkout state machine',
      kind: 'explore',
      prompt: 'Throwaway prototype for the reducer shape',
    });
    expect(jobPrompt(job)).toMatch(/Prototype explore/);
  });
});

describe('blocked_by_job_ids scheduling', () => {
  it('holds queued Jobs until blockers are done', () => {
    const store = memoryStore();
    const a = createJob(store, {
      title: 'Slice A',
      kind: 'implement',
      priority: 5,
      successCriteria: ['a'],
      tddMode: 'off',
    });
    const b = createJob(store, {
      title: 'Slice B',
      kind: 'implement',
      priority: 10,
      successCriteria: ['b'],
      blockedByJobIds: [a.id],
      tddMode: 'off',
    });
    const byId = new Map(store.get('job_ledger')!.jobs.map((j) => [j.id, j]));
    expect(blockersAllowSchedule(byId, b)).toBe(false);
    expect(nextQueuedJobs(store, 5).map((j) => j.id)).toEqual([a.id]);

    // Mark A done via store mutation
    const ledger = store.get('job_ledger')!;
    store.set('job_ledger', {
      ...ledger,
      jobs: ledger.jobs.map((j) => (j.id === a.id ? { ...j, status: 'done' as const } : j)),
    });
    expect(nextQueuedJobs(store, 5).map((j) => j.id)).toContain(b.id);
  });
});

describe('Plan Desk grilling brief', () => {
  it('embeds frontier grilling and handoff seams', () => {
    const brief = buildPlanDeskBrief('Ship auth refresh', true);
    expect(brief).toMatch(/frontier/i);
    expect(brief).toMatch(/AskUserQuestion/);
    expect(brief).toMatch(/test_seams/);
    expect(brief).toMatch(/Not yet specified/);
    expect(brief).toMatch(/CONTEXT\.md/);
  });
});

describe('SkillCreate writing-for-agents gate', () => {
  it('rejects bodies without a completion criterion', () => {
    const issues = assessSkillWritingQuality(
      'When things fail, try again. Do not give up. Never skip logs. Avoid shortcuts.',
    );
    expect(issues.some((i) => i.code === 'missing_completion_criterion')).toBe(true);
  });

  it('accepts bodies with Done when', () => {
    expect(
      assessSkillWritingQuality(
        [
          '## Steps',
          '1. Run the failing test.',
          '2. Fix the smallest cause.',
          '',
          'Done when the focused test exits 0 and the summary cites the command.',
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});

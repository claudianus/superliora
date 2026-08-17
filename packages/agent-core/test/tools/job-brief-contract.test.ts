/**
 * Conductor structured Job brief contract — schema gates + worker prompt sections.
 */

import { describe, expect, it } from 'vitest';

import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { JobCreateTool, renderJobInspect } from '../../src/tools/builtin/job/job-tools';
import { jobPrompt } from '../../src/tools/builtin/job/job-worker';
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

describe('JobCreate structured brief', () => {
  it('stores success_criteria / must_not_touch / verification_commands on the ledger', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'Fix auth refresh',
      kind: 'implement',
      prompt: 'User said: fix the race.',
      success_criteria: ['auth refresh race test passes'],
      must_not_touch: ['apps/site'],
      verification_commands: ['pnpm test auth'],
      delivery_mode: 'standard',
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    const jobs = store.get('job_ledger')?.jobs ?? [];
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.successCriteria).toEqual(['auth refresh race test passes']);
    expect(job.mustNotTouch).toEqual(['apps/site']);
    expect(job.verificationCommands).toEqual(['pnpm test auth']);
  });

  it('rejects task/implement without success_criteria (goal contract at spawn)', () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const missingCriteria = tool.resolveExecution({
      title: 'Fix flicker',
      kind: 'implement',
    });
    expect(missingCriteria.isError).toBe(true);
    expect(String(missingCriteria.output)).toMatch(/success_criteria/);
  });

  it('rejects task/implement success_criteria that are TBD/later placeholders', () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const placeholder = tool.resolveExecution({
      title: 'Fix flicker',
      kind: 'implement',
      success_criteria: ['TBD'],
    });
    expect(placeholder.isError).toBe(true);
    expect(String(placeholder.output)).toMatch(/placeholder/i);

    const mixed = tool.resolveExecution({
      title: 'Fix flicker',
      kind: 'implement',
      success_criteria: ['focused smoke exits 0', 'fill in later'],
    });
    expect(mixed.isError).toBe(true);
    expect(String(mixed.output)).toMatch(/fill in later/i);
  });

  it('rejects goal-driver completion criteria that are placeholders', () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const result = tool.resolveExecution({
      title: 'Drive until green',
      kind: 'goal-driver',
      prompt: 'Keep going until the suite is green.',
      goal_completion_criterion: 'to be determined',
    });
    expect(result.isError).toBe(true);
    expect(String(result.output)).toMatch(/goal_completion_criterion/);
    expect(String(result.output)).toMatch(/placeholder/i);
  });

  it('binds goal_gate_command (or first verification_commands) onto goal-driver Jobs', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const explicit = tool.resolveExecution({
      title: 'Drive until green',
      kind: 'goal-driver',
      prompt: 'Keep going until the suite is green.',
      goal_completion_criterion: 'pnpm test exits 0',
      goal_gate_command: 'pnpm test',
    });
    expect(explicit.isError).toBeFalsy();
    if (explicit.isError) return;
    await explicit.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    const withGate = store.get('job_ledger')?.jobs.find((j) => j.kind === 'goal-driver');
    expect(withGate?.goalGateCommand).toBe('pnpm test');
    expect(jobPrompt(withGate!)).toContain('Gate command');

    const store2 = memoryStore();
    const tool2 = new JobCreateTool(store2);
    const inferred = tool2.resolveExecution({
      title: 'Drive until green',
      kind: 'goal-driver',
      prompt: 'Keep going until the suite is green.',
      goal_completion_criterion: 'suite green',
      verification_commands: ['pnpm run check', 'pnpm test'],
    });
    expect(inferred.isError).toBeFalsy();
    if (inferred.isError) return;
    await inferred.execute({
      turnId: 't',
      toolCallId: 'c2',
      signal: new AbortController().signal,
    });
    const inferredJob = store2.get('job_ledger')?.jobs.find((j) => j.kind === 'goal-driver');
    expect(inferredJob?.goalGateCommand).toBe('pnpm run check');
  });

  it('rejects greenfield task/implement without must_not_touch', () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const missingFence = tool.resolveExecution({
      title: 'Build MVP',
      kind: 'implement',
      delivery_mode: 'greenfield',
      success_criteria: ['smoke passes'],
    });
    expect(missingFence.isError).toBe(true);
    expect(String(missingFence.output)).toMatch(/must_not_touch/);
  });

  it('allows explore without success_criteria', () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'Map auth module',
      kind: 'explore',
      prompt: 'Read-only survey of src/auth.',
    });
    expect(exec.isError).toBeFalsy();
  });

  it('rejects greenfield_chain without delivery_mode=greenfield', () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'Build MVP',
      greenfield_chain: true,
      success_criteria: ['smoke passes'],
      must_not_touch: ['docs/'],
    });
    expect(exec.isError).toBe(true);
    expect(String(exec.output)).toMatch(/greenfield_chain requires delivery_mode/);
  });
});

describe('jobPrompt structured brief sections', () => {
  it('renders success criteria and must-not-touch above free-text Brief', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Ship feature',
      prompt: 'Quoted user ask.',
      successCriteria: ['suite green'],
      mustNotTouch: ['packages/server'],
      verificationCommands: ['pnpm test:local'],
      deliveryMode: 'greenfield',
      deliveryPhase: 'skeleton',
    });
    const prompt = jobPrompt(job, store);
    expect(prompt).toContain('Success criteria:');
    expect(prompt).toContain('- suite green');
    expect(prompt).toContain('Must not touch:');
    expect(prompt).toContain('Greenfield phase: skeleton.');
    expect(prompt).toContain('Do not implement product logic');
    expect(prompt.indexOf('Success criteria')).toBeLessThan(prompt.indexOf('Brief:'));
  });
});

describe('greenfield_chain JobCreate', () => {
  it('enqueues skeleton → fill → delete-pass with parent links', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'New CLI tool',
      kind: 'implement',
      delivery_mode: 'greenfield',
      greenfield_chain: true,
      success_criteria: ['smoke exits 0'],
      must_not_touch: ['apps/liora'],
      verification_commands: ['pnpm smoke'],
      prompt: 'Build a tiny CLI.',
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    expect(String(result.output)).toMatch(/greenfield chain/);
    const jobs = store.get('job_ledger')?.jobs ?? [];
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.deliveryPhase)).toEqual(['skeleton', 'fill', 'delete_pass']);
    expect(jobs[0]!.parentJobId).toBeUndefined();
    expect(jobs[1]!.parentJobId).toBe(jobs[0]!.id);
    expect(jobs[2]!.parentJobId).toBe(jobs[1]!.id);
    expect(jobPrompt(jobs[0]!, store)).toContain('Greenfield phase: skeleton.');
    expect(jobPrompt(jobs[0]!, store)).toContain('Do not use VerifySurface as a done-gate on empty scenes');
    expect(jobPrompt(jobs[0]!, store)).not.toContain('VerifySurface 4');
    expect(jobPrompt(jobs[2]!, store)).toContain('Greenfield phase: delete-pass.');
    patchJob(store, jobs[0]!.id, {
      status: 'done',
      resultSummary: 'Skeleton laid out under apps/demo.',
    });
    expect(jobPrompt(jobs[1]!, store)).toContain('Prior findings from parent job');
    expect(jobPrompt(jobs[1]!, store)).toContain('Skeleton laid out under apps/demo.');
  });

  it('splits phase contracts instead of copying product AC onto skeleton', async () => {
    const store = memoryStore();
    const tool = new JobCreateTool(store);
    const exec = tool.resolveExecution({
      title: 'RUSTWING',
      kind: 'implement',
      delivery_mode: 'greenfield',
      greenfield_chain: true,
      surface_kind: 'web',
      success_criteria: [
        'Title → ending full loop',
        'VerifySurface 4 chapters',
        'Combat holds 60fps',
        'Weapons 8 / bosses 5',
      ],
      must_not_touch: ['packages/agent-core'],
      verification_commands: [
        'npx tsc --noEmit',
        'npx vitest run --reporter=dot',
        'VerifySurface title/stage/boss/ending',
      ],
      prompt: 'Ship the full game.',
    });
    expect(exec.isError).toBeFalsy();
    if (exec.isError) return;
    const result = await exec.execute({
      turnId: 't',
      toolCallId: 'c',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(false);
    const jobs = store.get('job_ledger')?.jobs ?? [];
    expect(jobs).toHaveLength(3);
    const [skeleton, fill, del] = jobs;

    expect(skeleton!.successCriteria?.join('\n')).not.toMatch(/VerifySurface 4|60fps|Title → ending/i);
    expect(skeleton!.successCriteria?.some((line) => /scaffold|typecheck|empty scenes|schema/i.test(line))).toBe(
      true,
    );
    expect(skeleton!.verificationCommands?.join('\n')).not.toMatch(/VerifySurface/i);
    expect(skeleton!.verificationCommands?.some((cmd) => /tsc|vitest/i.test(cmd))).toBe(true);
    expect(skeleton!.surfaceKind).toBeUndefined();

    const skeletonPrompt = jobPrompt(skeleton!, store);
    expect(skeletonPrompt).toContain('Skeleton only');
    expect(skeletonPrompt).toContain('Chrome/Playwright reinstall loops are forbidden');
    expect(skeletonPrompt).not.toContain('Need VerifySurface pass');

    expect(fill!.successCriteria).toEqual([
      'Title → ending full loop',
      'VerifySurface 4 chapters',
      'Combat holds 60fps',
      'Weapons 8 / bosses 5',
    ]);
    expect(fill!.verificationCommands).toEqual([
      'npx tsc --noEmit',
      'npx vitest run --reporter=dot',
      'VerifySurface title/stage/boss/ending',
    ]);
    expect(fill!.surfaceKind).toBe('web');
    expect(jobPrompt(fill!, store)).toMatch(/VerifySurface|surface_kind=web/i);
    expect(jobPrompt(fill!, store)).toContain('Visual / VerifySurface belongs here when surface_kind=web');

    expect(del!.successCriteria?.join('\n')).toMatch(/placeholder|dead/i);
    expect(del!.successCriteria?.join('\n')).not.toMatch(/Title → ending|Weapons 8/i);
    expect(jobPrompt(del!, store)).toContain('Do not rebuild the product from scratch');
    expect(del!.surfaceKind).toBeUndefined();
  });
});

describe('JobInspect implement handoff', () => {
  it('surfaces a parsed handoff draft from a mission result summary', () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Plan: build app',
      kind: 'mission',
      planStructured: true,
    });
    const withSummary = {
      ...job,
      resultSummary: [
        'Plan path: /tmp/plan.md',
        '## Implement handoff',
        'success_criteria:',
        '- landing loads',
        'must_not_touch:',
        '- packages/server',
        'verification_commands:',
        '- pnpm test',
        'ownership_paths:',
        '- apps/site',
        'context_paths:',
        '- apps/site/src',
        'delivery_mode: greenfield',
      ].join('\n'),
    };
    store.set('job_ledger', { schemaVersion: 1, jobs: [withSummary] });
    const text = renderJobInspect(getJob(store, job.id)!);
    expect(text).toContain('implement_handoff (JobCreate draft');
    expect(text).toContain('delivery_mode: greenfield');
    expect(text).toContain('greenfield_chain: true');
  });
});

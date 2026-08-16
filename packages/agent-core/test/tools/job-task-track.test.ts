/**
 * Per-Job taskTrack: conservative classifier + general gate skips.
 */

import { describe, expect, it } from 'vitest';

import { isSensitiveFile } from '../../src/tools/policies/sensitive';
import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { scheduleQueuedJobs } from '../../src/tools/builtin/job/job-runtime';
import {
  classifyJobTaskTrack,
  classifyJobTrack,
  parseGeneralVerdict,
} from '../../src/tools/builtin/job/job-task-track';
import { JobCreateTool, createConductorJobDraftRecorder } from '../../src/tools/builtin/job/job-tools';
import { jobPrompt } from '../../src/tools/builtin/job/job-worker';
import {
  evaluateVerifyChainForMerge,
  shouldAutoEnqueueMergeAfterVerify,
  shouldEnqueueVerifyAfterDone,
} from '../../src/tools/builtin/job/job-verify-chain';
import { mergeTrustInputFromLedger } from '../../src/tools/builtin/job/job-merge-trust';
import { splitUserMessageIntoJobIntents } from '../../src/tools/builtin/job/job-split';
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

function countingWorktreeFactory(created: string[]) {
  return async (_kaos: unknown, input: { readonly name: string }) => {
    created.push(input.name);
    return { workDir: `/tmp/wt/${input.name}`, branch: `job/${input.name}` };
  };
}

async function createViaTool(
  store: ToolStore,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; output?: string }> {
  const tool = new JobCreateTool(store);
  const exec = tool.resolveExecution(args);
  if (exec.isError) return { isError: true, output: String(exec.output) };
  const result = await exec.execute({
    turnId: 't',
    toolCallId: 'c',
    signal: new AbortController().signal,
  });
  return { isError: Boolean(result.isError), output: String(result.output ?? '') };
}

describe('classifyJobTaskTrack / classifyJobTrack', () => {
  it.each([
    ['A', '클로드코드 설치해줘', 'general'],
    ['B', '운영체제 설정 수정해줘', 'general'],
    ['C', '롤 켜줘', 'general'],
    ['D', 'packages/agent-core auth 토큰 갱신 레이스 고쳐줘', 'coding'],
    ['F', '이 레포에 prettier 설치하고 lint 고쳐줘', 'coding'],
    ['G-empty', '', 'coding'],
    ['G-vague', '이거 해줘', 'coding'],
  ] as const)('%s → %s', (_id, text, expected) => {
    expect(classifyJobTaskTrack({ title: text, prompt: text })).toBe(expected);
    expect(classifyJobTrack({ title: text, prompt: text })).toBe(expected);
  });

  it('keeps in-repo package-manager install on coding', () => {
    expect(
      classifyJobTaskTrack({
        title: 'deps',
        prompt: 'npm install prettier in this repo',
      }),
    ).toBe('coding');
  });

  it('honors hidden explicit override', () => {
    expect(
      classifyJobTaskTrack({
        title: '롤 켜줘',
        prompt: '롤 켜줘',
        explicit: 'coding',
      }),
    ).toBe('coding');
    expect(
      classifyJobTaskTrack({
        title: 'fix auth',
        prompt: 'packages/oauth bug',
        explicit: 'general',
      }),
    ).toBe('general');
    expect(
      classifyJobTaskTrack({
        title: '롤 켜줘',
        prompt: '롤 켜줘',
        explicit: 'nope',
      }),
    ).toBe('general');
  });

  it('inherits affinity track when no explicit override', () => {
    expect(
      classifyJobTaskTrack({
        title: 'same app again',
        prompt: 'same app again',
        inherited: 'general',
      }),
    ).toBe('general');
  });

  it('forces coding for greenfield and non-task kinds', () => {
    expect(
      classifyJobTaskTrack({
        title: '클로드코드 설치해줘',
        prompt: '클로드코드 설치해줘',
        deliveryMode: 'greenfield',
      }),
    ).toBe('coding');
    expect(
      classifyJobTaskTrack({
        title: '클로드코드 설치해줘',
        prompt: '클로드코드 설치해줘',
        kind: 'verify',
      }),
    ).toBe('coding');
  });
});

describe('parseGeneralVerdict', () => {
  it('reads fenced JSON', () => {
    expect(
      parseGeneralVerdict('```json\n{"generalVerdict":"passed","proof":"league.exe exit 0"}\n```'),
    ).toEqual({ generalVerdict: 'passed', proof: 'league.exe exit 0' });
  });

  it('rejects missing, empty, or placeholder proof', () => {
    expect(parseGeneralVerdict('done')).toBeUndefined();
    expect(parseGeneralVerdict('{"generalVerdict":"passed","proof":""}')).toBeUndefined();
    expect(parseGeneralVerdict('{"generalVerdict":"passed","proof":"TBD"}')).toBeUndefined();
  });
});

describe('JobCreate taskTrack routing', () => {
  it('stamps general on install / OS / app-launch jobs (A–C)', async () => {
    const store = memoryStore();
    for (const title of ['클로드코드 설치해줘', '운영체제 설정 수정해줘', '롤 켜줘'] as const) {
      const result = await createViaTool(store, {
        title,
        prompt: title,
        success_criteria: [`${title} 확인`],
        staff: false,
      });
      expect(result.isError, title).toBe(false);
    }
    const tracks = listJobs(store).map((job) => job.taskTrack);
    expect(tracks).toEqual(['general', 'general', 'general']);
  });

  it('keeps coding gates for a repo bugfix (D)', async () => {
    const store = memoryStore();
    const result = await createViaTool(store, {
      title: 'packages/agent-core auth 토큰 갱신 레이스 고쳐줘',
      prompt: 'packages/agent-core auth 토큰 갱신 레이스 고쳐줘',
      success_criteria: ['focused auth refresh test passes'],
      staff: false,
    });
    expect(result.isError).toBe(false);
    const job = listJobs(store)[0]!;
    expect(job.taskTrack).toBe('coding');
    expect(job.tddMode).toBe('preferred');
  });

  it('does not pin a session track across sequential jobs (C then D)', async () => {
    const store = memoryStore();
    await createViaTool(store, {
      title: '롤 켜줘',
      prompt: '롤 켜줘',
      success_criteria: ['롤 클라이언트가 포그라운드'],
      staff: false,
    });
    await createViaTool(store, {
      title: 'packages/agent-core auth 토큰 갱신 레이스 고쳐줘',
      prompt: 'packages/agent-core auth 토큰 갱신 레이스 고쳐줘',
      success_criteria: ['focused auth refresh test passes'],
      staff: false,
    });
    expect(listJobs(store).map((job) => job.taskTrack)).toEqual(['general', 'coding']);
  });

  it('classifies each intent on its own prompt (E)', () => {
    // Splitter may keep a single compound line; classification is still per-text.
    const intents = [
      ...splitUserMessageIntoJobIntents('롤 켜줘 그리고 packages/oauth 버그 고쳐줘'),
      { title: '롤 켜줘', prompt: '롤 켜줘' },
      { title: 'packages/oauth 버그 고쳐줘', prompt: 'packages/oauth 버그 고쳐줘' },
    ];
    const tracks = intents.map((intent) =>
      classifyJobTaskTrack({ title: intent.title, prompt: intent.prompt }),
    );
    expect(tracks).toContain('general');
    expect(tracks).toContain('coding');
  });

  it('honors hidden task_track on JobCreate', async () => {
    const store = memoryStore();
    const result = await createViaTool(store, {
      title: '롤 켜줘',
      prompt: '롤 켜줘',
      success_criteria: ['앱이 포그라운드'],
      task_track: 'coding',
      staff: false,
    });
    expect(result.isError).toBe(false);
    expect(listJobs(store)[0]?.taskTrack).toBe('coding');
  });
});

describe('general taskTrack runtime gates', () => {
  it('skips worktree, verify enqueue, merge chain, and coding brief taxes', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: '클로드코드 설치해줘',
      prompt: '클로드코드 설치해줘',
      kind: 'task',
      successCriteria: ['claude --version exits 0'],
    });
    expect(job.taskTrack).toBe('general');
    expect(job.tddMode).toBe('off');
    expect(job.surfaceKind).toBe('none');

    const created: string[] = [];
    const scheduled = await scheduleQueuedJobs({
      store,
      kaos: {} as never,
      repoPath: '/repo',
      createWorktree: countingWorktreeFactory(created) as never,
      ensureGitRepo: false,
    });
    expect(scheduled.started).toHaveLength(1);
    expect(created).toEqual([]);
    expect(getJob(store, job.id)?.worktreePath).toBeUndefined();

    const done = patchJob(store, job.id, { status: 'done' })!;
    expect(shouldEnqueueVerifyAfterDone(done)).toBe(false);
    expect(evaluateVerifyChainForMerge({ job: done, jobs: listJobs(store) }).ok).toBe(true);
    expect(shouldAutoEnqueueMergeAfterVerify(done, listJobs(store))).toBe(false);

    const trust = mergeTrustInputFromLedger({
      job: done,
      claim: { approve: true, summary: 'install done', checksGreen: true },
      jobs: listJobs(store),
    });
    expect(trust.reviewChainBlocked).toBe(false);
    expect(trust.surfaceKindMissing).toBe(false);

    const prompt = jobPrompt(done);
    expect(prompt).toMatch(/generalVerdict/);
    expect(prompt).toMatch(/Worker contract \(general track\)/);
    // Coding-track commit obligation must not appear as a required step.
    expect(prompt).not.toMatch(/git add -A && git commit/);
    // Negative "do not … pnpm run gate" is allowed; positive gate brief is not.
    expect(prompt).not.toMatch(/Before opening a PR: run .*changeset/i);
  });

  it('keeps coding worktree + verify for a repo bugfix', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'packages/agent-core auth 토큰 갱신 레이스 고쳐줘',
      prompt: 'packages/agent-core auth 토큰 갱신 레이스 고쳐줘',
      kind: 'implement',
      successCriteria: ['focused auth refresh test passes'],
    });
    expect(job.taskTrack).toBe('coding');

    const created: string[] = [];
    await scheduleQueuedJobs({
      store,
      kaos: {} as never,
      repoPath: '/repo',
      createWorktree: countingWorktreeFactory(created) as never,
      ensureGitRepo: false,
    });
    expect(created).toHaveLength(1);
    expect(getJob(store, job.id)?.worktreePath).toBeDefined();

    const done = patchJob(store, job.id, { status: 'done' })!;
    expect(shouldEnqueueVerifyAfterDone(done)).toBe(true);
    expect(evaluateVerifyChainForMerge({ job: done, jobs: listJobs(store) }).ok).toBe(false);

    const prompt = jobPrompt({ ...done, worktreePath: '/tmp/wt/job' });
    expect(prompt).toMatch(/git add -A && git commit/);
  });

  it('still blocks secrets on the general track', () => {
    expect(isSensitiveFile('/home/user/.ssh/id_rsa')).toBe(true);
    expect(isSensitiveFile('/repo/.env')).toBe(true);
  });

  it('classifies guard drafts the same way', () => {
    const store = memoryStore();
    const record = createConductorJobDraftRecorder(store);
    const install = record({
      draft: { title: '클로드코드 설치해줘', prompt: '클로드코드 설치해줘', ownership: 'host' },
      code: 'CONDUCTOR_BASH_WRITE_BLOCKED',
      toolName: 'Bash',
    });
    const write = record({
      draft: {
        title: 'patch auth',
        prompt: 'packages/agent-core auth race',
        ownership: 'packages/agent-core',
      },
      code: 'CONDUCTOR_DIRECT_WORK_BLOCKED',
      toolName: 'Edit',
    });
    expect(getJob(store, install.jobId)?.taskTrack).toBe('general');
    expect(getJob(store, write.jobId)?.taskTrack).toBe('coding');
  });
});

/**
 * Per-Job taskTrack: structural/declared contract + general gate skips.
 * Prompt wording must not select the track.
 */

import { describe, expect, it } from 'vitest';

import { isSensitiveFile } from '../../src/tools/policies/sensitive';
import { createJob, getJob, listJobs, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { scheduleQueuedJobs } from '../../src/tools/builtin/job/job-runtime';
import {
  classifyJobTaskTrack,
  classifyJobTrack,
  parseGeneralVerdict,
  resolveJobTaskTrack,
} from '../../src/tools/builtin/job/job-task-track';
import {
  inferJobTaskTrack,
  resolveJobTaskTrackWithInfer,
} from '../../src/tools/builtin/job/job-task-track-infer';
import {
  JobCreateTool,
  createConductorJobDraftRecorder,
  renderJobInspect,
} from '../../src/tools/builtin/job/job-tools';
import { jobPrompt } from '../../src/tools/builtin/job/job-worker';
import {
  evaluateVerifyChainForMerge,
  shouldAutoEnqueueMergeAfterVerify,
  shouldEnqueueVerifyAfterDone,
} from '../../src/tools/builtin/job/job-verify-chain';
import { mergeTrustInputFromLedger } from '../../src/tools/builtin/job/job-merge-trust';
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
  agent?: ConstructorParameters<typeof JobCreateTool>[1],
): Promise<{ isError: boolean; output?: string }> {
  const tool = new JobCreateTool(store, agent);
  const exec = tool.resolveExecution(args);
  if (exec.isError) return { isError: true, output: String(exec.output) };
  const result = await exec.execute({
    turnId: 't',
    toolCallId: 'c',
    signal: new AbortController().signal,
  });
  return { isError: Boolean(result.isError), output: String(result.output ?? '') };
}

function fakeJudgeAgent(payload: string) {
  return {
    generate: async () => ({
      message: { content: [{ type: 'text' as const, text: payload }] },
    }),
    config: { hasProvider: true, provider: {} },
  } as ConstructorParameters<typeof JobCreateTool>[1];
}

const HOST_EFFECT_JSON =
  '{"mutates_workspace":false,"needs_git_isolation":false,"proof_kind":"host_observable","confidence":0.91,"rationale":"host app should be running"}';
const REPO_EFFECT_JSON =
  '{"mutates_workspace":true,"needs_git_isolation":true,"proof_kind":"repo_change","confidence":0.93,"rationale":"fix a race in the workspace"}';

describe('resolveJobTaskTrack / classifyJobTaskTrack', () => {
  it('does not classify from prompt wording', () => {
    for (const text of [
      '클로드코드 설치해줘',
      '운영체제 설정 수정해줘',
      '롤 켜줘',
      'packages/agent-core auth 토큰 갱신 레이스 고쳐줘',
      '이 레포에 prettier 설치하고 lint 고쳐줘',
      '이거 해줘',
    ]) {
      expect(resolveJobTaskTrack({ title: text, prompt: text })).toEqual({ source: 'pending' });
      expect(classifyJobTaskTrack({ title: text, prompt: text })).toBe('coding');
      expect(classifyJobTrack({ title: text, prompt: text })).toBe('coding');
    }
  });

  it('honors declared and inherited contracts', () => {
    expect(
      resolveJobTaskTrack({
        title: 'anything',
        prompt: 'anything',
        explicit: 'general',
      }),
    ).toEqual({ source: 'declared', track: 'general' });
    expect(
      resolveJobTaskTrack({
        title: 'anything',
        prompt: 'anything',
        inherited: 'general',
      }),
    ).toEqual({ source: 'inherited', track: 'general' });
    expect(
      classifyJobTaskTrack({
        title: '롤 켜줘',
        prompt: '롤 켜줘',
        explicit: 'coding',
      }),
    ).toBe('coding');
  });

  it('forces coding from harness events, not wording', () => {
    expect(
      resolveJobTaskTrack({
        title: '클로드코드 설치해줘',
        prompt: '클로드코드 설치해줘',
        toolName: 'Edit',
      }),
    ).toEqual({ source: 'structural', track: 'coding' });
    expect(
      resolveJobTaskTrack({
        title: 'patch auth',
        prompt: 'auth race',
        ownershipPaths: ['packages/agent-core'],
      }),
    ).toEqual({ source: 'structural', track: 'coding' });
  });

  it('forces coding for greenfield, implement, and non-task kinds', () => {
    expect(
      resolveJobTaskTrack({
        title: '클로드코드 설치해줘',
        prompt: '클로드코드 설치해줘',
        deliveryMode: 'greenfield',
      }),
    ).toEqual({ source: 'structural', track: 'coding' });
    expect(
      resolveJobTaskTrack({
        title: '클로드코드 설치해줘',
        prompt: '클로드코드 설치해줘',
        kind: 'implement',
      }),
    ).toEqual({ source: 'structural', track: 'coding' });
    expect(
      resolveJobTaskTrack({
        title: '클로드코드 설치해줘',
        prompt: '클로드코드 설치해줘',
        kind: 'verify',
      }),
    ).toEqual({ source: 'structural', track: 'coding' });
  });
});

describe('LLM effect judgment before schedule', () => {
  it('JobCreate ACKs without waiting for effect judgment', async () => {
    const store = memoryStore();
    let release!: (text: string) => void;
    const hung = new Promise<string>((resolve) => {
      release = resolve;
    });
    const result = await createViaTool(
      store,
      {
        title: '롤 켜줘',
        prompt: '롤 켜줘',
        success_criteria: ['앱이 포그라운드'],
        staff: false,
      },
      {
        generate: async () => ({
          message: { content: [{ type: 'text' as const, text: await hung }] },
        }),
        config: { hasProvider: true, provider: {} },
      } as ConstructorParameters<typeof JobCreateTool>[1],
    );
    expect(result.isError).toBe(false);
    const job = listJobs(store)[0]!;
    expect(job.taskTrackSource).toBe('pending');
    expect(job.taskTrack).toBeUndefined();
    release(HOST_EFFECT_JSON);
    for (let i = 0; i < 40; i++) {
      if (getJob(store, job.id)?.taskTrackSource !== 'pending') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(getJob(store, job.id)?.taskTrack).toBe('general');
    expect(getJob(store, job.id)?.taskTrackSource).toBe('inferred');
  });

  it('stamps general from a host-effect judgment, not from keywords', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: '클로드코드 설치해줘',
      prompt: '클로드코드 설치해줘',
      kind: 'task',
      successCriteria: ['claude --version exits 0'],
    });
    expect(job.taskTrackSource).toBe('pending');
    await scheduleQueuedJobs({
      store,
      agent: fakeJudgeAgent(HOST_EFFECT_JSON) as never,
      requireWorktree: false,
      ensureGitRepo: false,
    });
    expect(getJob(store, job.id)?.taskTrack).toBe('general');
    expect(getJob(store, job.id)?.taskTrackSource).toBe('inferred');
  });

  it('keeps coding from a repo-effect judgment even when the title looks like an install', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: '이 레포에 prettier 설치하고 lint 고쳐줘',
      prompt: '이 레포에 prettier 설치하고 lint 고쳐줘',
      kind: 'task',
      successCriteria: ['lint passes'],
    });
    await scheduleQueuedJobs({
      store,
      agent: fakeJudgeAgent(REPO_EFFECT_JSON) as never,
      requireWorktree: false,
      ensureGitRepo: false,
    });
    expect(getJob(store, job.id)?.taskTrack).toBe('coding');
    expect(getJob(store, job.id)?.taskTrackSource).toBe('inferred');
  });

  it('fails closed to coding without a classifier', async () => {
    const store = memoryStore();
    const queued = createJob(store, {
      title: '롤 켜줘',
      prompt: '롤 켜줘',
      kind: 'task',
      successCriteria: ['앱이 포그라운드'],
    });
    expect(queued.taskTrackSource).toBe('pending');
    expect(queued.taskTrack).toBeUndefined();

    await scheduleQueuedJobs({
      store,
      requireWorktree: false,
      ensureGitRepo: false,
    });
    expect(getJob(store, queued.id)?.taskTrackSource).toBe('default');
    expect(getJob(store, queued.id)?.taskTrack).toBe('coding');
  });

  it('honors declared task_track on JobCreate', async () => {
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
    expect(listJobs(store)[0]?.taskTrackSource).toBe('declared');
    expect(result.output).toContain('effect:');
    expect(result.output).toMatch(/you set|from the contract|coding/);
    const inspect = renderJobInspect(listJobs(store)[0]!);
    expect(inspect).toContain('effect:');
    expect(inspect).toContain('task_track: coding');
    expect(inspect).toContain('task_track_source: declared');
    expect(inspect).toContain('isolation:');
  });

  it('judges each brief on its own done-contract', async () => {
    const host = await resolveJobTaskTrackWithInfer(
      {
        title: '롤 켜줘',
        prompt: '롤 켜줘',
        successCriteria: ['앱이 포그라운드'],
      },
      {
        generate: async () => ({
          message: { content: [{ type: 'text', text: HOST_EFFECT_JSON }] },
        }),
        provider: {} as never,
      },
    );
    const repo = await resolveJobTaskTrackWithInfer(
      {
        title: 'packages/oauth 버그 고쳐줘',
        prompt: 'packages/oauth 버그 고쳐줘',
        successCriteria: ['focused oauth test passes'],
      },
      {
        generate: async () => ({
          message: { content: [{ type: 'text', text: REPO_EFFECT_JSON }] },
        }),
        provider: {} as never,
      },
    );
    expect(host).toEqual({ source: 'inferred', track: 'general' });
    expect(repo).toEqual({ source: 'inferred', track: 'coding' });
  });
});

describe('inferJobTaskTrack', () => {
  it('returns undefined when generate throws', async () => {
    await expect(
      inferJobTaskTrack(
        {
          generate: async () => {
            throw new Error('offline');
          },
          provider: {} as never,
        },
        { title: 'x', prompt: 'x' },
      ),
    ).resolves.toBeUndefined();
  });

  it('sends the done-contract to the model, not a keyword cookbook', async () => {
    let user = '';
    await inferJobTaskTrack(
      {
        generate: async (_provider, system, _history, messages) => {
          expect(String(system)).not.toMatch(/설치해줘|켜줘|install|launch/i);
          const part = messages[0]?.content[0];
          user = part?.type === 'text' ? part.text : '';
          return { message: { content: [{ type: 'text', text: HOST_EFFECT_JSON }] } };
        },
        provider: {} as never,
      },
      {
        title: '클로드코드 설치해줘',
        prompt: '클로드코드 설치해줘',
        successCriteria: ['claude --version exits 0'],
        verificationCommands: ['claude --version'],
        surfaceKind: 'none',
      },
    );
    expect(user).toMatch(/success_criteria/);
    expect(user).toMatch(/claude --version exits 0/);
    expect(user).toMatch(/verification_commands/);
    expect(user).toMatch(/done-contract/);
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

describe('general taskTrack runtime gates', () => {
  it('skips worktree, verify enqueue, merge chain, and coding brief taxes', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: '클로드코드 설치해줘',
      prompt: '클로드코드 설치해줘',
      kind: 'task',
      successCriteria: ['claude --version exits 0'],
      taskTrack: 'general',
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
    expect(prompt).not.toMatch(/git add -A && git commit/);
    expect(prompt).not.toMatch(/Before opening a PR: run .*changeset/i);
  });

  it('keeps coding worktree + verify for a declared repo bugfix', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'packages/agent-core auth 토큰 갱신 레이스 고쳐줘',
      prompt: 'packages/agent-core auth 토큰 갱신 레이스 고쳐줘',
      kind: 'implement',
      successCriteria: ['focused auth refresh test passes'],
      taskTrack: 'coding',
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

  it('classifies guard drafts from the harness event, not the title', () => {
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
    expect(getJob(store, install.jobId)?.taskTrack).toBe('coding');
    expect(getJob(store, install.jobId)?.taskTrackSource).toBe('structural');
    expect(getJob(store, write.jobId)?.taskTrack).toBe('coding');
    expect(getJob(store, write.jobId)?.taskTrackSource).toBe('structural');
  });
});

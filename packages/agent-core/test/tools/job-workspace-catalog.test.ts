import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import type { ToolStore } from '../../src/tools/store';
import {
  archiveWorkspaceSession,
  classifyWorkspaceShelf,
  findWorkspaceSession,
  jobRecordToWorkspaceEntry,
  listWorkspaceSessions,
  upsertWorkspaceCatalogJobs,
  workspaceEntryToJobRecord,
  workspaceSessionCatalogPath,
} from '../../src/tools/builtin/job/job-workspace-catalog';
import {
  importWorkerHomedir,
} from '../../src/tools/builtin/job/job-workspace-bind';
import {
  jobAdoptWorkspaceSession,
  jobArchiveWorkspaceSession,
  jobChooseLand,
  jobRenameWorkspaceSession,
  jobWorkspaceCatalog,
} from '../../src/tools/builtin/job/job-rpc-api';
import { defaultSessionName, slugifySessionName } from '../../src/tools/builtin/job/job-store-key';

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

describe('workspace session catalog', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function home(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ws-catalog-'));
    dirs.push(dir);
    return dir;
  }

  it('classifies active / recent / archived shelves', () => {
    const now = Date.parse('2026-08-24T12:00:00.000Z');
    const ttl = 7 * 24 * 60 * 60 * 1000;
    expect(
      classifyWorkspaceShelf(
        {
          status: 'running',
          updatedAt: '2026-08-24T11:00:00.000Z',
          worktreePath: '/wt',
        },
        now,
        ttl,
      ),
    ).toBe('active');
    expect(
      classifyWorkspaceShelf(
        {
          status: 'done',
          updatedAt: '2026-08-23T12:00:00.000Z',
          worktreePath: '/wt',
        },
        now,
        ttl,
      ),
    ).toBe('recent');
    expect(
      classifyWorkspaceShelf(
        {
          status: 'done',
          updatedAt: '2026-08-23T12:00:00.000Z',
          worktreePath: '/wt',
          landReceipt: { mergeSha: 'abc', branch: 'liora/x', verifiedAt: '2026-08-23T13:00:00.000Z' },
        },
        now,
        ttl,
      ),
    ).toBe('archived');
    expect(
      classifyWorkspaceShelf(
        {
          status: 'failed',
          updatedAt: '2026-07-01T12:00:00.000Z',
          worktreePath: '/wt',
        },
        now,
        ttl,
      ),
    ).toBe('archived');
  });

  it('upserts jobs so a second chat can list them', () => {
    const homeDir = home();
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Fix login',
      kind: 'implement',
      worktreePath: '/tmp/wt-login',
    });
    patchJob(store, job.id, { status: 'interrupted' });
    upsertWorkspaceCatalogJobs({
      workDir: '/repo',
      homeDir,
      sourceAgentDir: '/sessions/old',
      jobs: [getRequired(store, job.id)],
    });
    const listed = listWorkspaceSessions({ workDir: '/repo', homeDir });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.jobId).toBe(job.id);
    expect(listed[0]!.shelf).toBe('active');
    expect(listed[0]!.sourceAgentDir).toBe('/sessions/old');
    expect(workspaceSessionCatalogPath('/repo', homeDir)).toContain('workspace-sessions');
  });

  it('adopts a catalog job onto an empty ledger', async () => {
    const homeDir = home();
    const source = memoryStore();
    const job = createJob(source, {
      title: 'Fix login',
      kind: 'implement',
      worktreePath: '/tmp/wt-login',
      workerResumeAgentId: 'agent_old',
    });
    patchJob(source, job.id, { status: 'interrupted' });
    upsertWorkspaceCatalogJobs({
      workDir: '/repo',
      homeDir,
      jobs: [getRequired(source, job.id)],
    });

    const target = memoryStore();
    const result = await jobAdoptWorkspaceSession(target, {
      jobId: job.id,
      workDir: '/repo',
      homeDir,
    });
    expect(result.ok).toBe(true);
    expect(result.adopted).toBe(true);
    expect(result.job?.id).toBe(job.id);
    expect(target.get('job_ledger')?.jobs).toHaveLength(1);
    expect(target.get('job_ledger')?.jobs[0]?.workerResumeAgentId).toBe('agent_old');
  });

  it('archives a session so it is not resumed', () => {
    const homeDir = home();
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Old work',
      kind: 'implement',
      worktreePath: '/tmp/wt-old',
    });
    upsertWorkspaceCatalogJobs({
      workDir: '/repo',
      homeDir,
      jobs: [getRequired(store, job.id)],
    });
    const archived = archiveWorkspaceSession({
      workDir: '/repo',
      jobId: job.id,
      homeDir,
    });
    expect(archived?.archivedAt).toBeDefined();
    const catalog = jobWorkspaceCatalog(store, { workDir: '/repo', homeDir });
    expect(catalog.rows[0]?.shelf).toBe('archived');
    const action = jobArchiveWorkspaceSession(store, {
      jobId: job.id,
      workDir: '/repo',
      homeDir,
    });
    expect(action.ok).toBe(true);
  });

  it('maps a running foreign job to interrupted on import', () => {
    const entry = jobRecordToWorkspaceEntry(
      {
        id: 'job_x',
        title: 'Live',
        status: 'running',
        kind: 'implement',
        priority: 0,
        createdAt: '2026-08-24T00:00:00.000Z',
        updatedAt: '2026-08-24T00:00:00.000Z',
      },
      { workDir: '/repo', sourceAgentDir: '/s' },
    );
    const imported = workspaceEntryToJobRecord(entry);
    expect(imported.status).toBe('interrupted');
    expect(imported.id).toBe('job_x');
  });

  it('assigns a resume handle and finds the session by name', () => {
    expect(slugifySessionName('Fix Login Flow')).toBe('fix-login-flow');
    expect(defaultSessionName('Fix Login', 'job_abcxyz7f3a')).toBe('fix-login-7f3a');
    const homeDir = home();
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Fix login',
      kind: 'implement',
      worktreePath: '/tmp/wt-login',
    });
    expect(job.sessionName).toMatch(/^fix-login-/);
    upsertWorkspaceCatalogJobs({
      workDir: '/repo',
      homeDir,
      jobs: [getRequired(store, job.id)],
    });
    const byName = findWorkspaceSession('/repo', job.sessionName ?? '', homeDir);
    expect(byName?.jobId).toBe(job.id);
    const renamed = jobRenameWorkspaceSession(store, {
      jobId: job.id,
      name: 'auth-refactor',
      workDir: '/repo',
      homeDir,
    });
    expect(renamed.ok).toBe(true);
    upsertWorkspaceCatalogJobs({
      workDir: '/repo',
      homeDir,
      jobs: [getRequired(store, job.id)],
    });
    expect(findWorkspaceSession('/repo', 'auth-refactor', homeDir)?.jobId).toBe(job.id);
  });

  it('adopts by session name', async () => {
    const homeDir = home();
    const source = memoryStore();
    const job = createJob(source, {
      title: 'Fix login',
      kind: 'implement',
      worktreePath: '/tmp/wt-login',
      sessionName: 'auth-refactor',
      sessionNamePinned: true,
    });
    patchJob(source, job.id, { status: 'interrupted' });
    upsertWorkspaceCatalogJobs({
      workDir: '/repo',
      homeDir,
      jobs: [getRequired(source, job.id)],
    });
    const target = memoryStore();
    const result = await jobAdoptWorkspaceSession(target, {
      jobId: 'auth-refactor',
      workDir: '/repo',
      homeDir,
    });
    expect(result.ok).toBe(true);
    expect(result.job?.id).toBe(job.id);
    expect(result.job?.sessionName).toBe('auth-refactor');
  });

  it('Keep leaves the worktree and skips archive-by-ttl', async () => {
    const store = memoryStore();
    const job = createJob(store, {
      title: 'Keep me',
      kind: 'implement',
      worktreePath: '/tmp/wt-keep',
    });
    patchJob(store, job.id, { status: 'done', landChoice: 'pending' });
    const kept = await jobChooseLand(store, { jobId: job.id, choice: 'keep' });
    expect(kept.ok).toBe(true);
    expect(getRequired(store, job.id).landChoice).toBe('keep');
    expect(getRequired(store, job.id).worktreePath).toBe('/tmp/wt-keep');
    expect(
      classifyWorkspaceShelf(
        {
          status: 'done',
          updatedAt: '2020-01-01T00:00:00.000Z',
          worktreePath: '/tmp/wt-keep',
          landChoice: 'keep',
        },
        Date.parse('2026-08-24T12:00:00.000Z'),
        7 * 24 * 60 * 60 * 1000,
      ),
    ).toBe('recent');
  });

  it('copies a worker homedir into another session', () => {
    const root = home();
    const source = join(root, 'old', 'agents', 'agent-1');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'wire.jsonl'), '{"ok":true}\n');
    const destSession = join(root, 'new-session');
    const imported = importWorkerHomedir({
      sessionHomedir: destSession,
      workerId: 'agent-1',
      sourceHomedir: source,
    });
    expect(imported.ok).toBe(true);
    expect(imported.copied).toBe(true);
    expect(existsSync(join(destSession, 'agents', 'agent-1', 'wire.jsonl'))).toBe(true);
    expect(readFileSync(join(destSession, 'agents', 'agent-1', 'wire.jsonl'), 'utf8')).toContain(
      '"ok":true',
    );
  });
});

function getRequired(store: ToolStore, id: string) {
  const job = store.get('job_ledger')?.jobs.find((j) => j.id === id);
  if (job === undefined) throw new Error(`missing ${id}`);
  return job;
}

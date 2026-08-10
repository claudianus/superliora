/**
 * P1-5 — a `done` job whose checks never ran says so.
 *
 * The completion gate only sets `verification_failed` on an actual failure, so
 * a job that skipped verification entirely used to be indistinguishable from a
 * fully green one. It stays `done` (the work happened), but the ACK, the desk
 * line, and the merge trust rules all read it as unverified.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { renderJobDeskInjection } from '../../src/agent/injection/job-desk';
import type { Agent } from '../../src/agent';
import {
  buildSubagentResultContract,
  UNVERIFIED_SUMMARY_PREFIX,
  verificationIsUnverified,
  type SubagentVerificationStatus,
} from '../../src/session/subagent/subagent-result-contract';
import { __resetJobWorkerHandlesForTests } from '../../src/tools/builtin/job/job-handles';
import { listUnreadJobInbox } from '../../src/tools/builtin/job/job-inbox';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import { summarizeJobStrip } from '../../src/tools/builtin/job/job-runtime';
import { launchJobWorker } from '../../src/tools/builtin/job/job-worker';
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

const fakeAgent = {
  type: 'main',
  subagentHost: { spawn: async () => ({}) },
  turn: { hasActiveTurn: true, prompt: () => null },
} as unknown as Agent;

/** Run a worker to completion with the given verification verdicts. */
async function completeWorkerWith(
  store: ToolStore,
  verification: SubagentVerificationStatus | undefined,
): Promise<void> {
  const job = createJob(store, { title: 'ship the fix', kind: 'implement' });
  const running = patchJob(store, job.id, { status: 'running' });
  if (!running) throw new Error('failed to promote job');
  await launchJobWorker({
    store,
    agent: fakeAgent,
    job: running,
    spawnOne: (async () => ({
      agentId: 'agent_1',
      profileName: 'coder',
      resumed: false,
      completion: Promise.resolve({
        result: 'applied the patch',
        ...(verification === undefined
          ? {}
          : {
              contract: buildSubagentResultContract({
                agentId: 'agent_1',
                profile: 'coder',
                summary: 'applied the patch',
                filesChanged: ['src/fix.ts'],
                verification,
              }),
            }),
      }),
    })) as never,
  });
  await until(() => getJob(store, job.id)?.status === 'done');
}

async function until(predicate: () => boolean, attempts = 40, gapMs = 5): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
  throw new Error('worker completion did not settle in time');
}

afterEach(() => {
  __resetJobWorkerHandlesForTests();
});

describe('verificationIsUnverified', () => {
  it('separates "never ran" from green and from failed', () => {
    expect(verificationIsUnverified({ tests: 'passed', typecheck: 'passed', lint: 'passed' })).toBe(
      false,
    );
    expect(verificationIsUnverified({ tests: 'passed', typecheck: 'not_run', lint: 'passed' })).toBe(
      true,
    );
    expect(verificationIsUnverified({ tests: 'failed', typecheck: 'not_run', lint: 'passed' })).toBe(
      false,
    );
    expect(verificationIsUnverified(undefined)).toBe(true);
  });

  it('treats visual=not_run as unverified only when requireVisual (surfaceKind)', () => {
    expect(
      verificationIsUnverified(
        {
          tests: 'passed',
          typecheck: 'passed',
          lint: 'passed',
          visual: 'not_run',
        },
        { requireVisual: true },
      ),
    ).toBe(true);
    expect(
      verificationIsUnverified(
        {
          tests: 'passed',
          typecheck: 'passed',
          lint: 'passed',
          visual: 'passed',
        },
        { requireVisual: true },
      ),
    ).toBe(false);
    // Path arrays no longer invent requireVisual.
    expect(
      verificationIsUnverified(
        {
          tests: 'passed',
          typecheck: 'passed',
          lint: 'passed',
          visual: 'not_run',
        },
        ['apps/site/src/app/page.tsx'],
      ),
    ).toBe(false);
  });
});

describe('unverified completions', () => {
  it('stays done but labels the summary and the inbox notice', async () => {
    const store = memoryStore();
    await completeWorkerWith(store, { tests: 'passed', typecheck: 'not_run', lint: 'not_run' });

    const job = getJob(store, createdIdIn(store));
    expect(job?.status).toBe('done');
    expect(job?.resultSummary).toContain(UNVERIFIED_SUMMARY_PREFIX);
    expect(job?.notes).toContain('unverified');
    expect(listUnreadJobInbox(store)[0]?.summary).toContain(UNVERIFIED_SUMMARY_PREFIX);
  });

  it('leaves a fully green completion unmarked', async () => {
    const store = memoryStore();
    await completeWorkerWith(store, { tests: 'passed', typecheck: 'passed', lint: 'passed' });

    const job = getJob(store, createdIdIn(store));
    expect(job?.status).toBe('done');
    expect(job?.resultSummary).toBe('applied the patch');
  });

  it('routes the desk to a verify job instead of a merge', async () => {
    const store = memoryStore();
    await completeWorkerWith(store, undefined);
    const text = renderJobDeskInjection(listUnreadJobInbox(store), summarizeJobStrip(store));
    expect(text).toContain('no checks run');
    expect(text).toContain('delegate a verify Job');
  });
});

function createdIdIn(store: ToolStore): string {
  const ledger = store.get('job_ledger') as { jobs: readonly { id: string }[] } | undefined;
  const id = ledger?.jobs[0]?.id;
  if (id === undefined) throw new Error('no job on the ledger');
  return id;
}

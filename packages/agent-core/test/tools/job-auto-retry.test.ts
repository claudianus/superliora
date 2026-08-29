/**
 * `maybeAutoRetryFailedWorker` — bounded automatic retry of crashed /
 * failed-to-spawn workers. The scheduler pump is mocked so tests observe the
 * backoff trigger without spawning anything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/session/job/job-offload', () => ({
  requestJobSchedulePump: vi.fn(),
}));

import { requestJobSchedulePump } from '../../src/session/job/job-offload';
import {
  JOB_AUTO_RETRY_BACKOFF_MS,
  JOB_AUTO_RETRY_LIMIT,
  maybeAutoRetryFailedWorker,
} from '../../src/tools/builtin/job/job-worker';
import {
  createJob,
  emptyJobLedger,
  getJob,
  patchJob,
  writeJobLedger,
} from '../../src/tools/builtin/job/job-ledger';
import type { ToolStore } from '../../src/tools/store';

const pumpMock = vi.mocked(requestJobSchedulePump);

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

describe('maybeAutoRetryFailedWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    pumpMock.mockReset();
  });

  function failedJob(store: ToolStore, overrides: { autoRetryCount?: number } = {}) {
    writeJobLedger(store, emptyJobLedger());
    const job = createJob(store, { title: 'fix race in queue', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'failed',
      resultSummary: 'worker crashed',
      ...(overrides.autoRetryCount !== undefined ? { autoRetryCount: overrides.autoRetryCount } : {}),
    });
    return getJob(store, job.id)!;
  }

  it('requeues a crashed worker, records the attempt, and pumps after backoff', async () => {
    const store = memoryStore();
    const job = failedJob(store);

    const attempt = maybeAutoRetryFailedWorker({
      store,
      job,
      detail: 'Error: worker crashed mid-turn',
      extraNote: 'snapshot: committed dirty worktree',
    });

    expect(attempt).toBe(1);
    const updated = getJob(store, job.id)!;
    expect(updated.status).toBe('queued');
    expect(updated.autoRetryCount).toBe(1);
    expect(updated.resultSummary).toContain('auto-retry 1/2');
    expect(updated.notes).toContain('auto_retry 1/2: Error: worker crashed mid-turn');
    expect(updated.notes).toContain('snapshot: committed dirty worktree');
    // Wall-clock deadline budget is preserved across retries.
    expect(updated.workerDeadlineStartedAt).toBe(job.workerDeadlineStartedAt);

    expect(pumpMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(JOB_AUTO_RETRY_BACKOFF_MS[0]!);
    expect(pumpMock).toHaveBeenCalledTimes(1);
  });

  it('increments the attempt across retries and uses the later backoff', async () => {
    const store = memoryStore();
    const job = failedJob(store, { autoRetryCount: 1 });

    const attempt = maybeAutoRetryFailedWorker({
      store,
      job,
      detail: 'spawn_failed: transient',
    });

    expect(attempt).toBe(2);
    expect(getJob(store, job.id)!.autoRetryCount).toBe(2);
    expect(pumpMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(JOB_AUTO_RETRY_BACKOFF_MS[0]!);
    expect(pumpMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(JOB_AUTO_RETRY_BACKOFF_MS[1]! - JOB_AUTO_RETRY_BACKOFF_MS[0]!);
    expect(pumpMock).toHaveBeenCalledTimes(1);
  });

  it('returns undefined once the retry budget is exhausted', () => {
    const store = memoryStore();
    const job = failedJob(store, { autoRetryCount: JOB_AUTO_RETRY_LIMIT });

    const attempt = maybeAutoRetryFailedWorker({
      store,
      job,
      detail: 'Error: still crashing',
    });

    expect(attempt).toBeUndefined();
    expect(getJob(store, job.id)!.status).toBe('failed');
    expect(getJob(store, job.id)!.autoRetryCount).toBe(JOB_AUTO_RETRY_LIMIT);
    expect(pumpMock).not.toHaveBeenCalled();
  });
});

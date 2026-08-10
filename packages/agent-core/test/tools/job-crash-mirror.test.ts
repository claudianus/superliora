import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  bindJobLedgerCrashMirror,
  flushJobLedgerCrashMirrorNow,
  mergeCrashMirrorIntoStore,
  readCrashMirrorFile,
  unbindJobLedgerCrashMirror,
} from '../../src/tools/builtin/job/job-crash-mirror';
import { createJob, getJob, patchJob, writeJobLedger } from '../../src/tools/builtin/job/job-ledger';
import type { ToolStore } from '../../src/tools/store';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get: (key) => data[key] as never,
    set: (key, value) => {
      data[key] = value;
    },
  };
}

describe('job ledger crash mirror', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a durable mirror and merges fresher jobs on resume', () => {
    const dir = mkdtempSync(join(tmpdir(), 'job-crash-mirror-'));
    dirs.push(dir);
    const store = memoryStore();
    bindJobLedgerCrashMirror(store, dir);

    const job = createJob(store, { title: 'implement auth', kind: 'implement' });
    patchJob(store, job.id, { status: 'running' });
    flushJobLedgerCrashMirrorNow(store);

    const mirror = readCrashMirrorFile(dir);
    expect(mirror?.ledger.jobs).toHaveLength(1);
    expect(mirror?.ledger.jobs[0]?.status).toBe('running');

    // Simulate wire replay that lost the last status patch (still queued).
    writeJobLedger(store, {
      schemaVersion: 1,
      jobs: [{ ...job, status: 'queued', updatedAt: '2000-01-01T00:00:00.000Z' }],
    });
    expect(mergeCrashMirrorIntoStore(store, dir)).toBe(true);
    expect(getJob(store, job.id)?.status).toBe('running');

    unbindJobLedgerCrashMirror(store);
  });
});

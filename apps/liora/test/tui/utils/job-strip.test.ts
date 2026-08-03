import { describe, expect, it } from 'vitest';

import {
  emptyConductorJobsSnapshot,
  mergeConductorJobsSnapshot,
  parseJobStripFromToolOutput,
} from '#/tui/utils/job/job-strip';
import { labelConductorJobs } from '#/tui/components/chrome/footer/footer-labels';

describe('job-strip', () => {
  it('parses formatJobStripLine style output', () => {
    const snap = parseJobStripFromToolOutput('Jobs: 2▸ 1… inbox 3\nJob inbox empty.');
    expect(snap).toMatchObject({
      running: 2,
      queued: 1,
      unreadInbox: 3,
    });
  });

  it('parses JobList ledger lines', () => {
    const out = [
      'Job ledger:',
      '- job_abc [running] (task p1) one',
      '- job_def [queued] (task p0) two',
      '- job_ghi [interrupted] (implement p2) three',
    ].join('\n');
    const snap = parseJobStripFromToolOutput(out);
    expect(snap).toMatchObject({
      total: 3,
      running: 1,
      queued: 1,
      interrupted: 1,
    });
  });

  it('merges patches and labels', () => {
    const merged = mergeConductorJobsSnapshot(emptyConductorJobsSnapshot(), {
      running: 1,
      queued: 2,
      unreadInbox: 1,
      total: 3,
    });
    expect(labelConductorJobs('plain', merged)).toMatch(/Jobs/);
    expect(labelConductorJobs('compact', merged)).toMatch(/jobs:/);
  });
});

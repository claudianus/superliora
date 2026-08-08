import { describe, expect, it } from 'vitest';

import { jobPrompt } from '../../src/tools/builtin/job/job-worker';
import type { JobRecord } from '../../src/tools/builtin/job/job-store-key';

function job(partial: Partial<JobRecord>): JobRecord {
  return {
    id: 'job_1',
    title: partial.title ?? 'Job',
    status: 'running',
    kind: 'task',
    priority: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as JobRecord;
}

describe('jobPrompt visual DoD', () => {
  it('adds visual DoD bullets for UI jobs', () => {
    const text = jobPrompt(
      job({
        title: 'Landing hero',
        prompt: 'Rebuild the marketing landing hero with premium craft',
      }),
    );
    expect(text).toContain('Visual DoD');
    expect(text).toContain('premium-visual');
    expect(text).toContain('VerifySurface');
    expect(text).toContain('BrowserScreenshot alone does not set visual=passed');
    expect(text).toContain('do not BrowserAct-explore or reinstall loops');
  });

  it('omits visual DoD for non-UI jobs', () => {
    const text = jobPrompt(
      job({
        title: 'CLI fix',
        prompt: 'Fix argv parsing in the CLI',
      }),
    );
    expect(text).not.toContain('Visual DoD');
  });
});

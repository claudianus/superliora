import { describe, expect, it } from 'vitest';

import { shortJobIdForCopy } from '#/tui/utils/job/job-id-copy';

describe('job-id-copy', () => {
  it('copies the short job id without job_ prefix', () => {
    expect(shortJobIdForCopy('job_abcdef012345')).toBe('abcdef01');
    expect(shortJobIdForCopy('short')).toBe('short');
  });
});

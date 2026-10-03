import { describe, expect, it } from 'vitest';

import {
  jobDeckHintNotice,
  shouldShowJobDeckHint,
} from '#/tui/utils/job/job-deck-hint';

describe('job-deck-hint', () => {
  it('shows once when the hint is unseen and a job is running', () => {
    expect(
      shouldShowJobDeckHint({
        jobDeckHintSeen: false,
        runningJobs: 1,
      }),
    ).toBe(true);
  });

  it('skips when the hint was seen or no jobs are running', () => {
    expect(
      shouldShowJobDeckHint({
        jobDeckHintSeen: true,
        runningJobs: 2,
      }),
    ).toBe(false);
    expect(
      shouldShowJobDeckHint({
        jobDeckHintSeen: false,
        runningJobs: 0,
      }),
    ).toBe(false);
  });

  it('mentions Alt+J in the notice', () => {
    const notice = jobDeckHintNotice();
    expect(notice.detail).toMatch(/Alt\+J/i);
  });
});

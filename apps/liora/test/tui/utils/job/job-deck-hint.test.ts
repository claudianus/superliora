import { describe, expect, it } from 'vitest';

import {
  jobDeckHintNotice,
  shouldShowJobDeckHint,
} from '#/tui/utils/job/job-deck-hint';

describe('job-deck-hint', () => {
  it('shows once when v2 is on, hint unseen, and a job is running', () => {
    expect(
      shouldShowJobDeckHint({
        conductorUxV2: true,
        jobDeckHintSeen: false,
        runningJobs: 1,
      }),
    ).toBe(true);
  });

  it('skips when pref already seen or flag off', () => {
    expect(
      shouldShowJobDeckHint({
        conductorUxV2: true,
        jobDeckHintSeen: true,
        runningJobs: 2,
      }),
    ).toBe(false);
    expect(
      shouldShowJobDeckHint({
        conductorUxV2: false,
        jobDeckHintSeen: false,
        runningJobs: 1,
      }),
    ).toBe(false);
    expect(
      shouldShowJobDeckHint({
        conductorUxV2: true,
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

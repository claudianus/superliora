import { describe, expect, it } from 'vitest';

import {
  formatLandResultNotice,
  looksLikeLandInbox,
  shortMergeSha,
} from '#/tui/utils/job/land-result-card';

describe('land-result-card', () => {
  it('detects land via landReceipt or merge summary', () => {
    expect(
      looksLikeLandInbox({
        kind: 'job.completed',
        landReceipt: { mergeSha: 'abc1234567890', merged: true },
      }),
    ).toBe(true);
    expect(
      looksLikeLandInbox({
        kind: 'job.completed',
        summary: 'Merged liora/foo into /repo at abcdef',
      }),
    ).toBe(true);
    expect(looksLikeLandInbox({ kind: 'job.failed', summary: 'Merged' })).toBe(false);
  });

  it('formats success copy with short sha and Diff/push hints', () => {
    const notice = formatLandResultNotice({
      kind: 'job.completed',
      title: 'Land merge',
      landReceipt: { mergeSha: 'abcdef0123456789', merged: true },
      actionHints: ['jobInspect'],
    });
    expect(notice?.title).toBe('Land merge');
    expect(notice?.detail).toContain('Landed on local main — not pushed to remote');
    expect(notice?.detail).toContain(shortMergeSha('abcdef0123456789'));
    expect(notice?.detail).toMatch(/Diff|Inspect|push/i);
  });

  it('appends GC line when landReceipt.gcRemoved', () => {
    const notice = formatLandResultNotice({
      kind: 'job.completed',
      title: 'Land merge',
      landReceipt: { mergeSha: 'abcdef0123456789', merged: true, gcRemoved: true },
    });
    expect(notice?.detail).toContain('GC: worktree removed');
  });

  it('maps hold/reject through trust copy', () => {
    const notice = formatLandResultNotice({
      kind: 'job.blocked',
      title: 'Merge held',
      summary: 'merge: reject — Checks not green',
      jobKind: 'merge',
    });
    expect(notice?.title).toBe('Land held');
    expect(notice?.detail).toContain('Checks are not green');
    expect(notice?.detail).toContain('To fix:');
  });
});

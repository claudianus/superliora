import { describe, expect, it } from 'vitest';

import {
  inferPublishRemoteRef,
  inferPublishRemoteRefFromJobCard,
} from '#/tui/utils/job/push-publish-target';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';

describe('push-publish-target', () => {
  it('infers gh-pages from deploy briefs', () => {
    expect(
      inferPublishRemoteRef('Push: origin/main + gh-pages 배포 및 Pages 활성화'),
    ).toBe('gh-pages');
    expect(inferPublishRemoteRef('remote_ref: docs')).toBe('docs');
    expect(inferPublishRemoteRef('merge to main')).toBeUndefined();
  });

  it('reads job card title and summary', () => {
    const card: ConductorJobCard = {
      id: 'job_1',
      title: 'Ship site',
      status: 'done',
      kind: 'implement',
      priority: 0,
      updatedAtMs: Date.now(),
      resultSummary: 'Built static assets for GitHub Pages',
    };
    expect(inferPublishRemoteRefFromJobCard(card)).toBe('gh-pages');
  });
});

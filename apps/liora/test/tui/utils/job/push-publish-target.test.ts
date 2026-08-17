import { describe, expect, it } from 'vitest';

import {
  describePublishRemoteRef,
  inferPublishRemoteRef,
  inferPublishRemoteRefFromJobCard,
} from '#/tui/utils/job/push-publish-target';
import type { ConductorJobCard } from '#/tui/utils/job/job-strip';

describe('push-publish-target', () => {
  it('reads a structured remote_ref field and ignores wording', () => {
    expect(
      inferPublishRemoteRef('Push: origin/main + gh-pages 배포 및 Pages 활성화'),
    ).toBeUndefined();
    expect(inferPublishRemoteRef('remote_ref: docs')).toBe('docs');
    expect(inferPublishRemoteRef('remote_ref: main')).toBeUndefined();
    expect(inferPublishRemoteRef('merge to main')).toBeUndefined();
  });

  it('does not invent gh-pages from a job card title or summary', () => {
    const card: ConductorJobCard = {
      id: 'job_1',
      title: 'Ship site',
      status: 'done',
      kind: 'implement',
      priority: 0,
      updatedAtMs: Date.now(),
      resultSummary: 'Built static assets for GitHub Pages',
    };
    expect(inferPublishRemoteRefFromJobCard(card)).toBeUndefined();
  });

  it('reads remote_ref from the card brief or summary field', () => {
    const card: ConductorJobCard = {
      id: 'job_2',
      title: 'Ship site',
      status: 'done',
      kind: 'implement',
      priority: 0,
      updatedAtMs: Date.now(),
      resultSummary: 'remote_ref: gh-pages',
    };
    expect(inferPublishRemoteRefFromJobCard(card)).toBe('gh-pages');
  });

  it('labels publish target provenance without inventing a ref', () => {
    expect(describePublishRemoteRef({ fromBrief: true })).toBe('from brief remote_ref');
    expect(describePublishRemoteRef({ fromBrief: false })).toBe(
      'same as local — set remote_ref to publish elsewhere',
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  needsReviewRetry,
  type UltraSwarmReviewResultLike,
} from '../../../../src/tools/builtin/fleet/ultra-swarm-helpers';

function reviewResult(
  overrides: Partial<UltraSwarmReviewResultLike> = {},
): UltraSwarmReviewResultLike {
  return {
    status: 'failed',
    verdict: 'FAIL',
    spec: { expertId: 'expert-1', phase: 'review', requiredForCompletion: true },
    ...overrides,
  };
}

describe('needsReviewRetry', () => {
  it('retries a required review that did not pass', () => {
    expect(needsReviewRetry(reviewResult())).toBe(true);
  });

  it('does not retry when the failure is a permanent provider error', () => {
    // Enriched subagent failures carry the permanent marker; retrying would
    // burn another full review turn just to hit the same auth/billing wall.
    expect(
      needsReviewRetry(
        reviewResult({
          error:
            'Permanent provider failure (provider=anthropic, model=claude): 401 Unauthorized. ' +
            'Retrying cannot fix this — check billing/credentials for this provider.',
        }),
      ),
    ).toBe(false);
    // Raw provider messages are recognized too, without the enrichment marker.
    expect(needsReviewRetry(reviewResult({ error: '403 Forbidden' }))).toBe(false);
    expect(
      needsReviewRetry(reviewResult({ error: 'You exceeded your current quota' })),
    ).toBe(false);
  });

  it('still retries ordinary (non-permanent) review failures', () => {
    expect(needsReviewRetry(reviewResult({ error: '503 Service Unavailable' }))).toBe(true);
    expect(needsReviewRetry(reviewResult({ error: undefined }))).toBe(true);
  });
});

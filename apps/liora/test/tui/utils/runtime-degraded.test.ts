import { describe, expect, it } from 'vitest';

import {
  activeRuntimeDegraded,
  isRuntimeDegradedActive,
  RUNTIME_DEGRADED_BADGE_TTL_MS,
  staleRuntimeDegradedClearPatch,
} from '#/tui/utils/never-halt/runtime-degraded';
import { formatRuntimeDegradedFooterBadge } from '#/tui/components/chrome/footer/footer-badges';

const sample = { scope: 'search', reason: 'paid_channels_cooling', atMs: 1_000 };

describe('runtime-degraded TTL', () => {
  it('is active within TTL and inactive after expiry', () => {
    expect(isRuntimeDegradedActive(sample, 1_000)).toBe(true);
    expect(isRuntimeDegradedActive(sample, 1_000 + RUNTIME_DEGRADED_BADGE_TTL_MS)).toBe(true);
    expect(isRuntimeDegradedActive(sample, 1_000 + RUNTIME_DEGRADED_BADGE_TTL_MS + 1)).toBe(false);
    expect(activeRuntimeDegraded(sample, 1_000 + RUNTIME_DEGRADED_BADGE_TTL_MS + 1)).toBeNull();
  });

  it('clears stale AppState patch only when expired', () => {
    expect(staleRuntimeDegradedClearPatch(null)).toBeNull();
    expect(staleRuntimeDegradedClearPatch(sample, 1_000)).toBeNull();
    expect(staleRuntimeDegradedClearPatch(sample, 1_000 + RUNTIME_DEGRADED_BADGE_TTL_MS + 1)).toEqual({
      runtimeDegraded: null,
    });
  });

  it('footer badge hides when TTL expires', () => {
    expect(formatRuntimeDegradedFooterBadge(sample, 1_000 + RUNTIME_DEGRADED_BADGE_TTL_MS)).not.toBeNull();
    expect(formatRuntimeDegradedFooterBadge(sample, 1_000 + RUNTIME_DEGRADED_BADGE_TTL_MS + 1)).toBeNull();
  });
});

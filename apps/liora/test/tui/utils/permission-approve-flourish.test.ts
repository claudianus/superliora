import { describe, expect, it } from 'vitest';

import {
  formatPermissionApproveFooterBadge,
  PERMISSION_APPROVE_FLOURISH_BADGE_TTL_MS,
  shouldPermissionApproveFlourish,
} from '#/tui/utils/never-halt/permission-approve-flourish';

describe('shouldPermissionApproveFlourish', () => {
  it('pulses on approve once and approve for session', () => {
    expect(shouldPermissionApproveFlourish({ response: 'approved' })).toBe(true);
    expect(shouldPermissionApproveFlourish({ response: 'approved_for_session' })).toBe(true);
  });

  it('skips reject and cancel', () => {
    expect(shouldPermissionApproveFlourish({ response: 'rejected' })).toBe(false);
    expect(shouldPermissionApproveFlourish({ response: 'cancelled' })).toBe(false);
  });
});

describe('formatPermissionApproveFooterBadge', () => {
  const atMs = 3_000_000;

  it('shows perm✓ within TTL', () => {
    expect(
      formatPermissionApproveFooterBadge({ atMs }, atMs + PERMISSION_APPROVE_FLOURISH_BADGE_TTL_MS - 1),
    ).toEqual({ text: 'perm✓', severity: 'info' });
  });

  it('hides at and after TTL', () => {
    expect(
      formatPermissionApproveFooterBadge({ atMs }, atMs + PERMISSION_APPROVE_FLOURISH_BADGE_TTL_MS),
    ).toBeNull();
  });
});

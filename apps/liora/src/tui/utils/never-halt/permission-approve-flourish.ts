import type { ApprovalPanelResponse } from '#/tui/components/dialogs/approval/approval-panel';
import type { FooterBadge } from '#/tui/components/chrome/footer/footer-badges';
import type { AppState } from '#/tui/types';

/** Footer `perm✓` micro-badge lifetime after an explicit approval. */
export const PERMISSION_APPROVE_FLOURISH_BADGE_TTL_MS = 2_000;

/** True when the operator approved once or for the session (not reject/cancel). */
export function shouldPermissionApproveFlourish(response: ApprovalPanelResponse): boolean {
  return response.response === 'approved' || response.response === 'approved_for_session';
}

/** Dopamine Ops footer glance — brief `perm✓` badge after permission approval. */
export function formatPermissionApproveFooterBadge(
  flourish: AppState['permissionApproveFlourish'],
  nowMs: number = Date.now(),
): FooterBadge | null {
  if (flourish === undefined || flourish === null) return null;
  if (nowMs - flourish.atMs >= PERMISSION_APPROVE_FLOURISH_BADGE_TTL_MS) return null;
  return { text: 'perm✓', severity: 'info' };
}

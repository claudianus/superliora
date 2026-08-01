import type { ApprovalPanelResponse } from '#/tui/components/dialogs/approval/approval-panel';
import type { FooterBadge } from '#/tui/components/chrome/footer/footer-badges';
import { labelPermissionOk } from '#/tui/components/chrome/footer/footer-labels';
import type { FooterLabels } from '#/tui/config';
import type { AppState } from '#/tui/types';

/** Footer approval micro-badge lifetime after an explicit approval. */
export const PERMISSION_APPROVE_FLOURISH_BADGE_TTL_MS = 2_000;

/** True when the operator approved once or for the session (not reject/cancel). */
export function shouldPermissionApproveFlourish(response: ApprovalPanelResponse): boolean {
  return response.response === 'approved' || response.response === 'approved_for_session';
}

/** Dopamine Ops footer glance — brief badge after permission approval. */
export function formatPermissionApproveFooterBadge(
  flourish: AppState['permissionApproveFlourish'],
  nowMs: number = Date.now(),
  labels: FooterLabels = 'plain',
): FooterBadge | null {
  if (flourish === undefined || flourish === null) return null;
  if (nowMs - flourish.atMs >= PERMISSION_APPROVE_FLOURISH_BADGE_TTL_MS) return null;
  return { text: labelPermissionOk(labels), severity: 'info' };
}

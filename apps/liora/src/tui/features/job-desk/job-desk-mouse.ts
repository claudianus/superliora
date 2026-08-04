/**
 * Mouse drill-down for the Conductor Job Desk: a left click inside the
 * jobs region opens the interactive Job Deck viewer (focused on the card
 * under the pointer when the hit map resolves one).
 */

import type { NativeInputMouseEvent } from '#/tui/renderer';

import { getTUIStateNativeJobsRect } from '#/tui/features/transcript/transcript-hit-test';
import type { TUIState } from '../../tui-state';

export type JobDeskMouseHit =
  | { readonly kind: 'card'; readonly jobId: string }
  | { readonly kind: 'panel' };

/** Job Desk hit under a left-click, when the pointer is inside the jobs region. */
export function jobDeskHitAtMouse(
  state: TUIState,
  event: NativeInputMouseEvent,
): JobDeskMouseHit | undefined {
  if (event.action !== 'press' || event.button !== 'left') return undefined;
  if (!state.jobDeskPanel.shouldMount()) return undefined;
  const rect = getTUIStateNativeJobsRect(state);
  if (rect === undefined || rect.height <= 0 || rect.width <= 0) return undefined;
  if (
    event.x < rect.x ||
    event.x >= rect.x + rect.width ||
    event.y < rect.y ||
    event.y >= rect.y + rect.height
  ) {
    return undefined;
  }
  const jobId = state.jobDeskPanel.hitTestCard(event.x - rect.x, event.y - rect.y);
  return jobId === undefined ? { kind: 'panel' } : { kind: 'card', jobId };
}

/** Card id under the pointer, when the click lands on a kanban card. */
export function jobDeskCardIdAtMouse(
  state: TUIState,
  event: NativeInputMouseEvent,
): string | undefined {
  const hit = jobDeskHitAtMouse(state, event);
  return hit?.kind === 'card' ? hit.jobId : undefined;
}

/**
 * Mouse drill-down for the Conductor Job Desk: a left click on a kanban
 * card resolves to that job id so the input router can open the
 * interactive Job Deck viewer on it.
 */

import type { NativeInputMouseEvent } from '#/tui/renderer';

import { getTUIStateNativeJobsRect } from '#/tui/features/transcript/transcript-hit-test';
import type { TUIState } from '../../tui-state';

/** Job id under a left-click inside the Job Desk region, when any. */
export function jobDeskCardIdAtMouse(
  state: TUIState,
  event: NativeInputMouseEvent,
): string | undefined {
  if (event.action !== 'press' || event.button !== 'left') return undefined;
  if (!state.jobDeskPanel.shouldMount()) return undefined;
  const rect = getTUIStateNativeJobsRect(state);
  if (rect === undefined) return undefined;
  if (
    event.x < rect.x ||
    event.x >= rect.x + rect.width ||
    event.y < rect.y ||
    event.y >= rect.y + rect.height
  ) {
    return undefined;
  }
  return state.jobDeskPanel.hitTestCard(event.x - rect.x, event.y - rect.y);
}

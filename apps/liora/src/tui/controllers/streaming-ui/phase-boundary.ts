/**
 * Stream-mount wiring for TurnPhaseBoundary.
 * Inserts a phase header row once when entering a work-unit whose content
 * component does not paint its own header (tools at full density).
 */

import { TurnPhaseBoundaryComponent } from '../../components/messages/turn-phase-boundary';
import { UserMessageComponent } from '../../components/messages/user-message';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import {
  nextTurnPhase,
  shouldInsertPhaseBoundary,
  type TurnPhaseId,
} from '#/tui/features/transcript/turn-phase-model';
import type { TranscriptPhaseKind } from '#/tui/features/transcript/transcript-phase-tint';

/** Per-turn phase tracker for stream mounts. */
export interface PhaseBoundaryState {
  phase: TurnPhaseId | undefined;
  /** Index of last user message when phase was last noted (−1 if none). */
  turnIndex: number;
}

export function createPhaseBoundaryState(): PhaseBoundaryState {
  return { phase: undefined, turnIndex: -1 };
}

function lastUserMessageIndex(state: TUIState): number {
  const children = state.transcriptContainer.children;
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i] instanceof UserMessageComponent) return i;
  }
  return -1;
}

/**
 * Note a stream phase transition. Mounts TurnPhaseBoundary when the next
 * phase needs an external header; always advances the tracker for the turn.
 * @returns true when a boundary component was mounted.
 */
export function noteStreamPhase(
  state: TUIState,
  tracker: PhaseBoundaryState,
  phase: TurnPhaseId,
  detail?: string,
): boolean {
  const lastUserIndex = lastUserMessageIndex(state);
  if (tracker.turnIndex !== lastUserIndex) {
    tracker.phase = undefined;
    tracker.turnIndex = lastUserIndex;
  }

  const level = state.transcriptDetail;
  const insert = shouldInsertPhaseBoundary(tracker.phase, phase, level);
  tracker.phase = nextTurnPhase(tracker.phase, phase);
  if (!insert) return false;

  const kind = phase as TranscriptPhaseKind;
  state.transcriptContainer.addChild(new TurnPhaseBoundaryComponent(kind, detail));
  requestTUILayoutRender(state);
  return true;
}

export function resetPhaseBoundaryState(tracker: PhaseBoundaryState): void {
  tracker.phase = undefined;
  tracker.turnIndex = -1;
}

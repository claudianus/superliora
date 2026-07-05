import type { NativeInputEvent, NativeInputMouseEvent } from '#/tui/renderer';

import type { TUIState } from '../tui-state';
import {
  resolveTranscriptHitTestContext,
  transcriptPointForMouse,
} from './transcript-hit-test';

export function handleTranscriptSelectionMouseInput(
  state: TUIState,
  event: NativeInputEvent,
): boolean {
  if (event.type !== 'mouse') return false;
  return handleTranscriptSelectionMouseEvent(state, event);
}

function handleTranscriptSelectionMouseEvent(
  state: TUIState,
  event: NativeInputMouseEvent,
): boolean {
  if (event.button !== 'left' && event.button !== 'none') return false;
  if (event.action !== 'press' && event.action !== 'drag' && event.action !== 'release') {
    return false;
  }

  const context = resolveTranscriptHitTestContext(state);
  if (context === undefined) return false;

  const point = transcriptPointForMouse(event, context);
  if (point === undefined) return false;

  const selection = state.transcriptSelection;
  if (event.action === 'press') {
    selection.beginPress(point, event.shift);
    return true;
  }
  if (event.action === 'drag') {
    if (!selection.isDragging) return false;
    selection.updateDrag(point);
    return true;
  }
  selection.endPress();
  return true;
}

export function clearTranscriptSelection(state: TUIState): void {
  state.transcriptSelection.clear();
}

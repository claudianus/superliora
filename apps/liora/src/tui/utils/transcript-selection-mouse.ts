import type { NativeInputEvent, NativeInputMouseEvent } from '#/tui/renderer';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';

import type { TUIState } from '../tui-state';
import { appearanceAnimationNow } from './appearance-effects';
import { requestTUILayoutRender } from './frame-render';
import { clearIdleFeedPending, handleIdleFeedMouseInput } from './idle-feed-mouse';
import { noteMeteorEasterEggClick } from './stage-letterbox-sky';
import {
  resolveTranscriptHitTestContext,
  transcriptPointForMouse,
} from './transcript-hit-test';
import { resolveTranscriptSelectionText } from './transcript-selection';

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

  // Observational only — count any left press for the meteor easter egg,
  // including letterbox / out-of-feed hits that return false below.
  if (event.button === 'left' && event.action === 'press') {
    if (noteMeteorEasterEggClick(appearanceAnimationNow())) {
      requestTUILayoutRender(state);
    }
  }

  const context = resolveTranscriptHitTestContext(state);
  if (context === undefined) {
    // Out-of-bounds / no hit context must not leave a short-click feed pending.
    if (event.action === 'drag' || event.action === 'release') {
      clearIdleFeedPending(state);
    }
    return false;
  }

  const point = transcriptPointForMouse(event, context);
  if (point === undefined) {
    if (event.action === 'drag' || event.action === 'release') {
      clearIdleFeedPending(state);
    }
    return false;
  }

  const selection = state.transcriptSelection;
  if (event.action === 'press') {
    selection.beginPress(point, event.shift);
    handleIdleFeedMouseInput(state, event, point);
    return true;
  }
  if (event.action === 'drag') {
    if (!selection.isDragging) return false;
    selection.updateDrag(point);
    handleIdleFeedMouseInput(state, event, point);
    return true;
  }
  if (handleIdleFeedMouseInput(state, event, point)) {
    return true;
  }
  const wasDragging = selection.isDragging;
  selection.endPress();
  if (wasDragging) {
    // Drag-release copies the selection without clearing it, and confirms
    // with a transient toast overlay.
    void copyTranscriptSelectionOnRelease(state);
  }
  return true;
}

async function copyTranscriptSelectionOnRelease(state: TUIState): Promise<void> {
  const text = await resolveTranscriptSelectionText(state);
  if (text === undefined) return;
  await copyTextToClipboard(text);
  state.toast.show('Copied to clipboard');
}

export function clearTranscriptSelection(state: TUIState): void {
  clearIdleFeedPending(state);
  state.transcriptSelection.clear();
}

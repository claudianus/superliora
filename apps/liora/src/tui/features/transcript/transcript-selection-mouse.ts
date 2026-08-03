import type { NativeInputEvent, NativeInputMouseEvent } from '#/tui/renderer';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';

import type { TUIState } from '../../tui-state';
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';
import { requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import { clearIdleFeedPending, handleIdleFeedMouseInput } from '#/tui/features/idle-scene/idle-feed-mouse';
import { noteMeteorEasterEggClick } from '#/tui/features/stage/stage-letterbox-sky';
import {
  resolveTranscriptHitTestContext,
  transcriptPointForMouse,
} from '#/tui/features/transcript/transcript-hit-test';
import { resolveTranscriptSelectionText } from '#/tui/features/transcript/transcript-selection';

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

  const selection = state.transcriptSelection;

  // Drag/release that began inside the transcript must still finalize even when
  // the pointer leaves the hit-test rect (common when selecting long lines and
  // releasing over the editor, gutter, or letterbox). Without this, isDragging
  // sticks and copy never runs.
  if (
    (event.action === 'drag' || event.action === 'release') &&
    selection.isDragging
  ) {
    const context = resolveTranscriptHitTestContext(state);
    const point = context === undefined ? undefined : transcriptPointForMouse(event, context);
    if (point !== undefined) {
      if (event.action === 'drag') {
        selection.updateDrag(point);
        handleIdleFeedMouseInput(state, event, point);
        return true;
      }
      // release inside hit area
      if (handleIdleFeedMouseInput(state, event, point)) {
        return true;
      }
      return finalizeSelectionRelease(state, selection.isDragging);
    }

    // Outside transcript content: keep last head on drag; always end on release.
    if (event.action === 'drag') {
      clearIdleFeedPending(state);
      return true;
    }
    clearIdleFeedPending(state);
    return finalizeSelectionRelease(state, true);
  }

  const context = resolveTranscriptHitTestContext(state);
  if (context === undefined) {
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
  return finalizeSelectionRelease(state, selection.isDragging);
}

function finalizeSelectionRelease(state: TUIState, wasDragging: boolean): boolean {
  state.transcriptSelection.endPress();
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
  try {
    await copyTextToClipboard(text);
    state.toast.show('Copied to clipboard');
  } catch {
    // Keep highlight so Ctrl+C / retry can still work; surface a clear status.
    state.toast.show('Copy failed — try Ctrl+C');
  }
  requestTUILayoutRender(state);
}

export function clearTranscriptSelection(state: TUIState): void {
  clearIdleFeedPending(state);
  state.transcriptSelection.clear();
}

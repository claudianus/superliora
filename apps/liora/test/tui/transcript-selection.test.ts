import { describe, expect, it, vi } from 'vitest';

import { shouldRenderAmbientAnimationFrame } from '#/tui/controllers/appearance/index';
import { CHROME_GUTTER } from '#/tui/constant/rendering';
import { createTUIState, type LioraTUIOptions } from '#/tui/liora-tui';
import { resetTUIInputInteractionForTests } from '#/tui/utils/input/input-interaction';
import { Text } from '#/tui/renderer';
import type { AppState } from '#/tui/types';
import {
  resolveTranscriptHitTestContext,
  transcriptPointForMouse,
} from '#/tui/features/transcript/transcript-hit-test';
import * as transcriptHitTest from '#/tui/features/transcript/transcript-hit-test';
import { handleTranscriptSelectionMouseInput } from '#/tui/features/transcript/transcript-selection-mouse';
import { createTUIStateNativeInputRouter } from '#/tui/features/native-layout/native-input-router';
import { resetStageResizeDragForTests } from '#/tui/features/stage/stage-resize-mouse';
import {
  copyTranscriptSelectionToClipboard,
  createTranscriptSelectionState,
  extractTranscriptSelectionPlainText,
  shouldHoldTranscriptAnimation,
} from '#/tui/features/transcript/transcript-selection';

vi.mock('#/utils/clipboard/clipboard-text', () => ({
  copyTextToClipboard: vi.fn(async () => {}),
}));

import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';

const copyTextToClipboardMock = vi.mocked(copyTextToClipboard);

function createTestAppState(): AppState {
  return {
    theme: 'dark',
    model: 'example-model',
    planMode: false,
    askMode: false,
    streamingPhase: 'idle',
    isCompacting: false,
    isBackgroundCompacting: false,
    inputMode: 'prompt',
  } as AppState;
}

function createTestTuiState(options: Partial<LioraTUIOptions> = {}) {
  const state = createTUIState({
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
    initialAppState: createTestAppState(),
    ...options,
  });
  state.transcriptContainer.clear();
  state.transcriptContainer.addChild(new Text('Hello transcript'));
  state.transcriptContainer.addChild(new Text('Second line here'));
  return state;
}

describe('TranscriptSelectionState', () => {
  it('normalizes a drag range and clears on click-only release', () => {
    const selection = createTranscriptSelectionState();
    selection.beginPress({ globalLine: 1, col: 2 }, false);
    selection.updateDrag({ globalLine: 0, col: 5 });
    selection.endPress();

    expect(selection.hasSelection).toBe(true);
    expect(selection.normalizedRange()).toEqual({
      start: { globalLine: 0, col: 5 },
      end: { globalLine: 1, col: 2 },
    });

    selection.beginPress({ globalLine: 0, col: 0 }, false);
    selection.endPress();
    expect(selection.hasSelection).toBe(false);
  });

  it('extracts plain text across visible lines', () => {
    const text = extractTranscriptSelectionPlainText(
      {
        start: { globalLine: 0, col: 6 },
        end: { globalLine: 1, col: 6 },
      },
      [' Hello transcript', ' Second line here'],
      0,
      1,
    );
    expect(text).toBe('transcript\nSecond');
  });
});

describe('transcript hit test', () => {
  it('maps mouse coordinates inside the transcript rect to line and column', () => {
    const state = createTestTuiState();
    const context = resolveTranscriptHitTestContext(state, 40, 12);
    expect(context).toBeDefined();

    const point = transcriptPointForMouse(
      {
        raw: '',
        ctrl: false,
        alt: false,
        shift: false,
        type: 'mouse',
        action: 'press',
        button: 'left',
        x: context!.rect.x + CHROME_GUTTER + 2,
        y: context!.rect.y,
      },
      context!,
    );

    expect(point?.globalLine).toBe(context!.viewportStart);
    expect(point?.col).toBe(2);
  });

  it('ignores clicks in the scrollbar gutter', () => {
    const state = createTestTuiState();
    const context = resolveTranscriptHitTestContext(state, 20, 10);
    expect(context).toBeDefined();

    const point = transcriptPointForMouse(
      {
        raw: '',
        ctrl: false,
        alt: false,
        shift: false,
        type: 'mouse',
        action: 'press',
        button: 'left',
        x: context!.rect.x + context!.rect.width - 1,
        y: context!.rect.y,
      },
      context!,
    );

    expect(point).toBeUndefined();
  });
});

describe('transcript selection mouse routing', () => {
  it('handles press, drag, and release to build a selection', () => {
    const state = createTestTuiState();
    const context = resolveTranscriptHitTestContext(state, 40, 12)!;

    const press = {
      type: 'mouse' as const,
      raw: '',
      ctrl: false,
      alt: false,
      shift: false,
      action: 'press' as const,
      button: 'left' as const,
      x: context.rect.x + CHROME_GUTTER,
      y: context.rect.y,
    };
    const drag = {
      ...press,
      action: 'drag' as const,
      x: context.rect.x + CHROME_GUTTER + 4,
    };
    const release = {
      ...press,
      action: 'release' as const,
      x: context.rect.x + CHROME_GUTTER + 4,
    };

    expect(handleTranscriptSelectionMouseInput(state, press)).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, drag)).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, release)).toBe(true);
    expect(state.transcriptSelection.hasSelection).toBe(true);
  });

  it('copies the selection on drag release, keeps it highlighted, and toasts', async () => {
    copyTextToClipboardMock.mockClear();
    const state = createTestTuiState();
    vi.spyOn(transcriptHitTest, 'resolveTranscriptHitTestContext').mockReturnValue({
      rect: { x: 0, y: 0, width: 40, height: 5 },
      viewportStart: 0,
      visibleRows: 5,
      stageWidth: 40,
      leftPad: CHROME_GUTTER,
      rightPad: CHROME_GUTTER,
      contentWidth: 38,
      visibleLines: [' Hello transcript'],
    });

    const press = {
      type: 'mouse' as const,
      raw: '',
      ctrl: false,
      alt: false,
      shift: false,
      action: 'press' as const,
      button: 'left' as const,
      x: CHROME_GUTTER,
      y: 0,
    };
    const drag = { ...press, action: 'drag' as const, x: CHROME_GUTTER + 5 };
    const release = { ...press, action: 'release' as const, x: CHROME_GUTTER + 5 };

    expect(handleTranscriptSelectionMouseInput(state, press)).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, drag)).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, release)).toBe(true);

    await vi.waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith('Hello');
      expect(state.toast.visible?.message).toBe('Copied to clipboard');
    });
    // Drag-release copy keeps the highlight so the user can re-copy or Ctrl+C.
    expect(state.transcriptSelection.hasSelection).toBe(true);
  });
});


  it('finalizes and copies when drag releases outside the transcript hit area', async () => {
    copyTextToClipboardMock.mockClear();
    const state = createTestTuiState();
    vi.spyOn(transcriptHitTest, 'resolveTranscriptHitTestContext').mockReturnValue({
      rect: { x: 0, y: 0, width: 40, height: 5 },
      viewportStart: 0,
      visibleRows: 5,
      stageWidth: 40,
      leftPad: CHROME_GUTTER,
      rightPad: CHROME_GUTTER,
      contentWidth: 38,
      visibleLines: [' Hello transcript'],
    });

    const press = {
      type: 'mouse' as const,
      raw: '',
      ctrl: false,
      alt: false,
      shift: false,
      action: 'press' as const,
      button: 'left' as const,
      x: CHROME_GUTTER,
      y: 0,
    };
    const drag = { ...press, action: 'drag' as const, x: CHROME_GUTTER + 8 };
    // Release far outside the transcript rect (e.g. over the editor / letterbox).
    const releaseOutside = {
      ...press,
      action: 'release' as const,
      x: 200,
      y: 200,
    };

    expect(handleTranscriptSelectionMouseInput(state, press)).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, drag)).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, releaseOutside)).toBe(true);
    expect(state.transcriptSelection.isDragging).toBe(false);

    await vi.waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalled();
      expect(state.toast.visible?.message).toBe('Copied to clipboard');
    });
    expect(state.transcriptSelection.hasSelection).toBe(true);
  });

  it('keeps drag active when pointer leaves content mid-drag, then copies on release', async () => {
    copyTextToClipboardMock.mockClear();
    const state = createTestTuiState();
    vi.spyOn(transcriptHitTest, 'resolveTranscriptHitTestContext').mockReturnValue({
      rect: { x: 0, y: 0, width: 40, height: 5 },
      viewportStart: 0,
      visibleRows: 5,
      stageWidth: 40,
      leftPad: CHROME_GUTTER,
      rightPad: CHROME_GUTTER,
      contentWidth: 38,
      visibleLines: [' Hello transcript'],
    });

    const press = {
      type: 'mouse' as const,
      raw: '',
      ctrl: false,
      alt: false,
      shift: false,
      action: 'press' as const,
      button: 'left' as const,
      x: CHROME_GUTTER,
      y: 0,
    };
    const dragInside = { ...press, action: 'drag' as const, x: CHROME_GUTTER + 6 };
    const dragOutside = { ...press, action: 'drag' as const, x: 999, y: 999 };
    const releaseOutside = { ...press, action: 'release' as const, x: 999, y: 999 };

    expect(handleTranscriptSelectionMouseInput(state, press)).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, dragInside)).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, dragOutside)).toBe(true);
    expect(state.transcriptSelection.isDragging).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, releaseOutside)).toBe(true);
    expect(state.transcriptSelection.isDragging).toBe(false);

    await vi.waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith('Hello ');
    });
  });

describe('copyTranscriptSelectionToClipboard', () => {
  it('copies selected transcript text and skips empty selections', async () => {
    copyTextToClipboardMock.mockClear();
    const state = createTestTuiState();

    expect(await copyTranscriptSelectionToClipboard(state)).toBe(false);

    vi.spyOn(transcriptHitTest, 'resolveTranscriptHitTestContext').mockReturnValue({
      rect: { x: 0, y: 0, width: 40, height: 5 },
      viewportStart: 0,
      visibleRows: 5,
      stageWidth: 40,
      leftPad: CHROME_GUTTER,
      rightPad: CHROME_GUTTER,
      contentWidth: 38,
      visibleLines: [' Hello transcript'],
    });

    state.transcriptSelection.beginPress({ globalLine: 0, col: 0 }, false);
    state.transcriptSelection.updateDrag({ globalLine: 0, col: 5 });
    state.transcriptSelection.endPress();

    expect(await copyTranscriptSelectionToClipboard(state)).toBe(true);
    expect(copyTextToClipboardMock).toHaveBeenCalledWith('Hello');
    expect(state.transcriptSelection.hasSelection).toBe(false);
  });
});

describe('animation gate', () => {
  it('holds ambient animation only while transcript selection is active', () => {
    const selection = createTranscriptSelectionState();
    // Scrolling back (followOutput=false) no longer freezes ambient animation;
    // the predicate no longer knows about scroll state at all.
    expect(shouldHoldTranscriptAnimation({ transcriptSelection: selection })).toBe(false);

    selection.beginPress({ globalLine: 0, col: 0 }, false);
    selection.updateDrag({ globalLine: 0, col: 3 });
    selection.endPress();
    expect(shouldHoldTranscriptAnimation({ transcriptSelection: selection })).toBe(true);
    resetTUIInputInteractionForTests();
    expect(shouldRenderAmbientAnimationFrame(24, true)).toBe(false);
    expect(shouldRenderAmbientAnimationFrame(24, false)).toBe(true);
  });
});


describe('native router + transcript selection', () => {
  it('does not let the focused editor steal drag/release mid-selection', async () => {
    copyTextToClipboardMock.mockClear();
    resetStageResizeDragForTests();
    const state = createTestTuiState();
    // Fixed rect/coords — independent of terminal size so stage grips never win.
    const rect = { x: 10, y: 10, width: 40, height: 8 };
    vi.spyOn(transcriptHitTest, 'resolveTranscriptHitTestContext').mockReturnValue({
      rect,
      viewportStart: 0,
      visibleRows: 8,
      stageWidth: 40,
      leftPad: CHROME_GUTTER,
      rightPad: CHROME_GUTTER,
      contentWidth: 38,
      visibleLines: [' Hello transcript', ' Second line here'],
    });
    // Editor below transcript; release lands there so focused-target would win
    // if it still swallowed drag/release.
    state.cachedEditorRect = { x: 0, y: 40, width: 80, height: 3 };
    state.cachedEditorRectColumns = state.terminal.columns;
    state.cachedEditorRectRows = state.terminal.rows;
    state.cachedEditorRectLineCount =
      state.editor.getNativeLayoutRowCount?.(state.terminal.columns) ?? -1;

    const router = createTUIStateNativeInputRouter(state, { requestRender: false });
    const press = {
      type: 'mouse' as const,
      raw: '',
      ctrl: false,
      alt: false,
      shift: false,
      action: 'press' as const,
      button: 'left' as const,
      x: rect.x + CHROME_GUTTER + 2,
      y: rect.y + 1,
    };
    const drag = {
      ...press,
      action: 'drag' as const,
      x: rect.x + CHROME_GUTTER + 10,
      y: rect.y + 1,
    };
    const releaseOnEditor = {
      ...press,
      action: 'release' as const,
      x: rect.x + CHROME_GUTTER + 10,
      y: 41,
    };

    expect(router.dispatch(press).handled).toBe(true);
    expect(state.transcriptSelection.isDragging).toBe(true);
    expect(router.dispatch(drag).handled).toBe(true);
    expect(router.dispatch(releaseOnEditor).handled).toBe(true);
    expect(state.transcriptSelection.isDragging).toBe(false);

    await vi.waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalled();
      expect(state.toast.visible?.message).toBe('Copied to clipboard');
    });
    expect(state.transcriptSelection.hasSelection).toBe(true);
  });
});

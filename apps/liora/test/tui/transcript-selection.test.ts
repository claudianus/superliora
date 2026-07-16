import { describe, expect, it, vi } from 'vitest';

import { shouldRenderAmbientAnimationFrame } from '#/tui/controllers/appearance';
import { CHROME_GUTTER } from '#/tui/constant/rendering';
import { createTUIState, type LioraTUIOptions } from '#/tui/liora-tui';
import { Text } from '#/tui/renderer';
import type { AppState } from '#/tui/types';
import {
  resolveTranscriptHitTestContext,
  transcriptPointForMouse,
} from '#/tui/utils/transcript-hit-test';
import * as transcriptHitTest from '#/tui/utils/transcript-hit-test';
import { handleTranscriptSelectionMouseInput } from '#/tui/utils/transcript-selection-mouse';
import {
  copyTranscriptSelectionToClipboard,
  createTranscriptSelectionState,
  extractTranscriptSelectionPlainText,
  shouldHoldTranscriptAnimation,
} from '#/tui/utils/transcript-selection';

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
    ultraworkMode: false,
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
  it('holds ambient animation while transcript selection is active', () => {
    const selection = createTranscriptSelectionState();
    expect(
      shouldHoldTranscriptAnimation({ followOutput: true, transcriptSelection: selection }),
    ).toBe(false);

    selection.beginPress({ globalLine: 0, col: 0 }, false);
    selection.updateDrag({ globalLine: 0, col: 3 });
    selection.endPress();
    expect(
      shouldHoldTranscriptAnimation({ followOutput: true, transcriptSelection: selection }),
    ).toBe(true);
    expect(shouldRenderAmbientAnimationFrame(true, 24, true)).toBe(false);
    expect(shouldRenderAmbientAnimationFrame(true, 24, false)).toBe(true);
  });
});

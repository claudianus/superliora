import { describe, expect, it, vi } from 'vitest';

import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { CHROME_GUTTER } from '#/tui/constant/rendering';
import { createTUIState, type LioraTUIOptions } from '#/tui/liora-tui';
import { Text } from '#/tui/renderer';
import type { AppState } from '#/tui/types';
import { resolveTranscriptHitTestContext } from '#/tui/utils/transcript-hit-test';
import { handleTranscriptSelectionMouseInput } from '#/tui/utils/transcript-selection-mouse';
import { isShortClickFeed } from '#/tui/utils/idle-feed-mouse';

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

function createIdleFeedTuiState(options: Partial<LioraTUIOptions> = {}) {
  const state = createTUIState({
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
    initialAppState: createTestAppState(),
    ...options,
  });
  const stage = new IdleStageComponent({ state: state.appState });
  stage.render(state.terminal.columns);
  state.transcriptContainer.clear();
  state.transcriptContainer.addChild(stage);
  return { state, stage };
}

function mouseEvent(
  action: 'press' | 'drag' | 'release',
  x: number,
  y: number,
) {
  return {
    type: 'mouse' as const,
    raw: '',
    ctrl: false,
    alt: false,
    shift: false,
    action,
    button: 'left' as const,
    x,
    y,
  };
}

describe('isShortClickFeed', () => {
  it('allows movement within maxMove cells', () => {
    expect(isShortClickFeed({ x: 10, y: 5 }, { x: 11, y: 5 }, 1)).toBe(true);
    expect(isShortClickFeed({ x: 10, y: 5 }, { x: 12, y: 5 }, 1)).toBe(false);
    expect(isShortClickFeed(undefined, { x: 10, y: 5 }, 1)).toBe(false);
  });
});

describe('idle feed mouse', () => {
  it('short click on idle drops food and clears selection', () => {
    const { state, stage } = createIdleFeedTuiState();
    const dropSpy = vi.spyOn(stage, 'tryDropFoodAtContent');
    const context = resolveTranscriptHitTestContext(state)!;
    const x = context.rect.x + CHROME_GUTTER + 8;
    const y = context.rect.y + 1;

    expect(handleTranscriptSelectionMouseInput(state, mouseEvent('press', x, y))).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, mouseEvent('release', x, y))).toBe(true);

    expect(dropSpy).toHaveBeenCalledTimes(1);
    expect(dropSpy).toHaveBeenCalledWith(8);
    expect(state.transcriptSelection.hasSelection).toBe(false);
    expect(state.transcriptSelection.isDragging).toBe(false);
  });

  it('drag does not drop food', () => {
    const { state, stage } = createIdleFeedTuiState();
    const dropSpy = vi.spyOn(stage, 'tryDropFoodAtContent');
    const context = resolveTranscriptHitTestContext(state)!;
    const y = context.rect.y + 1;
    const pressX = context.rect.x + CHROME_GUTTER;
    const dragX = pressX + 4;

    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('press', pressX, y)),
    ).toBe(true);
    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('drag', dragX, y)),
    ).toBe(true);
    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('release', dragX, y)),
    ).toBe(true);

    expect(dropSpy).not.toHaveBeenCalled();
    expect(state.transcriptSelection.hasSelection).toBe(true);
  });

  it('non-idle transcript keeps selection-only mouse path', () => {
    const state = createTUIState({
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
      initialAppState: createTestAppState(),
    });
    state.transcriptContainer.clear();
    state.transcriptContainer.addChild(new Text('Hello transcript'));
    const context = resolveTranscriptHitTestContext(state)!;
    const y = context.rect.y;
    const pressX = context.rect.x + CHROME_GUTTER;
    const dragX = pressX + 4;

    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('press', pressX, y)),
    ).toBe(true);
    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('drag', dragX, y)),
    ).toBe(true);
    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('release', dragX, y)),
    ).toBe(true);
    expect(state.transcriptSelection.hasSelection).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { WelcomeComponent } from '#/tui/components/chrome/welcome';
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
    version: '1.2.3',
    workDir: '/tmp/project',
    sessionId: 'ses-1',
    planMode: false,
    ultraworkMode: false,
    streamingPhase: 'idle',
    isCompacting: false,
    isBackgroundCompacting: false,
    inputMode: 'prompt',
    availableModels: {},
    availableProviders: {},
    mcpServersSummary: null,
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

function createWelcomeIdleTuiState() {
  const state = createTUIState({
    startup: { continueLast: false, yolo: false, auto: false, plan: false },
    initialAppState: createTestAppState(),
  });
  const welcome = new WelcomeComponent(state.appState);
  const stage = new IdleStageComponent({
    state: state.appState,
    getPreferredRows: (width) => state.transcriptContainer.idleTargetRows(width),
  });
  state.transcriptContainer.clear();
  state.transcriptContainer.addChild(welcome);
  state.transcriptContainer.addChild(stage);
  // Warm layout + sim via the same path mouse hit-testing uses.
  const context = resolveTranscriptHitTestContext(state)!;
  return { state, stage, welcome, context };
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

  it('out-of-bounds drag clears pending so release near press does not feed', () => {
    const { state, stage } = createIdleFeedTuiState();
    const dropSpy = vi.spyOn(stage, 'tryDropFoodAtContent');
    const context = resolveTranscriptHitTestContext(state)!;
    const x = context.rect.x + CHROME_GUTTER + 8;
    const y = context.rect.y + 1;
    const outsideY = context.rect.y + context.rect.height + 2;

    expect(handleTranscriptSelectionMouseInput(state, mouseEvent('press', x, y))).toBe(true);
    // Drag leaves the transcript hit rect — must clear pending (not skip idle-feed handling).
    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('drag', x, outsideY)),
    ).toBe(false);
    // Release back near the original press must not drop food without a fresh press.
    expect(handleTranscriptSelectionMouseInput(state, mouseEvent('release', x, y))).toBe(true);

    expect(dropSpy).not.toHaveBeenCalled();
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

  it('short click on Welcome chrome above Idle does not feed', () => {
    const { state, stage, welcome, context } = createWelcomeIdleTuiState();
    const dropSpy = vi.spyOn(stage, 'tryDropFoodAtContent');
    const welcomeRows = welcome.render(context.contentWidth).length;
    expect(welcomeRows).toBeGreaterThan(0);

    const x = context.rect.x + CHROME_GUTTER + 8;
    // First transcript row belongs to Welcome, not IdleStage.
    const y = context.rect.y;

    expect(handleTranscriptSelectionMouseInput(state, mouseEvent('press', x, y))).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, mouseEvent('release', x, y))).toBe(true);

    expect(dropSpy).not.toHaveBeenCalled();
  });

  it('short click on IdleStage rows below Welcome still feeds', () => {
    const { state, stage, welcome, context } = createWelcomeIdleTuiState();
    const dropSpy = vi.spyOn(stage, 'tryDropFoodAtContent').mockReturnValue(true);
    const welcomeRows = welcome.render(context.contentWidth).length;
    expect(welcomeRows).toBeGreaterThan(0);
    expect(welcomeRows).toBeLessThan(context.visibleRows);

    const x = context.rect.x + CHROME_GUTTER + 8;
    const y = context.rect.y + welcomeRows;

    expect(handleTranscriptSelectionMouseInput(state, mouseEvent('press', x, y))).toBe(true);
    expect(handleTranscriptSelectionMouseInput(state, mouseEvent('release', x, y))).toBe(true);

    expect(dropSpy).toHaveBeenCalledTimes(1);
    expect(state.transcriptSelection.hasSelection).toBe(false);
  });

  it('failed dropFood does not clear a 1-cell micro-drag selection', () => {
    const { state, stage } = createIdleFeedTuiState();
    const dropSpy = vi.spyOn(stage, 'tryDropFoodAtContent').mockReturnValue(false);
    const context = resolveTranscriptHitTestContext(state)!;
    const y = context.rect.y + 1;
    const pressX = context.rect.x + CHROME_GUTTER + 8;
    const releaseX = pressX + 1; // within IDLE_FEED_MAX_MOVE, but changes selection col

    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('press', pressX, y)),
    ).toBe(true);
    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('drag', releaseX, y)),
    ).toBe(true);
    expect(
      handleTranscriptSelectionMouseInput(state, mouseEvent('release', releaseX, y)),
    ).toBe(true);

    expect(dropSpy).toHaveBeenCalledTimes(1);
    // Feed path must not clear(); endPress keeps the micro-drag selection.
    expect(state.transcriptSelection.hasSelection).toBe(true);
    expect(state.transcriptSelection.isDragging).toBe(false);
  });
});

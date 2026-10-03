import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  noteTranscriptPureScrollPaint,
  resetTranscriptMeasureModeForTest,
} from '#/tui/renderer';
import {
  requestTUIContentRender,
  requestTUILayoutRender,
  requestTranscriptGeometryRefresh,
  requestTranscriptPaintRefresh,
} from '#/tui/utils/render/frame-render';
import {
  resetTranscriptScrollActivityForTest,
  shouldDeferTranscriptContentInvalidation,
  shouldDeferTranscriptHeavyInvalidation,
  withTranscriptPaintMode,
} from '#/tui/utils/render/transcript-paint-mode';
import { clearTranscriptScrollSettleRefreshForTest } from '#/tui/utils/render/scroll-settle-refresh';
import type { TUIState } from '#/tui/tui-state';

function fakeState(overrides?: {
  invalidateFrame?: (intent: string) => void;
  invalidatePaint?: () => void;
  invalidateGeometryAndPaint?: () => void;
  isBatchMounting?: boolean;
}): TUIState {
  const invalidateFrame = overrides?.invalidateFrame ?? vi.fn();
  const invalidatePaint = overrides?.invalidatePaint ?? vi.fn();
  const invalidateGeometryAndPaint = overrides?.invalidateGeometryAndPaint ?? vi.fn();
  return {
    transcriptContainer: {
      isBatchMounting: overrides?.isBatchMounting === true,
      invalidatePaint,
      invalidateGeometryAndPaint,
      needsMaterializeContinue: false,
    },
    renderer: {
      invalidateFrame,
    },
  } as unknown as TUIState;
}

describe('content invalidation hold while transcript scroll is hot', () => {
  afterEach(() => {
    resetTranscriptScrollActivityForTest();
    resetTranscriptMeasureModeForTest();
    clearTranscriptScrollSettleRefreshForTest();
    vi.useRealTimers();
  });

  it('coalesces content render only during a real pure-scroll storm', () => {
    const invalidateFrame = vi.fn();
    const state = fakeState({ invalidateFrame });

    // Paint-mode alone (no pure-scroll stamp) must not block streaming content.
    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {});
    requestTUIContentRender(state);
    expect(invalidateFrame).toHaveBeenCalledWith('content');
    invalidateFrame.mockClear();

    // Two pure-scroll stamps within the storm window defer light content.
    // Use the live paint clock (same as production requestTUIContentRender).
    noteTranscriptPureScrollPaint();
    noteTranscriptPureScrollPaint();
    expect(shouldDeferTranscriptContentInvalidation()).toBe(true);
    requestTUIContentRender(state);
    expect(invalidateFrame).not.toHaveBeenCalled();
  });

  it('keeps streaming content painting through a light scroll storm', () => {
    const invalidateFrame = vi.fn();
    const state = fakeState({ invalidateFrame });
    (state as { appState: { streamingPhase: string } }).appState = {
      streamingPhase: 'composing',
    };

    noteTranscriptPureScrollPaint();
    noteTranscriptPureScrollPaint();
    expect(shouldDeferTranscriptContentInvalidation()).toBe(true);
    requestTUIContentRender(state);
    expect(invalidateFrame).toHaveBeenCalledWith('content');
  });

  it('allows content render when scroll is not hot', () => {
    const invalidateFrame = vi.fn();
    const state = fakeState({ invalidateFrame });
    resetTranscriptScrollActivityForTest();
    resetTranscriptMeasureModeForTest();

    requestTUIContentRender(state);
    expect(invalidateFrame).toHaveBeenCalledWith('content');
  });

  it('coalesces transcript paint refresh while scroll is hot', () => {
    const invalidateFrame = vi.fn();
    const invalidatePaint = vi.fn();
    const state = fakeState({ invalidateFrame, invalidatePaint });

    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {});
    requestTranscriptPaintRefresh(state);
    expect(invalidatePaint).not.toHaveBeenCalled();
    expect(invalidateFrame).not.toHaveBeenCalled();
  });

  it('defers geometry wipe during scroll-hot window (O(transcript) guard)', () => {
    const invalidateFrame = vi.fn();
    const invalidateGeometryAndPaint = vi.fn();
    const state = fakeState({ invalidateFrame, invalidateGeometryAndPaint });

    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {});
    expect(shouldDeferTranscriptHeavyInvalidation()).toBe(true);
    requestTranscriptGeometryRefresh(state);
    expect(invalidateGeometryAndPaint).not.toHaveBeenCalled();
    expect(invalidateFrame).not.toHaveBeenCalled();
  });

  it('applies geometry wipe when scroll is not hot', () => {
    const invalidateFrame = vi.fn();
    const invalidateGeometryAndPaint = vi.fn();
    const state = fakeState({ invalidateFrame, invalidateGeometryAndPaint });
    resetTranscriptScrollActivityForTest();

    requestTranscriptGeometryRefresh(state);
    expect(invalidateGeometryAndPaint).toHaveBeenCalledOnce();
    expect(invalidateFrame).toHaveBeenCalledWith('content');
  });

  it('replays deferred geometry and layout once after the wheel quiets', () => {
    vi.useFakeTimers();
    vi.advanceTimersByTime(1);
    const invalidateFrame = vi.fn();
    const invalidatePaint = vi.fn();
    const invalidateGeometryAndPaint = vi.fn();
    const state = fakeState({ invalidateFrame, invalidatePaint, invalidateGeometryAndPaint });
    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {});
    requestTranscriptPaintRefresh(state);
    requestTUILayoutRender(state);
    requestTranscriptGeometryRefresh(state);
    requestTranscriptPaintRefresh(state);
    expect(invalidateFrame).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(invalidateGeometryAndPaint).toHaveBeenCalledOnce();
    expect(invalidatePaint).not.toHaveBeenCalled();
    expect(invalidateFrame).toHaveBeenCalledExactlyOnceWith('layout');
  });

  it('keeps deferred refreshes independent for distinct TUI states', () => {
    vi.useFakeTimers();
    vi.advanceTimersByTime(1);
    const first = fakeState();
    const second = fakeState();
    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {});
    requestTranscriptGeometryRefresh(first);
    requestTranscriptPaintRefresh(second);
    vi.advanceTimersByTime(1000);
    expect(first.transcriptContainer.invalidateGeometryAndPaint).toHaveBeenCalledOnce();
    expect(second.transcriptContainer.invalidatePaint).toHaveBeenCalledOnce();
    expect(first.renderer.invalidateFrame).toHaveBeenCalledExactlyOnceWith('content');
    expect(second.renderer.invalidateFrame).toHaveBeenCalledExactlyOnceWith('content');
  });
});

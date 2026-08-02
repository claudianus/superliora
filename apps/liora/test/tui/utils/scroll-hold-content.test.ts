import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  requestTUIContentRender,
  requestTranscriptGeometryRefresh,
  requestTranscriptPaintRefresh,
} from '#/tui/utils/render/frame-render';
import {
  resetTranscriptScrollActivityForTest,
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
    clearTranscriptScrollSettleRefreshForTest();
  });

  it('coalesces content render to settle while pure-scroll paint is recent', () => {
    const invalidateFrame = vi.fn();
    const state = fakeState({ invalidateFrame });

    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      // marks lastScrollActivityMs
    });

    requestTUIContentRender(state);
    // Must not invalidate immediately during scroll-hot window.
    expect(invalidateFrame).not.toHaveBeenCalled();
  });

  it('allows content render when scroll is not hot', () => {
    const invalidateFrame = vi.fn();
    const state = fakeState({ invalidateFrame });
    resetTranscriptScrollActivityForTest();

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
});

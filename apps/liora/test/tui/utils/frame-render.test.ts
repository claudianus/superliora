import { describe, expect, it, vi } from 'vitest';

import {
  flushSuppressedTUIFrame,
  requestTUIContentRender,
  requestTUILayoutRender,
  shouldSuppressTUIFrameRequests,
} from '#/tui/utils/frame-render';
import type { TUIState } from '#/tui/tui-state';

function makeState(isBatchMounting: boolean): TUIState {
  return {
    appState: { isReplaying: false },
    transcriptContainer: {
      isBatchMounting,
    },
    renderer: {
      invalidateFrame: vi.fn(),
    },
  } as unknown as TUIState;
}

describe('frame-render hydrate suppression', () => {
  it('suppresses content/layout frames while batch-mounting transcript', () => {
    const state = makeState(true);
    expect(shouldSuppressTUIFrameRequests(state)).toBe(true);
    requestTUIContentRender(state);
    requestTUILayoutRender(state);
    expect(state.renderer.invalidateFrame).not.toHaveBeenCalled();
  });

  it('forwards frames when not batch-mounting (loading modal can paint)', () => {
    const state = makeState(false);
    expect(shouldSuppressTUIFrameRequests(state)).toBe(false);
    requestTUILayoutRender(state);
    expect(state.renderer.invalidateFrame).toHaveBeenCalledWith('layout');
  });

  it('flushSuppressedTUIFrame always invalidates once', () => {
    const state = makeState(true);
    flushSuppressedTUIFrame(state, 'layout');
    expect(state.renderer.invalidateFrame).toHaveBeenCalledWith('layout');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createTUIState } from '#/tui/liora-tui';
import {
  invalidateTUIFrame,
  requestTUIContentRender,
  requestTUILayoutRender,
  requestTUIScrollRender,
} from '#/tui/utils/frame-render';
import type { AppState } from '#/tui/types';

function fakeAppState(): AppState {
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

describe('frame-render', () => {
  it('routes invalidation intents through the terminal renderer', () => {
    const state = createTUIState({
      initialAppState: fakeAppState(),
      startup: { continueLast: false, yolo: false, auto: false, plan: false },
    });
    const invalidateFrame = vi.spyOn(state.renderer, 'invalidateFrame');

    requestTUIContentRender(state);
    requestTUILayoutRender(state);
    requestTUIScrollRender(state);
    invalidateTUIFrame(state, 'palette');

    expect(invalidateFrame).toHaveBeenNthCalledWith(1, 'content');
    expect(invalidateFrame).toHaveBeenNthCalledWith(2, 'layout');
    expect(invalidateFrame).toHaveBeenNthCalledWith(3, 'scroll');
    expect(invalidateFrame).toHaveBeenNthCalledWith(4, 'palette');
  });
});

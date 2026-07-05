import type { TUIState } from '../tui-state';
import type { FrameInvalidationIntent } from './native-frame-policy';

export function invalidateTUIFrame(state: TUIState, intent: FrameInvalidationIntent): void {
  state.renderer.invalidateFrame(intent);
}

export function requestTUIContentRender(state: TUIState): void {
  state.renderer.invalidateFrame('content');
}

export function requestTUILayoutRender(state: TUIState): void {
  state.renderer.invalidateFrame('layout');
}

export function requestTUIScrollRender(state: TUIState): void {
  state.renderer.invalidateFrame('scroll');
}

export function requestTUIPaletteRender(state: TUIState): void {
  state.renderer.invalidateFrame('palette');
}

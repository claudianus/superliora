import type { NativeInputEvent } from './input-events';
import type { RendererViewportScrollAction } from './viewport-types';

export function rendererViewportActionForInput(
  event: NativeInputEvent,
): RendererViewportScrollAction | undefined {
  if (event.type === 'mouse' && event.action === 'wheel') {
    if (event.button === 'wheel-up') return 'line-up';
    if (event.button === 'wheel-down') return 'line-down';
  }

  if (event.type !== 'key') return undefined;
  if (event.key === 'pageup') return 'page-up';
  if (event.key === 'pagedown') return 'page-down';
  if (event.key === 'home') return 'home';
  if (event.key === 'end') return 'end';
  return undefined;
}

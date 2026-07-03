/**
 * Container that reserves left/right gutter columns around its children,
 * so the chrome (statusline, transcript, panels) lines up with the input
 * box's inner content area instead of butting up against the terminal edge.
 *
 * Generic gutter layout lives in `@harness-kit/tui-renderer`; this app wrapper
 * only supplies Super Kimi Code's canvas background and render-cache policy.
 */

import { RendererGutterContainer, visibleWidth } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import { isRenderCacheEnabled } from '#/tui/utils/render-cache';

export class GutterContainer extends RendererGutterContainer {
  constructor(
    leftPad: number,
    rightPad: number,
  ) {
    super({
      leftPad,
      rightPad,
      paintLine: paintCanvasLine,
      isCacheEnabled: isRenderCacheEnabled,
    });
  }
}

function paintCanvasLine(line: string, width: number): string {
  if (!currentTheme.canvasBackgroundEnabled || width <= 0) return line;
  const padding = Math.max(0, width - visibleWidth(line));
  return currentTheme.bg('background', line + ' '.repeat(padding));
}

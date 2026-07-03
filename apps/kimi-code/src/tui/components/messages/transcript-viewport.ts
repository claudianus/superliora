import { type TranscriptViewportState } from '#/tui/utils/transcript-viewport';
import { RendererTranscriptViewportComponent, visibleWidth } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import { isRenderCacheEnabled } from '#/tui/utils/render-cache';

const TRANSCRIPT_SCROLLBAR_TRACK = '│';
const TRANSCRIPT_SCROLLBAR_THUMB = '█';

export class TranscriptViewportComponent extends RendererTranscriptViewportComponent {
  constructor(
    leftPad: number,
    rightPad: number,
    viewport: TranscriptViewportState,
    getVisibleRows: (width: number) => number,
  ) {
    super({
      viewport,
      getVisibleRows,
      leftPad,
      rightPad,
      scrollbarTrackChar: TRANSCRIPT_SCROLLBAR_TRACK,
      scrollbarThumbChar: TRANSCRIPT_SCROLLBAR_THUMB,
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

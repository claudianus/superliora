import { type TranscriptViewportState } from '#/tui/utils/transcript-viewport';
import {
  ansiTextToCells,
  RendererTranscriptViewportComponent,
  visibleWidth,
  type RendererRegionLine,
} from '#/tui/renderer';

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
      paintRegionLine: paintTranscriptRegionLine,
      isCacheEnabled: isRenderCacheEnabled,
    });
  }
}

function paintCanvasLine(line: string, width: number): string {
  if (!currentTheme.canvasBackgroundEnabled || width <= 0) return line;
  const padding = Math.max(0, width - visibleWidth(line));
  return currentTheme.bg('background', line + ' '.repeat(padding));
}

function paintTranscriptRegionLine(line: string, width: number): RendererRegionLine {
  if (!currentTheme.canvasBackgroundEnabled || width <= 0) {
    return ansiTextToCells(line);
  }
  const background = currentTheme.palette.background;
  const styled = ansiTextToCells(line).map((cell) => ({
    ...cell,
    style: { bg: background, ...cell.style },
  }));
  const padding = Math.max(0, width - visibleWidth(line));
  if (padding <= 0) return styled;
  return [
    ...styled,
    ...Array.from({ length: padding }, () => ({ char: ' ', style: { bg: background } })),
  ];
}

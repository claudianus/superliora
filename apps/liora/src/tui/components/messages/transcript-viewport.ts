import { type TranscriptViewportState } from '#/tui/utils/transcript-viewport';
import {
  RendererTranscriptViewportComponent,
  visibleWidth,
  type Component,
} from '#/tui/renderer';

import {
  IdleStageComponent,
  isEmptyTranscriptChrome,
} from '#/tui/components/chrome/idle-stage';
import { currentTheme } from '#/tui/theme';
import { isRenderCacheEnabled, renderCacheEpoch } from '#/tui/utils/render-cache';

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
      getCacheEpoch: renderCacheEpoch,
    });
  }

  override addChild(component: Component): void {
    // Real transcript content dismisses the empty-state ambient stage so the
    // scene never competes with user/assistant/tool output.
    if (!isEmptyTranscriptChrome(component)) {
      this.dismissIdleStage();
    }
    super.addChild(component);
    this.invalidate();
  }

  /** Drop every IdleStage child (idempotent). */
  dismissIdleStage(): void {
    const idle = this.children.filter((child) => child instanceof IdleStageComponent);
    for (const child of idle) {
      // pi-tui Container.removeChild (not a DOM node).
      // oxlint-disable-next-line unicorn/prefer-dom-node-remove
      this.removeChild(child);
    }
  }
}

function paintCanvasLine(line: string, width: number): string {
  if (!currentTheme.canvasBackgroundEnabled || width <= 0) return line;
  const padding = Math.max(0, width - visibleWidth(line));
  return currentTheme.bg('background', line + ' '.repeat(padding));
}

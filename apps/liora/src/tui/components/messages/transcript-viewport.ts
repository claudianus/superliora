import { type TranscriptViewportState } from '#/tui/utils/transcript-viewport';
import {
  RendererTranscriptViewportComponent,
  visibleWidth,
  type Component,
  type RendererScrollbarGlyphRole,
} from '#/tui/renderer';

import {
  IdleStageComponent,
  isEmptyTranscriptChrome,
} from '#/tui/components/chrome/idle-stage';
import { currentTheme } from '#/tui/theme';
import { isRenderCacheEnabled, renderCacheEpoch } from '#/tui/utils/render-cache';

/**
 * Capsule scrollbar glyphs — soft track, rounded thumb ends, edge cues.
 * Colors come from the live theme via paintScrollbarGlyph.
 */
const TRANSCRIPT_SCROLLBAR_TRACK = '┊';
const TRANSCRIPT_SCROLLBAR_THUMB = '█';

export class TranscriptViewportComponent extends RendererTranscriptViewportComponent {
  private readonly resolveVisibleRows: (width: number) => number;

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
      scrollbarVariant: 'capsule',
      paintScrollbarGlyph: paintTranscriptScrollbarGlyph,
      paintLine: paintCanvasLine,
      isCacheEnabled: isRenderCacheEnabled,
      getCacheEpoch: renderCacheEpoch,
    });
    this.resolveVisibleRows = getVisibleRows;
  }

  /** Transcript region row budget for the current terminal chrome. */
  transcriptRows(width: number): number {
    return this.resolveVisibleRows(width);
  }

  /**
   * Rows the idle night sky should paint: full transcript budget minus
   * non-idle chrome siblings (Welcome / Banner). Prevents Welcome+Idle from
   * overflowing the viewport and leaving a scrollbar on an empty session.
   */
  idleTargetRows(width: number): number {
    const budget = Math.max(0, Math.trunc(this.resolveVisibleRows(width)));
    if (budget === 0) return 0;
    let other = 0;
    for (const child of this.children) {
      if (child instanceof IdleStageComponent) continue;
      other += child.render(width).length;
    }
    // Keep a usable multi-layer scene even when Welcome is tall.
    return Math.max(10, budget - other);
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

/**
 * Theme-aware scrollbar paint: thumb glows with primary/glow, track stays
 * muted, edge cues use particle so the gutter feels alive without noise.
 */
function paintTranscriptScrollbarGlyph(
  role: RendererScrollbarGlyphRole,
  glyph: string,
): string {
  switch (role) {
    case 'thumb':
    case 'thumb-mid':
    case 'thumb-only':
      return currentTheme.boldFg('primary', glyph);
    case 'thumb-top':
    case 'thumb-bottom':
      return currentTheme.fg('glow', glyph);
    case 'cap-top':
    case 'cap-bottom':
      return currentTheme.fg('particle', glyph);
    case 'track':
    default:
      return currentTheme.dimFg('textMuted', glyph);
  }
}

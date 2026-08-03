import { createRendererViewportSnapshot, RendererViewport } from './offset';
import { normalizePositiveRows } from './normalize';
import type {
  RendererTranscriptScrollAction,
  RendererTranscriptViewportOptions,
  RendererViewportScrollAction,
  RendererViewportSnapshot,
} from './types';

export class RendererTranscriptViewport {
  private readonly viewport: RendererViewport;
  private current: RendererViewportSnapshot;
  private readonly lineScrollRows: number;

  constructor(options: RendererTranscriptViewportOptions = {}) {
    this.viewport = new RendererViewport({
      contentRows: options.contentRows,
      viewportRows: options.viewportRows ?? Number.POSITIVE_INFINITY,
      offsetFromBottom: options.offsetFromBottom,
      followOutput: options.followOutput,
    });
    this.current = this.viewport.snapshot();
    this.lineScrollRows = normalizePositiveRows(options.lineScrollRows ?? 3);
  }

  get followOutput(): boolean {
    return this.current.followOutput;
  }

  get offsetFromBottom(): number {
    return this.current.offsetFromBottom;
  }

  get lastContentRows(): number {
    return this.current.contentRows;
  }

  get lastVisibleRows(): number {
    return this.current.viewportRows;
  }

  sync(contentRows: number, viewportRows: number): RendererViewportSnapshot {
    this.current = this.viewport.update({ contentRows, viewportRows });
    return this.current;
  }

  /**
   * Scroll the transcript window. When `amount` is set (wheel storms / tests),
   * it is the row delta for line actions (or page size for page actions).
   * When omitted, line actions use {@link lineScrollRows} and page actions use
   * the current viewport height.
   */
  scroll(action: RendererTranscriptScrollAction, amount?: number): boolean {
    const previous = this.current;
    const rows =
      amount !== undefined
        ? normalizePositiveRows(amount)
        : rendererTranscriptScrollRows(action, this.current.viewportRows, this.lineScrollRows);
    this.current = this.viewport.scroll(
      rendererTranscriptToViewportScrollAction(action),
      rows,
    );
    // No scrollable range (content fits the viewport): the offset stays clamped
    // to 0, so the underlying viewport can only flip followOutput. Reporting
    // that as a position change re-triggers the scroll-paint + settle-refresh
    // chain on every wheel tick and flickers a scrollbar-less transcript.
    return viewportPositionChanged(previous, this.current) && previous.maxOffsetFromBottom > 0;
  }

  jumpToLine(line: number): RendererViewportSnapshot {
    this.current = this.viewport.jumpToLine(line);
    return this.current;
  }

  start(): number {
    return this.current.start;
  }

  snapshot(): RendererViewportSnapshot {
    return this.current;
  }
}

function rendererTranscriptToViewportScrollAction(
  action: RendererTranscriptScrollAction,
): RendererViewportScrollAction {
  if (action === 'top') return 'home';
  if (action === 'bottom') return 'to-bottom';
  return action;
}

function rendererTranscriptScrollRows(
  action: RendererTranscriptScrollAction,
  viewportRows: number,
  lineScrollRows: number,
): number {
  if (action === 'top' || action === 'bottom') return 1;
  if (!Number.isFinite(viewportRows)) return 1;
  const pageRows = Math.max(1, Math.floor(viewportRows) - 1);
  return action === 'line-up' || action === 'line-down'
    ? Math.min(lineScrollRows, pageRows)
    : pageRows;
}

function viewportPositionChanged(
  previous: RendererViewportSnapshot,
  next: RendererViewportSnapshot,
): boolean {
  return previous.followOutput !== next.followOutput ||
    previous.offsetFromBottom !== next.offsetFromBottom;
}

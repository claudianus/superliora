/**
 * Paint-mode flags for transcript virtual-scroll frames.
 *
 * Tool-call cards tick live animation from inside `render()` and may call
 * `rebuildBody()` + `requestRender()`. During pure scroll that is catastrophic:
 * every visible tool rebuilds its body on the scroll paint path, the frame never
 * yields, and the TUI looks permanently frozen (not mere lag).
 *
 * Scroll paint sets {@link suppressLiveToolTicks} so cards only paint cached
 * lines; ambient/content frames still run live ticks normally.
 */

let suppressLiveToolTicks = false;

export interface TranscriptPaintMode {
  readonly suppressLiveToolTicks?: boolean;
}

export function withTranscriptPaintMode<T>(mode: TranscriptPaintMode, run: () => T): T {
  const previous = suppressLiveToolTicks;
  suppressLiveToolTicks = mode.suppressLiveToolTicks === true;
  try {
    return run();
  } finally {
    suppressLiveToolTicks = previous;
  }
}

export function areLiveToolTicksSuppressed(): boolean {
  return suppressLiveToolTicks;
}

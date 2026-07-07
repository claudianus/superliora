import { Text, visibleWidth } from '#/tui/renderer';
import type { RendererRootUI } from '#/tui/renderer';

import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  MOON_SPINNER_FRAMES,
  MOON_SPINNER_INTERVAL_MS,
} from '#/tui/constant/rendering';
import { currentTheme } from '#/tui/theme';
import { appearanceAnimationNow } from '#/tui/utils/appearance-effects';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';
import { renderPulseText } from '#/tui/utils/appearance-effects';

export type SpinnerStyle = 'moon' | 'braille';

export class MoonLoader extends Text {
  private ui: RendererRootUI;
  private frames: string[];
  private interval: number;
  private colorFn?: (s: string) => string;
  private label: string;
  private displayText = '';
  // Inline text is embedded into dense status lines such as swarm progress.
  // Keep tips on the activity-pane row only so they do not crowd progress bars.
  private inlineText = '';
  private tip: string = '';
  private availableWidth = 0;
  private readonly startedAt = Date.now();
  // Once stopped, the spinner freezes and render() no longer overwrites the
  // text — callers use setText() to plant a final ✓/✗ message.
  private stopped = false;

  constructor(
    ui: RendererRootUI,
    style: SpinnerStyle = 'moon',
    colorFn?: (s: string) => string,
    label: string = '',
  ) {
    super('', 1, 0);
    this.ui = ui;
    this.frames = style === 'moon' ? [...MOON_SPINNER_FRAMES] : [...BRAILLE_SPINNER_FRAMES];
    this.interval = style === 'moon' ? MOON_SPINNER_INTERVAL_MS : BRAILLE_SPINNER_INTERVAL_MS;
    this.colorFn = colorFn;
    this.label = label;
    this.refreshDisplay();
  }

  /** No-op — the spinner frame is now derived from the shared animation clock
   *  during each render, so there is no timer to start.  Kept for callers that
   *  call `start()` after construction. */
  start(): void {}

  /** Freezes the spinner.  After `stop()`, `render()` no longer overwrites the
   *  text, so callers can plant a final result line via `setText()`. */
  stop(): void {
    this.stopped = true;
  }

  setLabel(label: string): void {
    this.label = label;
    this.refreshDisplay();
  }

  setColorFn(colorFn: (s: string) => string): void {
    this.colorFn = colorFn;
    this.refreshDisplay();
  }

  setTip(tip: string): void {
    this.tip = tip;
    this.refreshDisplay();
  }

  setAvailableWidth(width: number): void {
    if (this.availableWidth === width) return;
    this.availableWidth = width;
    this.refreshDisplay();
  }

  renderInline(): string {
    if (!this.stopped) this.computeDisplay();
    return this.inlineText;
  }

  /** Spinner glyph only — for dense embeds such as the swarm status line. */
  renderGlyph(): string {
    const frameIndex =
      Math.floor(appearanceAnimationNow() / this.interval) % this.frames.length;
    const frame = this.frames[frameIndex]!;
    return this.colorFn ? this.colorFn(frame) : frame;
  }

  override render(width: number): string[] {
    // Recompute the spinner frame from the animation clock on every render so
    // the spinner animates with the render loop's ticker instead of a private
    // setInterval.  See PREMIUM.md §7.1 (single animation clock).
    // NOTE: only compute the display — do NOT call requestRender() from within
    // render(), which would recurse into the render loop.
    // Once stopped, skip computeDisplay() so a final ✓/✗ message planted via
    // setText() is not overwritten by the spinner frame.
    if (!this.stopped) this.computeDisplay();
    return super.render(width);
  }

  private computeDisplay(): void {
    const frameIndex =
      Math.floor(appearanceAnimationNow() / this.interval) % this.frames.length;
    const frame = this.frames[frameIndex]!;
    const coloredFrame = this.colorFn ? this.colorFn(frame) : frame;
    const elapsed = currentTheme.fg('textDim', ` ${formatElapsedTime(this.startedAt)}`);
    const label = this.label.length > 0
      ? renderPulseText(this.label, `loader:${this.label}`, 'text')
      : '';
    const baseText =
      label.length > 0 ? `${coloredFrame} ${label}${elapsed}` : `${coloredFrame}${elapsed}`;
    this.inlineText = baseText;
    let text = baseText;
    if (this.tip) {
      const withTip = baseText + currentTheme.fg('textDim', this.tip);
      if (this.availableWidth === 0 || visibleWidth(withTip) <= this.availableWidth) {
        text = withTip;
      }
    }
    this.displayText = text;
    this.setText(this.displayText);
  }

  private refreshDisplay(): void {
    this.computeDisplay();
    this.ui.requestRender();
  }
}

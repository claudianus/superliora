/**
 * Renders thinking content in the transcript.
 * Supports live in-place updates while thinking streams, then finalizes
 * without replacing the component.
 * Supports expand/collapse via Ctrl+O (shared with tool output).
 */

import {
  RendererWidthRenderCache,
  Text,
  projectRendererLineWindow,
  truncateToWidth,
  type Component,
  type RendererRootUI,
} from '#/tui/renderer';

import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  MESSAGE_INDENT,
  THINKING_PREVIEW_LINES,
} from '#/tui/constant/rendering';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { appearanceAnimationNow } from '#/tui/utils/appearance-effects';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';
import { isRenderCacheEnabled } from '#/tui/utils/render-cache';

export type ThinkingRenderMode = 'live' | 'finalized';

export class ThinkingComponent implements Component {
  private text: string;
  private showMarker: boolean;
  private mode: ThinkingRenderMode;
  private expanded = false;
  private readonly ui: RendererRootUI | undefined;
  private readonly startedAt: number | undefined;
  private finishedAt: number | undefined;
  // Hold a single Text instance so the renderer's (text, width) -> lines cache
  // actually survives across renders. Re-constructing per render destroys
  // the cache and forces full re-wrap on every frame, which dominates CPU
  // once the transcript accumulates many finalized thinking blocks.
  private readonly textComponent: Text;

  private readonly renderCache = new RendererWidthRenderCache();

  constructor(
    text: string,
    showMarker: boolean = true,
    mode: ThinkingRenderMode = 'finalized',
    ui?: RendererRootUI,
  ) {
    this.text = text;
    this.showMarker = showMarker;
    this.mode = mode;
    this.ui = ui;
    this.startedAt = mode === 'live' ? Date.now() : undefined;
    this.textComponent = new Text(this.styled(text), 0, 0);
  }

  private markRenderDirty(): void {
    this.renderCache.clear();
  }

  invalidate(): void {
    this.markRenderDirty();
    this.textComponent.setText(this.styled(this.text));
  }

  setText(text: string): void {
    if (this.text === text) return;
    this.text = text;
    this.markRenderDirty();
    this.textComponent.setText(this.styled(text));
  }

  private styled(text: string): string {
    return currentTheme.italicFg('textDim', text);
  }

  finalize(): void {
    this.mode = 'finalized';
    if (this.startedAt !== undefined && this.finishedAt === undefined) {
      this.finishedAt = Date.now();
    }
    this.markRenderDirty();
  }

  dispose(): void {}

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.markRenderDirty();
  }

  render(width: number): string[] {
    // In live mode the spinner frame advances with the shared animation clock.
    // Clear the render cache so the spinner glyph is always fresh even when the
    // thinking text itself hasn't changed between frames.  See PREMIUM.md §7.1.
    if (this.mode === 'live') this.markRenderDirty();
    return this.renderCache.render({
      width,
      isCacheEnabled: isRenderCacheEnabled,
      render: () => {
        const contentWidth = Math.max(1, width - MESSAGE_INDENT.length);
        const contentLines = this.text.length > 0 ? this.textComponent.render(contentWidth) : [''];

        if (this.mode === 'live') {
          const visibleLines = this.expanded
            ? projectRendererLineWindow({
              lines: contentLines,
              maxLines: THINKING_PREVIEW_LINES,
              tail: true,
            }).lines
            : [];
          const spinnerFrame =
            Math.floor(appearanceAnimationNow() / BRAILLE_SPINNER_INTERVAL_MS) %
            BRAILLE_SPINNER_FRAMES.length;
          const spinner = currentTheme.fg(
            'textDim',
            `${BRAILLE_SPINNER_FRAMES[spinnerFrame] ?? BRAILLE_SPINNER_FRAMES[0]} `,
          );
          const elapsed = this.renderElapsedSuffix();
          return [
            '',
            spinner + currentTheme.fg('textDim', `thinking...${elapsed}`),
            ...visibleLines.map((line) => MESSAGE_INDENT + line),
          ];
        }

        const lines: string[] = [''];
        for (let i = 0; i < contentLines.length; i++) {
          const p = i === 0 && this.showMarker ? currentTheme.fg('textDim', STATUS_BULLET) : MESSAGE_INDENT;
          lines.push(p + contentLines[i]);
        }

        if (this.expanded) {
          return lines;
        }

        const marker = this.showMarker ? currentTheme.fg('textDim', STATUS_BULLET) : MESSAGE_INDENT;
        const elapsed = this.renderElapsedSuffix();
        const summary = `${marker}${currentTheme.fg('textDim', `thinking complete${elapsed}`)}`;
        const hint = `... (${String(contentLines.length)} lines hidden, ctrl+o to expand)`;
        const indentWidth = Math.min(MESSAGE_INDENT.length, Math.max(0, width));
        const hintWidth = Math.max(0, width - indentWidth);
        return [
          '',
          summary,
          ' '.repeat(indentWidth) + currentTheme.dim(truncateToWidth(hint, hintWidth, '…')),
        ];
      },
    });
  }

  private renderElapsedSuffix(): string {
    if (this.startedAt === undefined) return '';
    return ` ${formatElapsedTime(this.startedAt, this.finishedAt)}`;
  }
}

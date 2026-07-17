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
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPulseText,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';
import { isRenderCacheEnabled, renderCacheEpoch } from '#/tui/utils/render-cache';

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
    // Live mode advances spinner and elapsed-time suffixes from wall clock.
    if (this.mode === 'live') this.markRenderDirty();
    return this.renderCache.render({
      width,
      cacheEpoch: renderCacheEpoch(),
      isCacheEnabled: isRenderCacheEnabled,
      render: () => {
        const contentWidth = Math.max(1, width - MESSAGE_INDENT.length);
        const contentLines = this.text.length > 0 ? this.textComponent.render(contentWidth) : [''];

        if (this.mode === 'live') {
          // Live thinking always shows a short tail glance so work is transparent
          // without waiting for Ctrl+O expand.
          const visibleLines = projectRendererLineWindow({
            lines: contentLines,
            maxLines: this.expanded ? Math.max(THINKING_PREVIEW_LINES, 4) : THINKING_PREVIEW_LINES,
            tail: true,
          }).lines;
          const spinnerFrame =
            Math.floor(appearanceAnimationNow() / BRAILLE_SPINNER_INTERVAL_MS) %
            BRAILLE_SPINNER_FRAMES.length;
          const spinnerGlyph = BRAILLE_SPINNER_FRAMES[spinnerFrame] ?? BRAILLE_SPINNER_FRAMES[0];
          const appearance = getActiveAppearancePreferences();
          const spinner = shouldRenderAmbientEffects(appearance)
            ? renderSpectacularText(`${spinnerGlyph} `, `thinking:spin:${spinnerGlyph}`, appearance, {
                intense: true,
                pace: 'fast',
              })
            : currentTheme.fg('textDim', `${spinnerGlyph} `);
          const elapsed = this.renderElapsedSuffix();
          const charCount = this.text.length;
          // Keep density plain — spectacular restyles the whole label.
          // Pre-styling here used to leak SGR bodies as `[0;1;38;2…` after escape.
          const density = charCount > 0 ? ` · ${String(charCount)}c` : '';
          const thinkingLabel = renderThinkingStatusLabel(`thinking...${elapsed}${density}`);
          return [
            '',
            spinner + thinkingLabel,
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

        const appearance = getActiveAppearancePreferences();
        const marker = !this.showMarker
          ? MESSAGE_INDENT
          : shouldRenderAmbientEffects(appearance)
            ? renderPulseText(STATUS_BULLET, 'thinking:complete', 'textDim')
            : currentTheme.fg('textDim', STATUS_BULLET);
        const elapsed = this.renderElapsedSuffix();
        const summary = `${marker}${renderThinkingStatusLabel(`thinking complete${elapsed}`)}`;
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

function renderThinkingStatusLabel(label: string): string {
  const appearance = getActiveAppearancePreferences();
  if (shouldRenderAmbientEffects(appearance)) {
    return renderSpectacularText(label, `thinking:${label}`, appearance, {
      intense: true,
      pace: 'slow',
    });
  }
  return currentTheme.fg('textDim', label);
}

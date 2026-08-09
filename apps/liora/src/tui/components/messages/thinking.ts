/**
 * Renders thinking content in the transcript.
 * Supports live in-place updates while thinking streams, then finalizes
 * without replacing the component.
 * Supports expand/collapse via Ctrl+O (shared with tool output).
 */

import {
  notifyTranscriptChildGeometryDirty,
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
} from '#/tui/features/appearance/appearance-effects';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';
import { isRenderCacheEnabled, renderCacheEpoch } from '#/tui/utils/render/render-cache';
import { areLiveToolTicksSuppressed } from '#/tui/utils/render/transcript-paint-mode';
import {
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';
import { formatThinkingText } from '#/tui/utils/transcript/transcript-output-format';
import {
  applyPhaseTintLine,
  applyWorkBlockTintLine,
  phaseGutter,
} from '#/tui/features/transcript/transcript-phase-tint';
import { getActiveTranscriptDetail } from '#/tui/features/transcript/transcript-density';

export type ThinkingRenderMode = 'live' | 'finalized';

/** Silence after which live thinking is labeled stalled (wall clock). */
export const THINKING_STALL_AFTER_MS = 30_000;

export class ThinkingComponent implements Component {
  private text: string;
  private showMarker: boolean;
  private mode: ThinkingRenderMode;
  private expanded = false;
  private readonly ui: RendererRootUI | undefined;
  private readonly startedAt: number | undefined;
  private finishedAt: number | undefined;
  /** Last time live thinking text changed — used for stall detection. */
  private lastActivityAt: number | undefined;
  /** Entrance fade clock — independent of elapsed-time tracking. */
  private readonly entranceStartedAtMs = appearanceAnimationNow();
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
    this.lastActivityAt = mode === 'live' ? Date.now() : undefined;
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
    if (this.mode === 'live') {
      this.lastActivityAt = Date.now();
    }
    this.markRenderDirty();
    this.textComponent.setText(this.styled(text));
    notifyTranscriptChildGeometryDirty(this);
  }

  /** Mark live activity without changing text (e.g. host heartbeat). */
  touchActivity(nowMs: number = Date.now()): void {
    if (this.mode !== 'live') return;
    this.lastActivityAt = nowMs;
    this.markRenderDirty();
  }

  private styled(text: string): string {
    // Prose-first italic base, with light lifts for fences / headings / lists
    // so long reasoning stays scannable without shouting.
    return formatThinkingText(text);
  }

  finalize(): void {
    this.mode = 'finalized';
    if (this.startedAt !== undefined && this.finishedAt === undefined) {
      this.finishedAt = Date.now();
    }
    this.markRenderDirty();
    notifyTranscriptChildGeometryDirty(this);
  }

  dispose(): void {}

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    this.markRenderDirty();
    notifyTranscriptChildGeometryDirty(this);
  }

  render(width: number): string[] {
    // Pure-scroll paint: keep the last cached body (no spinner re-encode).
    const scrollPaint = areLiveToolTicksSuppressed();
    // Live mode advances spinner and elapsed-time suffixes from wall clock.
    // Entrance wash also needs per-frame repaint while active.
    if (
      !scrollPaint &&
      (this.mode === 'live' || isTranscriptEntranceActive(this.entranceStartedAtMs))
    ) {
      this.markRenderDirty();
    }
    return this.renderCache.render({
      width,
      // Live/entrance frames animate and repaint every ambient tick (the
      // branch above already clears the cache for them). Finalized blocks
      // are byte-stable, so drop the epoch and let the cache absorb idle
      // ticks instead of re-encoding the block every frame.
      cacheEpoch:
        !scrollPaint &&
        (this.mode === 'live' || isTranscriptEntranceActive(this.entranceStartedAtMs))
          ? renderCacheEpoch()
          : undefined,
      isCacheEnabled: isRenderCacheEnabled,
      render: () => {
        const contentWidth = Math.max(1, width - MESSAGE_INDENT.length);
        const contentLines = this.text.length > 0 ? this.textComponent.render(contentWidth) : [''];
        const appearance = getActiveAppearancePreferences();

        if (this.mode === 'live') {
          const detail = getActiveTranscriptDetail();
          // full: same as finalized — show the whole body while streaming.
          // minimal: status line only. compact+: short tail glance.
          const maxPreview =
            detail === 'full'
              ? contentLines.length
              : detail === 'minimal' && !this.expanded
                ? 0
                : this.expanded
                  ? Math.max(THINKING_PREVIEW_LINES, 4)
                  : detail === 'compact'
                    ? Math.min(2, THINKING_PREVIEW_LINES)
                    : THINKING_PREVIEW_LINES;
          const visibleLines =
            maxPreview === 0
              ? []
              : detail === 'full'
                ? contentLines
                : projectRendererLineWindow({
                    lines: contentLines,
                    maxLines: maxPreview,
                    tail: true,
                  }).lines;
          const spinnerFrame =
            Math.floor(appearanceAnimationNow() / BRAILLE_SPINNER_INTERVAL_MS) %
            BRAILLE_SPINNER_FRAMES.length;
          const spinnerGlyph = BRAILLE_SPINNER_FRAMES[spinnerFrame] ?? BRAILLE_SPINNER_FRAMES[0];
          const spinner = shouldRenderAmbientEffects(appearance)
            ? renderSpectacularText(`${spinnerGlyph} `, `thinking:spin:${spinnerGlyph}`, appearance, {
                intense: true,
                pace: 'fast',
              })
            : currentTheme.fg('textDim', `${spinnerGlyph} `);
          const elapsed = this.renderElapsedSuffix();
          const stall = this.renderStallSuffix();
          const charCount = this.text.length;
          // Keep density plain — spectacular restyles the whole label.
          // Pre-styling here used to leak SGR bodies as `[0;1;38;2…` after escape.
          const density = charCount > 0 ? ` · ${String(charCount)}c` : '';
          const thinkingLabel = renderThinkingStatusLabel(
            `thinking...${elapsed}${stall}${density}`,
          );
          const phaseTag = applyPhaseTintLine(
            `${phaseGutter('thinking')} ${currentTheme.boldFg('primary', 'thinking')}`,
            width,
            'thinking',
          );
          // Leading untinted blank = breath after user; body rows share tools tint.
          const liveLines = [
            '',
            phaseTag,
            spinner + thinkingLabel,
            ...visibleLines.map((line) => MESSAGE_INDENT + line),
          ].map((line, i) => {
            if (i === 0 || i === 1) return line;
            const guttered =
              phaseGutter('thinking') + (line.startsWith(' ') ? line.slice(1) : line);
            return applyWorkBlockTintLine(guttered, width, 'thinking');
          });
          return polishTranscriptLines(liveLines, {
            startedAtMs: this.entranceStartedAtMs,
            kind: 'thinking',
            streaming: true,
            appearance,
          });
        }

        const lines: string[] = [''];
        for (let i = 0; i < contentLines.length; i++) {
          const p = i === 0 && this.showMarker ? currentTheme.fg('textDim', STATUS_BULLET) : MESSAGE_INDENT;
          lines.push(p + contentLines[i]);
        }

        // Settled paths are `['', summary, …]` — index 0 stays untinted breath.
        const tint = (raw: string[]): string[] =>
          raw.map((line, i) => {
            if (i === 0 && line.length === 0) return line;
            const guttered =
              phaseGutter('thinking') + (line.startsWith(' ') ? line.slice(1) : line);
            return applyWorkBlockTintLine(guttered, width, 'thinking');
          });

        if (this.expanded || getActiveTranscriptDetail() === 'full') {
          return polishTranscriptLines(tint(lines), {
            startedAtMs: this.entranceStartedAtMs,
            kind: 'thinking',
            appearance,
          });
        }

        const marker = !this.showMarker
          ? MESSAGE_INDENT
          : shouldRenderAmbientEffects(appearance)
            ? renderPulseText(STATUS_BULLET, 'thinking:complete', 'textDim')
            : currentTheme.fg('textDim', STATUS_BULLET);
        const elapsed = this.renderElapsedSuffix();
        const summary = `${marker}${renderThinkingStatusLabel(`thinking complete${elapsed}`)}`;
        // minimal: one status line only (no "N lines hidden" chrome).
        if (getActiveTranscriptDetail() === 'minimal') {
          return polishTranscriptLines(tint(['', summary]), {
            startedAtMs: this.entranceStartedAtMs,
            kind: 'thinking',
            appearance,
          });
        }
        const hint = `... (${String(contentLines.length)} lines hidden, ctrl+o to expand)`;
        const indentWidth = Math.min(MESSAGE_INDENT.length, Math.max(0, width));
        const hintWidth = Math.max(0, width - indentWidth);
        const collapsed = [
          '',
          summary,
          ' '.repeat(indentWidth) + currentTheme.dim(truncateToWidth(hint, hintWidth, '…')),
        ];
        return polishTranscriptLines(tint(collapsed), {
          startedAtMs: this.entranceStartedAtMs,
          kind: 'thinking',
          appearance,
        });
      },
    });
  }

  private renderElapsedSuffix(): string {
    if (this.startedAt === undefined) return '';
    return ` ${formatElapsedTime(this.startedAt, this.finishedAt)}`;
  }

  private renderStallSuffix(): string {
    if (this.mode !== 'live' || this.lastActivityAt === undefined) return '';
    const silentMs = Date.now() - this.lastActivityAt;
    if (silentMs < THINKING_STALL_AFTER_MS) return '';
    // Show how long since the last token so the freeze is not silent.
    return ` · stalled ${formatElapsedTime(this.lastActivityAt)}`;
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

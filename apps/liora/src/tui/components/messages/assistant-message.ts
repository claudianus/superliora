/**
 * Renders an assistant message using renderer-owned Markdown.
 *
 * Displays a white bullet prefix with markdown content indented
 * to align after the bullet.
 */

import {
  Container,
  Markdown,
  RendererWidthRenderCache,
  measureRendererTranscriptContentWidth,
  renderRendererTranscriptLineBlock,
  type Component,
} from '#/tui/renderer';

import type { AppearancePreferences } from '#/tui/config';
import { MESSAGE_INDENT } from '#/tui/constant/rendering';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { createMarkdownTheme } from '#/tui/theme/pi-tui-theme';
import {
  isRenderCacheEnabled,
  renderCacheEpoch,
} from '#/tui/utils/render/render-cache';
import { areLiveToolTicksSuppressed } from '#/tui/utils/render/transcript-paint-mode';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPulseText,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import {
  appendStreamingCaret,
  streamingCaretActive,
} from '#/tui/features/transcript/streaming-caret';
import {
  applyTurnBoundaryCue,
  isTranscriptEntranceActive,
  isTurnBoundaryCueActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';
import {
  applyPhaseTintLine,
  phaseGutter,
} from '#/tui/features/transcript/transcript-phase-tint';

type AssistantMarkdownOptions = {
  transient?: boolean;
};

export class AssistantMessageComponent implements Component {
  private contentContainer: Container;
  private markdown: Markdown | undefined;
  private markdownTransient = false;
  private lastText = '';
  private lastTransient = false;
  private showBullet: boolean;
  /** Wall-clock mount time — drives the entrance fade wash. */
  private readonly entranceStartedAtMs = appearanceAnimationNow();
  /** Turn-boundary cue anchors set by StreamingUIController (Gap 5). */
  private turnStartCueAtMs: number | undefined;
  private turnEndCueAtMs: number | undefined;

  private readonly renderCache = new RendererWidthRenderCache();
  /**
   * Markdown body lines while streaming — reused across ambient ticks until
   * the draft text or content width changes (avoids re-tokenizing every frame).
   */
  private streamingContentLinesCache:
    | { readonly text: string; readonly contentWidth: number; readonly lines: string[] }
    | undefined;

  constructor(showBullet: boolean = true) {
    this.showBullet = showBullet;
    this.contentContainer = new Container();
  }

  private markRenderDirty(): void {
    this.renderCache.clear();
    this.streamingContentLinesCache = undefined;
  }

  setShowBullet(show: boolean): void {
    if (this.showBullet === show) return;
    this.showBullet = show;
    this.markRenderDirty();
  }

  /** Arm the turn-start settle — paints the first visible line briefly. */
  markTurnStartCue(startedAtMs: number): void {
    this.turnStartCueAtMs = startedAtMs;
    this.markRenderDirty();
  }

  /** Arm the turn-end settle — paints the last visible line briefly. */
  markTurnEndCue(startedAtMs: number): void {
    this.turnEndCueAtMs = startedAtMs;
    this.markRenderDirty();
  }

  updateContent(text: string, opts?: AssistantMarkdownOptions): void {
    const displayText = text.trim();
    const transient = opts?.transient === true;

    if (displayText === this.lastText && transient === this.lastTransient) return;

    this.lastText = displayText;
    this.lastTransient = transient;
    this.markRenderDirty();

    if (displayText.length === 0) {
      this.contentContainer.clear();
      this.markdown = undefined;
      this.markdownTransient = false;
      return;
    }

    if (this.markdown === undefined || this.markdownTransient !== transient) {
      this.contentContainer.clear();
      this.markdown = new Markdown(displayText, 0, 0, createMarkdownTheme({ transient }));
      this.markdownTransient = transient;
      this.contentContainer.addChild(this.markdown);
      return;
    }

    this.markdown.setText(displayText);
  }

  invalidate(): void {
    // Markdown caches ANSI colour codes keyed on (text, width).  When the
    // theme changes the cached strings contain stale colours, so we rebuild
    // the Markdown child with the new theme while preserving transient mode.
    this.markRenderDirty();
    this.contentContainer.clear();
    this.markdown = undefined;

    if (this.lastText.trim().length > 0) {
      this.markdown = new Markdown(
        this.lastText.trim(),
        0,
        0,
        createMarkdownTheme({ transient: this.lastTransient }),
      );
      this.markdownTransient = this.lastTransient;
      this.contentContainer.addChild(this.markdown);
    }
  }

  /**
   * Overflow eviction: drop paint caches without tearing down Markdown.
   * Full invalidate() reallocates the tree and is wrong for soft-evict.
   */
  softDropPaintCaches(): void {
    // Density cycle (Ctrl+O) and theme swaps: drop width/ANSI caches without
    // tearing down the Markdown tree so phase chrome re-reads live density.
    this.markRenderDirty();
    this.markdown?.softDropPaintCaches?.();
    this.contentContainer.softDropPaintCaches?.();
  }

  render(width: number): string[] {
    if (this.lastText.trim().length === 0) return [];

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    // Pure-scroll paint: hit width cache only (no caret/entrance re-encode).
    const scrollPaint = areLiveToolTicksSuppressed();

    // While streaming (transient) or still washing in, repaint every ambient tick.
    // When finalized and entrance is done, drop the epoch for O(1) cached renders.
    const streaming = !scrollPaint && this.lastTransient && streamingCaretActive();
    const entranceActive = !scrollPaint && isTranscriptEntranceActive(this.entranceStartedAtMs);
    const cueActive =
      !scrollPaint &&
      (isTurnBoundaryCueActive(this.turnStartCueAtMs) ||
        isTurnBoundaryCueActive(this.turnEndCueAtMs));
    const animated = streaming || entranceActive || cueActive;
    return this.renderCache.render({
      width: safeWidth,
      cacheEpoch: animated ? renderCacheEpoch() : undefined,
      isCacheEnabled: isRenderCacheEnabled,
      render: () => {
        const appearance = getActiveAppearancePreferences();
        const prefix = !this.showBullet
          ? MESSAGE_INDENT
          : shouldRenderAmbientEffects(appearance) && !scrollPaint
            ? this.markdownTransient
              ? renderPulseText(STATUS_BULLET, 'assistant:bullet:live', 'text', appearance)
              : renderSpectacularText(STATUS_BULLET, 'assistant:bullet', appearance, {
                  intense: false,
                  pace: 'slow',
                })
            : currentTheme.fg('text', STATUS_BULLET);
        // Reserve a column for the pulsing caret while streaming so it does not
        // get truncated off the end of the last content line.
        const caretReserve = streaming ? 3 : 0;
        const contentWidth = Math.max(
          1,
          measureRendererTranscriptContentWidth({ width: safeWidth, prefix }) - caretReserve,
        );
        // Ambient ticks only need caret/tail-glow refresh; reuse markdown lines
        // until the server draft or width actually changes.
        let contentLines: string[];
        if (
          streaming &&
          this.streamingContentLinesCache !== undefined &&
          this.streamingContentLinesCache.text === this.lastText &&
          this.streamingContentLinesCache.contentWidth === contentWidth
        ) {
          contentLines = this.streamingContentLinesCache.lines;
        } else {
          contentLines = this.contentContainer.render(contentWidth);
          if (streaming) {
            this.streamingContentLinesCache = {
              text: this.lastText,
              contentWidth,
              lines: contentLines,
            };
          } else {
            this.streamingContentLinesCache = undefined;
          }
        }

        const lines = streaming
          ? appendStreamingCaret(contentLines, contentWidth)
          : contentLines;

        const blocked = renderRendererTranscriptLineBlock({
          width: safeWidth,
          prefix,
          continuationPrefix: MESSAGE_INDENT,
          lines,
          leadingBlank: true,
          truncateMark: '…',
        });

        // Answer is visually separate from the thinking→tools work block:
        // untinted blank above + below; tinted body in between.
        const phaseTag = applyPhaseTintLine(
          `${phaseGutter('answer')} ${currentTheme.boldFg('primary', 'answer')}`,
          safeWidth,
          'answer',
        );
        const tintedBody = blocked.map((line, i) => {
          // Keep leading breath untinted so the work block ends cleanly.
          if (line.length === 0) return line;
          const guttered =
            i <= 1 ? line : phaseGutter('answer') + (line.startsWith(' ') ? line.slice(1) : line);
          return applyPhaseTintLine(guttered, safeWidth, 'answer');
        });
        const tinted =
          tintedBody.length > 0 && tintedBody[0] === ''
            ? [tintedBody[0]!, phaseTag, ...tintedBody.slice(1)]
            : [phaseTag, ...tintedBody];

        // Answer body always renders in full at every transcript density.
        // minimal/compact only collapse thinking + tool/chain chrome — never answers.
        // Trailing breath — answer never sticks to the next user/work block.
        const withBreathing =
          tinted.length > 0 && tinted[tinted.length - 1] === '' ? tinted : [...tinted, ''];

        if (scrollPaint) return withBreathing;

        return this.applyTurnBoundaryCues(
          polishTranscriptLines(withBreathing, {
            startedAtMs: this.entranceStartedAtMs,
            kind: 'assistant',
            streaming: this.lastTransient,
            appearance,
          }),
          appearance,
        );
      },
    });
  }

  /** Turn boundary settles: first line on start, last line on end (Gap 5). */
  private applyTurnBoundaryCues(lines: string[], appearance: AppearancePreferences): string[] {
    const startActive = isTurnBoundaryCueActive(this.turnStartCueAtMs, appearance);
    const endActive = isTurnBoundaryCueActive(this.turnEndCueAtMs, appearance);
    if (!startActive && !endActive) return lines;
    const next = [...lines];
    if (startActive) {
      const first = firstVisibleLineIndex(next);
      if (first >= 0) {
        next[first] = applyTurnBoundaryCue(next[first]!, this.turnStartCueAtMs, appearance);
      }
    }
    if (endActive) {
      const last = lastVisibleLineIndex(next);
      if (last >= 0) {
        next[last] = applyTurnBoundaryCue(next[last]!, this.turnEndCueAtMs, appearance);
      }
    }
    return next;
  }
}

function firstVisibleLineIndex(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim().length > 0) return i;
  }
  return -1;
}

function lastVisibleLineIndex(lines: readonly string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim().length > 0) return i;
  }
  return -1;
}

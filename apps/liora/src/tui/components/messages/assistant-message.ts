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
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  renderPulseText,
  renderSpectacularText,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import {
  applyTurnBoundaryCue,
  isTranscriptEntranceActive,
  isTurnBoundaryCueActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';

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

  constructor(showBullet: boolean = true) {
    this.showBullet = showBullet;
    this.contentContainer = new Container();
  }

  private markRenderDirty(): void {
    this.renderCache.clear();
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

  render(width: number): string[] {
    if (this.lastText.trim().length === 0) return [];

    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    // While streaming (transient) or still washing in, repaint every ambient tick.
    // When finalized and entrance is done, drop the epoch for O(1) cached renders.
    const streaming = this.lastTransient && caretActive();
    const entranceActive = isTranscriptEntranceActive(this.entranceStartedAtMs);
    const cueActive =
      isTurnBoundaryCueActive(this.turnStartCueAtMs) ||
      isTurnBoundaryCueActive(this.turnEndCueAtMs);
    const animated = streaming || entranceActive || cueActive;
    return this.renderCache.render({
      width: safeWidth,
      cacheEpoch: animated ? renderCacheEpoch() : undefined,
      isCacheEnabled: isRenderCacheEnabled,
      render: () => {
        const appearance = getActiveAppearancePreferences();
        const prefix = !this.showBullet
          ? MESSAGE_INDENT
          : shouldRenderAmbientEffects(appearance)
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
        const contentLines = this.contentContainer.render(contentWidth);

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

        return this.applyTurnBoundaryCues(
          polishTranscriptLines(blocked, {
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

/** Whether the streaming caret should render in the current environment. */
function caretActive(): boolean {
  if (!motionEffectsAllowed()) return false;
  return resolveQualityAdjustedAmbientEffectMode(getActiveAppearancePreferences()) !== 'off';
}

/** Kinetic caret — block + dual spark trail so catch-up is impossible to miss. */
const STREAMING_CARET = '▌';
const CARET_PULSE_INTERVAL_MS = 280;
const CARET_TRAIL = ['·', '˙', '˚', '•'] as const;
const CARET_TRAIL_OUTER = ['˙', '·', '˚'] as const;

/**
 * Append a pulsing caret (+ dual micro trail) to the last non-empty content line.
 * Triangle-wave brand glow on the shared animation clock.
 */
function appendStreamingCaret(lines: readonly string[], _contentWidth: number): readonly string[] {
  if (lines.length === 0) return lines;
  let lastIndex = lines.length - 1;
  while (lastIndex > 0 && lines[lastIndex]!.trim().length === 0) {
    lastIndex--;
  }
  const now = appearanceAnimationNow();
  const phase = (Math.sin((now / CARET_PULSE_INTERVAL_MS) * Math.PI) + 1) / 2;
  const hot = phase > 0.48;
  const caret = currentTheme.boldFg(hot ? 'glow' : 'gradientStart', STREAMING_CARET);
  const trailGlyph = CARET_TRAIL[Math.floor(now / 70) % CARET_TRAIL.length] ?? '·';
  const outerGlyph = CARET_TRAIL_OUTER[Math.floor(now / 95) % CARET_TRAIL_OUTER.length] ?? '˙';
  const trail = currentTheme.fg(hot ? 'primary' : 'particle', trailGlyph);
  const outer = currentTheme.fg(hot ? 'glow' : 'primary', outerGlyph);
  const next = [...lines];
  next[lastIndex] = `${lines[lastIndex]}${outer}${trail}${caret}`;
  return next;
}

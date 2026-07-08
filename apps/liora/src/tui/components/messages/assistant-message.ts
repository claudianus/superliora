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

import { MESSAGE_INDENT } from '#/tui/constant/rendering';
import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { createMarkdownTheme } from '#/tui/theme/pi-tui-theme';
import {
  isRenderCacheEnabled,
  renderCacheEpoch,
} from '#/tui/utils/render-cache';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';

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

    // While streaming (transient), the caret pulses on the animation clock, so
    // the cache must repaint each ambient tick. When finalized, drop the epoch
    // so an unchanged message returns to O(1) cached renders.
    const streaming = this.lastTransient && caretActive();
    return this.renderCache.render({
      width: safeWidth,
      cacheEpoch: streaming ? renderCacheEpoch() : undefined,
      isCacheEnabled: isRenderCacheEnabled,
      render: () => {
        const prefix = this.showBullet ? currentTheme.fg('text', STATUS_BULLET) : MESSAGE_INDENT;
        // Reserve a column for the pulsing caret while streaming so it does not
        // get truncated off the end of the last content line.
        const caretReserve = streaming ? 1 : 0;
        const contentWidth = Math.max(
          1,
          measureRendererTranscriptContentWidth({ width: safeWidth, prefix }) - caretReserve,
        );
        const contentLines = this.contentContainer.render(contentWidth);

        const lines = streaming
          ? appendStreamingCaret(contentLines, contentWidth)
          : contentLines;

        return renderRendererTranscriptLineBlock({
          width: safeWidth,
          prefix,
          continuationPrefix: MESSAGE_INDENT,
          lines,
          leadingBlank: true,
          truncateMark: '…',
        });
      },
    });
  }
}

/** Whether the streaming caret should render in the current environment. */
function caretActive(): boolean {
  if (!motionEffectsAllowed()) return false;
  return resolveQualityAdjustedAmbientEffectMode(getActiveAppearancePreferences()) !== 'off';
}

/** A pulsing caret block appended to the last content line while streaming. */
const STREAMING_CARET = '▍';
const CARET_PULSE_INTERVAL_MS = 560;

/**
 * Append a pulsing caret to the last non-empty content line. The caret fades
 * in and out via a triangle wave on the shared animation clock, signalling
 * that the assistant is actively composing.
 */
function appendStreamingCaret(lines: readonly string[], contentWidth: number): readonly string[] {
  if (lines.length === 0) return lines;
  // Find the last line with visible content.
  let lastIndex = lines.length - 1;
  while (lastIndex > 0 && lines[lastIndex]!.trim().length === 0) {
    lastIndex--;
  }
  const phase = (Math.sin(appearanceAnimationNow() / CARET_PULSE_INTERVAL_MS * Math.PI) + 1) / 2;
  const token = phase > 0.5 ? 'gradientStart' : 'textDim';
  const caret = currentTheme.boldFg(token, STREAMING_CARET);
  const next = [...lines];
  next[lastIndex] = `${lines[lastIndex]}${caret}`;
  return next;
}

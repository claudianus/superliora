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
import { isRenderCacheEnabled } from '#/tui/utils/render-cache';

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

    return this.renderCache.render({
      width: safeWidth,
      isCacheEnabled: isRenderCacheEnabled,
      render: () => {
        const prefix = this.showBullet ? currentTheme.fg('text', STATUS_BULLET) : MESSAGE_INDENT;
        const contentWidth = measureRendererTranscriptContentWidth({ width: safeWidth, prefix });
        const contentLines = this.contentContainer.render(contentWidth);

        return renderRendererTranscriptLineBlock({
          width: safeWidth,
          prefix,
          continuationPrefix: MESSAGE_INDENT,
          lines: contentLines,
          leadingBlank: true,
          truncateMark: '…',
        });
      },
    });
  }
}

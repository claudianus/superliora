/**
 * Renders a user message in the transcript.
 */

import {
  RendererWidthRenderCache,
  Spacer,
  Text,
  measureRendererTranscriptContentWidth,
  renderRendererTranscriptLineBlock,
  visibleWidth,
  type Component,
} from '#/tui/renderer';

import { ImageThumbnail } from '#/tui/components/media/image-thumbnail';
import { USER_MESSAGE_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ImageAttachment } from '#/tui/utils/image-attachment-store';
import { isRenderCacheEnabled } from '#/tui/utils/render-cache';
import {
  getActiveAppearancePreferences,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

export class UserMessageComponent implements Component {
  private text: string;
  private readonly bullet?: string;
  private spacerComponent: Spacer;
  private imageThumbnails: ImageThumbnail[];

  private readonly renderCache = new RendererWidthRenderCache();

  constructor(text: string, images?: ImageAttachment[], bullet?: string) {
    this.text = text;
    this.bullet = bullet;
    this.spacerComponent = new Spacer(1);
    this.imageThumbnails = images?.map((img) => new ImageThumbnail(img)) ?? [];
  }

  private markRenderDirty(): void {
    this.renderCache.clear();
  }

  invalidate(): void {
    this.markRenderDirty();
    for (const img of this.imageThumbnails) {
      img.invalidate?.();
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    return this.renderCache.render({
      width: safeWidth,
      isCacheEnabled: isRenderCacheEnabled,
      render: () => {
        const marker = this.bullet ?? USER_MESSAGE_BULLET;
        const appearance = getActiveAppearancePreferences();
        const bullet =
          marker.length === 0
            ? ''
            : shouldRenderAmbientEffects(appearance)
              ? renderSpectacularText(marker, 'user:bullet', appearance, {
                  intense: true,
                  pace: 'slow',
                })
              : currentTheme.boldFg('roleUser', marker);
        const bulletWidth = visibleWidth(bullet);
        const contentWidth = measureRendererTranscriptContentWidth({
          width: safeWidth,
          prefix: bullet,
        });
        const continuationPrefix = ' '.repeat(bulletWidth);

        const lines: string[] = [];

        // Spacer
        for (const line of this.spacerComponent.render(safeWidth)) {
          lines.push(line);
        }

        // Text is re-dyed from the current theme; invalidate() (theme change)
        // clears the render cache so the new colours are picked up.
        const coloredText = currentTheme.boldFg('roleUser', this.text);
        const textLines = new Text(coloredText, 0, 0).render(contentWidth);
        lines.push(...renderRendererTranscriptLineBlock({
          width: safeWidth,
          prefix: bullet,
          continuationPrefix,
          lines: textLines,
          truncateMark: '…',
        }));

        // Images — indented to align with text after the bullet
        for (const thumbnail of this.imageThumbnails) {
          const imageLines = thumbnail.render(contentWidth);
          lines.push(...renderRendererTranscriptLineBlock({
            width: safeWidth,
            prefix: continuationPrefix,
            continuationPrefix,
            lines: imageLines,
            truncateMark: '…',
            preserveLine: isImageLine,
          }));
        }
        return lines;
      },
    });
  }
}

function isImageLine(line: string): boolean {
  return (
    line.includes('\u001B_G') ||
    line.includes('\u001B]1337;File=') ||
    line.includes('\u001B]1337;MultipartFile=')
  );
}

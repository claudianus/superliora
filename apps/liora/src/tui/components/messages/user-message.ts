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
  private readonly timestamp?: number;
  private spacerComponent: Spacer;
  private imageThumbnails: ImageThumbnail[];

  private readonly renderCache = new RendererWidthRenderCache();
  private lastTimestampMarker = '';

  constructor(text: string, images?: ImageAttachment[], bullet?: string, timestamp?: number) {
    this.text = text;
    this.bullet = bullet;
    this.timestamp = timestamp;
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

    // The marker depends on appearance prefs (and theme); clear the width
    // cache when it changes so a `/appearance timestamps` toggle repaints.
    const timestampMarker = this.resolveTimestampMarker();
    if (timestampMarker !== this.lastTimestampMarker) {
      this.markRenderDirty();
      this.lastTimestampMarker = timestampMarker;
    }

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
        const headerPrefix =
          timestampMarker.length === 0 ? bullet : `${bullet}${timestampMarker} `;
        const bulletWidth = visibleWidth(headerPrefix);
        const contentWidth = measureRendererTranscriptContentWidth({
          width: safeWidth,
          prefix: headerPrefix,
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
          prefix: headerPrefix,
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

  /** Muted `HH:MM` marker for the header line; empty when hidden. */
  private resolveTimestampMarker(): string {
    if (this.timestamp === undefined) return '';
    if (!getActiveAppearancePreferences().showTimestamps) return '';
    return currentTheme.fg('textMuted', formatClockTime(this.timestamp));
  }
}

/** Formats epoch milliseconds as a zero-padded 24-hour local-time `HH:MM`. */
export function formatClockTime(epochMs: number): string {
  const date = new Date(epochMs);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function isImageLine(line: string): boolean {
  return (
    line.includes('\u001B_G') ||
    line.includes('\u001B]1337;File=') ||
    line.includes('\u001B]1337;MultipartFile=')
  );
}

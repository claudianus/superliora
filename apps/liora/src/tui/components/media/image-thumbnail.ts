/**
 * Transcript-side rendering of a pasted image.
 *
 * The cell compositor only understands SGR and OSC-8, so raw kitty/iTerm2
 * inline-image escapes render as garbled base64 cells. Until the renderer
 * grows a first-class image channel, every terminal gets the same
 * dependency-free half-block truecolor preview: PNG bytes are decoded
 * locally and drawn with `▀` cells (two pixels per cell).
 *
 * Size is capped so a single screenshot cannot monopolize the viewport:
 * the width cap follows the responsive layout tier (24–72 columns) and
 * the height stays at 12 rows.
 * Non-PNG or undecodable attachments keep the one-line text marker
 * matching the placeholder the user sees in the input box.
 */

import { Text, detectNativeTerminalColorMode, type Component } from '#/tui/renderer';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import type { ImageAttachment } from '#/tui/utils/image-attachment-store';
import { renderHalfBlockPreview } from '#/utils/image/half-block-preview';
import { decodePng, type DecodedPng } from '#/utils/image/png-decode';

const MAX_IMAGE_ROWS = 12;

/**
 * Preview width cap per responsive tier. Wider terminals spend more of the
 * transcript column on the image (Bloomberg-density on ultrawide), while
 * narrow terminals keep the preview from swallowing the message.
 */
const IMAGE_PREVIEW_WIDTH_BY_TIER = {
  tiny: 24,
  compact: 32,
  standard: 40,
  wide: 56,
  ultrawide: 72,
} as const;

export class ImageThumbnail implements Component {
  private readonly attachment: ImageAttachment;
  private lastRenderWidth = 80;
  private lastBuiltWidth: number | undefined;
  private lastBuiltTruecolor: boolean | undefined;
  private lastBuiltLines: string[] | undefined;
  private decoded: DecodedPng | undefined;
  private decodeFailed = false;

  constructor(attachment: ImageAttachment) {
    this.attachment = attachment;
    this.rebuild(this.lastRenderWidth, this.detectTruecolor());
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    this.lastRenderWidth = safeWidth;

    const truecolor = this.detectTruecolor();
    if (
      this.lastBuiltWidth !== safeWidth ||
      this.lastBuiltTruecolor !== truecolor ||
      this.lastBuiltLines === undefined
    ) {
      this.rebuild(safeWidth, truecolor);
    }

    return this.lastBuiltLines ?? [''];
  }

  invalidate(): void {
    this.lastBuiltLines = undefined;
    this.decoded = undefined;
    this.decodeFailed = false;
    this.rebuild(this.lastRenderWidth, this.detectTruecolor());
  }

  private detectTruecolor(): boolean {
    return detectNativeTerminalColorMode(process.env) === 'truecolor';
  }

  private rebuild(width: number, truecolor: boolean): void {
    this.lastBuiltLines = this.buildLines(width, truecolor);
    this.lastBuiltWidth = width;
    this.lastBuiltTruecolor = truecolor;
  }

  private buildLines(width: number, truecolor: boolean): string[] {
    if (width <= 0) return [''];
    if (this.attachment.mime !== 'image/png') return this.fallbackLines(width);

    const decoded = this.decode();
    if (decoded === undefined) return this.fallbackLines(width);

    const tier = resolveResponsiveLayout({ width });
    return renderHalfBlockPreview(decoded, {
      maxWidth: Math.max(1, Math.min(width, IMAGE_PREVIEW_WIDTH_BY_TIER[tier])),
      maxHeightRows: MAX_IMAGE_ROWS,
      truecolor,
    });
  }

  private decode(): DecodedPng | undefined {
    if (this.decoded !== undefined) return this.decoded;
    if (this.decodeFailed) return undefined;
    try {
      this.decoded = decodePng(this.attachment.bytes);
      return this.decoded;
    } catch {
      this.decodeFailed = true;
      return undefined;
    }
  }

  private fallbackLines(width: number): string[] {
    return new Text(currentTheme.fg('accent', this.attachment.placeholder), 0, 0).render(width);
  }
}

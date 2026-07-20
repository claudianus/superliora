/**
 * Transcript-side rendering of a pasted image.
 *
 * The cell compositor only understands SGR and OSC-8, so raw kitty/iTerm2
 * inline-image escapes would render as garbled base64 cells. Kitty-capable
 * truecolor terminals instead use the Unicode placeholder protocol: the PNG
 * is transmitted once through a raw graphics channel that bypasses the
 * compositor, and the preview is plain placeholder text cells the compositor
 * diffs like any other text. Every other terminal gets the same
 * dependency-free half-block truecolor preview: PNG bytes are decoded
 * locally and drawn with `▀` cells (two pixels per cell).
 *
 * Size is capped so a single screenshot cannot monopolize the viewport:
 * the width cap follows the responsive layout tier (24–72 columns) and
 * the height stays at 12 rows.
 * Non-PNG or undecodable attachments keep the one-line text marker
 * matching the placeholder the user sees in the input box.
 */

import { emitKittyGraphics } from '#/tui/media/kitty-graphics-channel';
import {
  Text,
  detectNativeTerminalColorMode,
  encodeKittyPlaceholderLines,
  encodeKittyPlaceholderTransmit,
  type Component,
} from '#/tui/renderer';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import type { ImageAttachment } from '#/tui/utils/image-attachment-store';
import { resolveImageProtocol } from '#/tui/utils/image-protocol-detect';
import { renderHalfBlockPreview } from '#/utils/image/half-block-preview';
import { decodePng, type DecodedPng } from '#/utils/image/png-decode';
import { computePreviewCellSize } from '#/utils/image/preview-size';

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

/**
 * Image ids already transmitted with a virtual placement. Transmission
 * happens once per id; the image stays in terminal memory until the
 * alternate screen is torn down.
 */
const transmittedImageIds = new Set<number>();

/** Test support: forget recorded transmissions so tests re-transmit. */
export function resetKittyPlaceholderTransmissions(): void {
  transmittedImageIds.clear();
}

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
    // Resets the cached lines but not transmittedImageIds: the image stays in
    // terminal memory until alt-screen teardown, so re-transmitting is
    // unnecessary. Per-image deletion (a=d) on undo is future work.
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
    const maxWidth = Math.max(1, Math.min(width, IMAGE_PREVIEW_WIDTH_BY_TIER[tier]));
    if (truecolor) {
      const kittyLines = this.kittyPlaceholderLines(decoded, maxWidth);
      if (kittyLines !== undefined) return kittyLines;
    }
    return renderHalfBlockPreview(decoded, {
      maxWidth,
      maxHeightRows: MAX_IMAGE_ROWS,
      truecolor,
    });
  }

  /**
   * Kitty Unicode placeholder rendering: transmit the PNG once with a virtual
   * placement, then return plain placeholder text lines. Returns undefined
   * when the terminal is not kitty-capable or no raw graphics channel is
   * installed, so the caller falls back to half-block rendering.
   */
  private kittyPlaceholderLines(decoded: DecodedPng, maxWidth: number): string[] | undefined {
    if (resolveImageProtocol() !== 'kitty') return undefined;
    const { columns, rows } = computePreviewCellSize(
      decoded.width,
      decoded.height,
      maxWidth,
      MAX_IMAGE_ROWS,
    );
    if (!transmittedImageIds.has(this.attachment.id)) {
      const base64 = Buffer.from(this.attachment.bytes).toString('base64');
      const sent = emitKittyGraphics(
        encodeKittyPlaceholderTransmit({ id: this.attachment.id, base64, columns, rows }),
      );
      if (!sent) return undefined;
      transmittedImageIds.add(this.attachment.id);
    }
    return encodeKittyPlaceholderLines({ id: this.attachment.id, columns, rows });
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

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
  encodeRendererInlineImage,
  type Component,
} from '#/tui/renderer';
import { resolveResponsiveLayout } from '#/tui/controllers/layout/responsive-layout';
import { currentTheme } from '#/tui/theme';
import type { ImageAttachment } from '#/tui/utils/image/image-attachment-store';
import { resolveImageProtocol } from '#/tui/utils/image/image-protocol-detect';
import { renderHalfBlockPreview } from '#/utils/image/half-block-preview';
import { decodeImageRgba } from '#/utils/image/prepare-pasted-image';
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
  private asyncDecodeStarted = false;

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
    this.asyncDecodeStarted = false;
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

    const decoded = this.decodeSync();
    if (decoded === undefined) {
      // Kick async decode for JPEG/WebP/GIF so the next render can paint a
      // real half-block raster instead of a filename chip.
      this.ensureAsyncDecode();
      return this.fallbackLines(width);
    }

    const tier = resolveResponsiveLayout({ width });
    const maxWidth = Math.max(1, Math.min(width, IMAGE_PREVIEW_WIDTH_BY_TIER[tier]));
    if (truecolor) {
      const protocol = resolveImageProtocol();
      if (protocol === 'kitty') {
        const kittyLines = this.kittyPlaceholderLines(decoded, maxWidth);
        if (kittyLines !== undefined) return kittyLines;
      } else if (protocol === 'iterm2') {
        const itermLines = this.iterm2InlineLines(decoded, maxWidth);
        if (itermLines !== undefined) return itermLines;
      }
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
    const { columns, rows } = computePreviewCellSize(
      decoded.width,
      decoded.height,
      maxWidth,
      MAX_IMAGE_ROWS,
    );
    if (!transmittedImageIds.has(this.attachment.id)) {
      // Kitty placeholder transmit expects PNG; re-encode only when needed.
      const pngBytes = this.attachment.mime === 'image/png' ? this.attachment.bytes : undefined;
      if (pngBytes === undefined) return undefined;
      const base64 = Buffer.from(pngBytes).toString('base64');
      const sent = emitKittyGraphics(
        encodeKittyPlaceholderTransmit({ id: this.attachment.id, base64, columns, rows }),
      );
      if (!sent) return undefined;
      transmittedImageIds.add(this.attachment.id);
    }
    return encodeKittyPlaceholderLines({ id: this.attachment.id, columns, rows });
  }

  /**
   * iTerm2 / WezTerm / Windows Terminal inline-image OSC 1337 sequence.
   * Emitted once through the raw graphics channel; subsequent renders keep
   * a compact caption so the cell compositor does not re-diff base64.
   */
  private iterm2InlineLines(decoded: DecodedPng, maxWidth: number): string[] | undefined {
    const { columns, rows } = computePreviewCellSize(
      decoded.width,
      decoded.height,
      maxWidth,
      MAX_IMAGE_ROWS,
    );
    if (!transmittedImageIds.has(this.attachment.id)) {
      const format =
        this.attachment.mime === 'image/jpeg'
          ? 'jpeg'
          : this.attachment.mime === 'image/gif'
            ? 'gif'
            : this.attachment.mime === 'image/webp'
              ? 'webp'
              : 'png';
      const encoded = encodeRendererInlineImage('iterm2', {
        data: this.attachment.bytes,
        format,
        widthCells: columns,
        heightCells: rows,
        preserveAspectRatio: true,
      });
      const sent = emitKittyGraphics(encoded.output);
      if (!sent) return undefined;
      transmittedImageIds.add(this.attachment.id);
    }
    // Reserve vertical space with blank rows so the inline image is not
    // immediately overwritten by the next transcript cell.
    const lines: string[] = [];
    for (let i = 0; i < rows; i += 1) lines.push(' '.repeat(columns));
    return lines;
  }

  private decodeSync(): DecodedPng | undefined {
    if (this.decoded !== undefined) return this.decoded;
    if (this.decodeFailed) return undefined;
    // Sync path: dependency-free PNG only (fast path for screenshots).
    if (this.attachment.mime !== 'image/png') return undefined;
    try {
      this.decoded = decodePng(this.attachment.bytes);
      return this.decoded;
    } catch {
      this.decodeFailed = true;
      return undefined;
    }
  }

  private ensureAsyncDecode(): void {
    if (this.asyncDecodeStarted || this.decoded !== undefined || this.decodeFailed) return;
    this.asyncDecodeStarted = true;
    void decodeImageRgba(this.attachment.bytes, this.attachment.mime).then((rgba) => {
      if (rgba === null) {
        this.decodeFailed = true;
        return;
      }
      this.decoded = {
        width: rgba.width,
        height: rgba.height,
        pixels: rgba.pixels,
      };
      this.lastBuiltLines = undefined;
      // Next host render pass will rebuild with real pixels.
    });
  }

  private fallbackLines(width: number): string[] {
    return new Text(currentTheme.fg('accent', this.attachment.placeholder), 0, 0).render(width);
  }
}

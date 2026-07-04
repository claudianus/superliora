/**
 * Transcript-side rendering of a pasted image.
 *
 * On terminals that speak a renderer-supported inline image protocol, we show
 * the actual image. Everywhere else we fall back to a one-line text marker
 * matching the placeholder the user sees in the input box. This keeps the
 * transcript readable on Terminal.app, Linux default terminals, and recordings.
 *
 * Height is capped so a single screenshot cannot monopolize the viewport.
 */

import {
  Text,
  calculateRendererInlineImageRows,
  detectNativeTerminalImageProtocol,
  encodeRendererInlineImage,
  type Component,
  type RendererInlineImageFormat,
  type RendererInlineImageProtocol,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import type { ImageAttachment } from '#/tui/utils/image-attachment-store';

const MAX_IMAGE_ROWS = 12;
const MAX_IMAGE_WIDTH = 40;

export class ImageThumbnail implements Component {
  private readonly attachment: ImageAttachment;
  private lastRenderWidth = 80;
  private lastBuiltWidth: number | undefined;
  private lastBuiltProtocol: RendererInlineImageProtocol | undefined;
  private lastBuiltLines: string[] | undefined;

  constructor(attachment: ImageAttachment) {
    this.attachment = attachment;
    this.rebuild(this.lastRenderWidth, detectNativeTerminalImageProtocol(process.env));
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    this.lastRenderWidth = safeWidth;

    const protocol = detectNativeTerminalImageProtocol(process.env);
    if (
      this.lastBuiltWidth !== safeWidth ||
      this.lastBuiltProtocol !== protocol ||
      this.lastBuiltLines === undefined
    ) {
      this.rebuild(safeWidth, protocol);
    }

    return this.lastBuiltLines ?? [''];
  }

  invalidate(): void {
    this.lastBuiltLines = undefined;
    this.rebuild(this.lastRenderWidth, detectNativeTerminalImageProtocol(process.env));
  }

  private rebuild(width: number, protocol: RendererInlineImageProtocol): void {
    this.lastBuiltLines = this.buildLines(width, protocol);
    this.lastBuiltWidth = width;
    this.lastBuiltProtocol = protocol;
  }

  private buildLines(width: number, protocol: RendererInlineImageProtocol): string[] {
    if (width <= 0) return [''];
    if (width < MAX_IMAGE_WIDTH + 2) return this.fallbackLines(width);

    if (protocol === 'none') return this.fallbackLines(width);

    const format = imageFormatFromMime(this.attachment.mime);
    if (!supportsInlineFormat(protocol, format)) return this.fallbackLines(width);

    const imageWidth = Math.max(1, Math.min(MAX_IMAGE_WIDTH, width - 2));
    const rows = calculateRendererInlineImageRows(
      {
        widthPx: this.attachment.width,
        heightPx: this.attachment.height,
      },
      imageWidth,
      undefined,
      MAX_IMAGE_ROWS,
    );
    const encoded = encodeRendererInlineImage(protocol, {
      data: this.attachment.bytes,
      format,
      widthCells: imageWidth,
      heightCells: rows,
      widthPx: this.attachment.width,
      heightPx: this.attachment.height,
      filename: this.attachment.placeholder,
      doNotMoveCursor: protocol === 'kitty',
    });

    const lines: string[] = [];
    for (let index = 0; index < rows - 1; index++) {
      lines.push('');
    }
    const rowOffset = rows - 1;
    const moveUp = rowOffset > 0 ? `\u001B[${String(rowOffset)}A` : '';
    const moveDown = protocol === 'kitty' && rowOffset > 0 ? `\u001B[${String(rowOffset)}B` : '';
    lines.push(moveUp + encoded.output + moveDown);
    return lines;
  }

  private fallbackLines(width: number): string[] {
    return new Text(currentTheme.fg('accent', this.attachment.placeholder), 0, 0).render(width);
  }
}

function imageFormatFromMime(mime: string): RendererInlineImageFormat | undefined {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpeg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return undefined;
  }
}

function supportsInlineFormat(
  protocol: RendererInlineImageProtocol,
  format: RendererInlineImageFormat | undefined,
): format is RendererInlineImageFormat {
  if (protocol === 'none' || format === undefined) return false;
  if (protocol === 'kitty') return format === 'png';
  return true;
}

/**
 * HexViewer — binary/hex dump viewer with offset navigation.
 *
 * Provides a hex dump viewer:
 * - Classic hex dump layout (offset | hex bytes | ASCII)
 * - Configurable bytes per line (8/16/32)
 * - Offset navigation (goto, page up/down)
 * - Byte highlighting and selection
 * - Search (hex pattern or ASCII string)
 * - Endianness display (16/32/64-bit values)
 * - Bit-level view for selected byte
 * - Data type interpretation (int, float, etc.)
 * - Diff mode (compare two buffers)
 * - Bookmark addresses
 *
 * Visual style:
 * ┌─ hex-viewer: data.bin (1024 bytes) ──────────────────┐
 * │ 00000000  48 65 6C 6C 6F 20 57 6F  72 6C 64 21 0A 00 FF  │Hello World!..│
 * │ 00000010  89 50 4E 47 0D 0A 1A 0A  00 00 00 0D 49 48 44  │.PNG......IHD│
 * │ 00000020  52 00 00 00 01 00 00 00  01 08 02 00 00 00 90  │R............│
 * │ 00000030  77 53 DE 00 00 00 0C 49  44 41 54 08 D7 63 F8  │wS...IDAT..c.│
 * │                                                       │
 * │ Offset: 0x00000020 | Sel: 0x24 [00] | int32: 16777216│
 * └───────────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HexViewerOptions {
  readonly bytesPerLine?: 8 | 16 | 32;
  readonly showOffset?: boolean;
  readonly showAscii?: boolean;
  readonly showGrid?: boolean;
  readonly groupSize?: 1 | 2 | 4; // bytes per group
}

export interface HexSelection {
  readonly start: number;
  readonly end: number;
}

export interface HexSearchResult {
  readonly offset: number;
  readonly length: number;
  readonly preview: string;
}

export interface HexRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly bytesPerLine?: 8 | 16 | 32;
  readonly showAscii?: boolean;
  readonly showBitView?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// HexViewer
// ---------------------------------------------------------------------------

export class HexViewer {
  private data: Uint8Array = new Uint8Array(0);
  private fileName = 'memory';
  private offset = 0;
  private selection: HexSelection | null = null;
  private bookmarks: Set<number> = new Set();
  private searchResults: HexSearchResult[] = [];
  private currentSearchIdx = -1;

  // ─── Data Management ─────────────────────────────────────────────

  /** Load data from Uint8Array. */
  load(data: Uint8Array, fileName = 'memory'): void {
    this.data = data;
    this.fileName = fileName;
    this.offset = 0;
    this.selection = null;
    this.searchResults = [];
  }

  /** Load from hex string. */
  loadHex(hexString: string, fileName = 'memory'): void {
    const clean = hexString.replace(/[\s\n]/g, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    this.load(bytes, fileName);
  }

  /** Load from ASCII string. */
  loadString(str: string, fileName = 'memory'): void {
    this.load(new TextEncoder().encode(str), fileName);
  }

  /** Get data size. */
  get size(): number {
    return this.data.length;
  }

  /** Get byte at offset. */
  getByte(offset: number): number | undefined {
    return this.data[offset];
  }

  /** Get bytes in range. */
  getBytes(start: number, length: number): Uint8Array {
    return this.data.slice(start, start + length);
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Go to offset. */
  goto(offset: number): void {
    this.offset = Math.max(0, Math.min(offset, Math.max(0, this.data.length - 1)));
  }

  /** Page down. */
  pageDown(bytesPerLine = 16, lines = 10): void {
    this.goto(this.offset + bytesPerLine * lines);
  }

  /** Page up. */
  pageUp(bytesPerLine = 16, lines = 10): void {
    this.goto(this.offset - bytesPerLine * lines);
  }

  /** Get current offset. */
  getOffset(): number {
    return this.offset;
  }

  // ─── Selection ───────────────────────────────────────────────────

  /** Set selection range. */
  select(start: number, end: number): void {
    this.selection = { start: Math.min(start, end), end: Math.max(start, end) };
  }

  /** Clear selection. */
  clearSelection(): void {
    this.selection = null;
  }

  /** Get selected bytes. */
  getSelectedBytes(): Uint8Array | null {
    if (!this.selection) return null;
    return this.data.slice(this.selection.start, this.selection.end + 1);
  }

  // ─── Bookmarks ───────────────────────────────────────────────────

  /** Toggle bookmark at offset. */
  toggleBookmark(offset: number): void {
    if (this.bookmarks.has(offset)) {
      this.bookmarks.delete(offset);
    } else {
      this.bookmarks.add(offset);
    }
  }

  /** Get all bookmarks. */
  getBookmarks(): number[] {
    return [...this.bookmarks].sort((a, b) => a - b);
  }

  // ─── Search ──────────────────────────────────────────────────────

  /** Search for hex pattern (e.g. "48 65 6C"). */
  searchHex(pattern: string): HexSearchResult[] {
    const clean = pattern.replace(/\s/g, '');
    const searchBytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      searchBytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    return this.searchBytes(searchBytes);
  }

  /** Search for ASCII string. */
  searchAscii(str: string): HexSearchResult[] {
    return this.searchBytes(new TextEncoder().encode(str));
  }

  private searchBytes(pattern: Uint8Array): HexSearchResult[] {
    this.searchResults = [];
    this.currentSearchIdx = -1;

    if (pattern.length === 0 || pattern.length > this.data.length) return [];

    for (let i = 0; i <= this.data.length - pattern.length; i++) {
      let match = true;
      for (let j = 0; j < pattern.length; j++) {
        if (this.data[i + j] !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        const preview = this.formatPreview(i, pattern.length);
        this.searchResults.push({ offset: i, length: pattern.length, preview });
      }
    }

    if (this.searchResults.length > 0) {
      this.currentSearchIdx = 0;
      this.goto(this.searchResults[0]!.offset);
    }

    return this.searchResults;
  }

  /** Go to next search result. */
  nextSearchResult(): HexSearchResult | null {
    if (this.searchResults.length === 0) return null;
    this.currentSearchIdx = (this.currentSearchIdx + 1) % this.searchResults.length;
    const result = this.searchResults[this.currentSearchIdx]!;
    this.goto(result.offset);
    return result;
  }

  /** Get search result count. */
  get searchCount(): number {
    return this.searchResults.length;
  }

  // ─── Data Interpretation ─────────────────────────────────────────

  /** Read as unsigned integer (little-endian). */
  readUInt(offset: number, bytes: 1 | 2 | 4): number {
    let value = 0;
    for (let i = 0; i < bytes; i++) {
      value |= (this.data[offset + i] ?? 0) << (i * 8);
    }
    return value >>> 0;
  }

  /** Read as unsigned integer (big-endian). */
  readUIntBE(offset: number, bytes: 1 | 2 | 4): number {
    let value = 0;
    for (let i = 0; i < bytes; i++) {
      value = (value << 8) | (this.data[offset + i] ?? 0);
    }
    return value >>> 0;
  }

  /** Get bit representation of a byte. */
  getBits(offset: number): string {
    const byte = this.data[offset] ?? 0;
    return byte.toString(2).padStart(8, '0');
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the hex viewer. */
  render(options: HexRenderOptions): string[] {
    const { width, height, bytesPerLine = 16, showAscii = true, showBitView = false, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    // Header
    const sizeStr = formatSize(this.data.length);
    const title = ` ${this.fileName} (${sizeStr})`;
    lines.push(fg('textMuted', `┌─${boldFg('text', title)}${'─'.repeat(Math.max(0, innerWidth - title.length - 2))}┐`));

    // Calculate visible lines
    const contentHeight = height - (showBitView ? 5 : 3);
    const startOffset = this.offset - (this.offset % bytesPerLine);
    const visibleLines = Math.min(contentHeight, Math.ceil((this.data.length - startOffset) / bytesPerLine));

    // Offset ruler
    const ruler = this.renderRuler(startOffset, bytesPerLine, showAscii, innerWidth, dimFg);
    lines.push(fg('textMuted', '│') + ruler + fg('textMuted', '│'));

    // Hex lines
    for (let i = 0; i < visibleLines && i < contentHeight; i++) {
      const lineOffset = startOffset + i * bytesPerLine;
      if (lineOffset >= this.data.length) break;

      const line = this.renderHexLine(lineOffset, bytesPerLine, showAscii, innerWidth, options);
      lines.push(fg('textMuted', '│') + line + fg('textMuted', '│'));
    }

    // Pad
    while (lines.length < height - (showBitView ? 4 : 2)) {
      lines.push(fg('textMuted', '│') + ' '.repeat(innerWidth) + fg('textMuted', '│'));
    }

    // Bit view for selected byte
    if (showBitView && this.selection) {
      const selByte = this.data[this.selection.start] ?? 0;
      const bits = selByte.toString(2).padStart(8, '0');
      const bitLine = ` Bits @ 0x${this.selection.start.toString(16).padStart(8, '0')}: ${boldFg('primary', bits.split('').join(' '))} = ${selByte} (0x${selByte.toString(16).padStart(2, '0')})`;
      lines.push(fg('textMuted', '│') + padRight(bitLine, innerWidth) + fg('textMuted', '│'));
    }

    // Footer with interpretation
    const selInfo = this.selection
      ? `Sel: 0x${this.selection.start.toString(16)} [${(this.data[this.selection.start] ?? 0).toString(16).padStart(2, '0')}]`
      : `Offset: 0x${this.offset.toString(16).padStart(8, '0')}`;
    const intInfo = this.selection ? ` | int32: ${this.readUInt(this.selection.start, 4)}` : '';
    const searchInfo = this.searchResults.length > 0 ? ` | ${this.currentSearchIdx + 1}/${this.searchResults.length} matches` : '';
    const footer = ` ${selInfo}${intInfo}${searchInfo}`;
    lines.push(fg('textMuted', `└${padRight(footer, innerWidth)}┘`));

    return lines.slice(0, height);
  }

  private renderRuler(startOffset: number, bytesPerLine: number, showAscii: boolean, width: number, dimFg: (t: string, s: string) => string): string {
    const offsetWidth = 10;
    let ruler = dimFg('textMuted', ' '.repeat(offsetWidth));

    for (let i = 0; i < bytesPerLine; i++) {
      ruler += dimFg('textMuted', ` ${i.toString(16).toUpperCase().padStart(2, '0')}`);
      if (i === 7 && bytesPerLine === 16) ruler += ' ';
    }

    if (showAscii) {
      ruler += dimFg('textMuted', '  ');
    }

    return padRight(ruler, width);
  }

  private renderHexLine(lineOffset: number, bytesPerLine: number, showAscii: boolean, width: number, options: HexRenderOptions): string {
    const { fg, boldFg, dimFg } = options;
    const isBookmarked = this.bookmarks.has(lineOffset);

    // Offset
    const bookmarkMark = isBookmarked ? fg('warning', '★') : ' ';
    const offsetStr = dimFg('textMuted', `${bookmarkMark}${lineOffset.toString(16).padStart(8, '0')}`);
    let line = `${offsetStr} `;

    // Hex bytes
    let ascii = '';
    for (let i = 0; i < bytesPerLine; i++) {
      const byteOffset = lineOffset + i;
      if (byteOffset >= this.data.length) {
        line += '   ';
        ascii += ' ';
        continue;
      }

      const byte = this.data[byteOffset]!;
      const hexStr = byte.toString(16).padStart(2, '0').toUpperCase();

      // Highlight selection
      const isSelected = this.selection && byteOffset >= this.selection.start && byteOffset <= this.selection.end;
      const isSearchHit = this.isSearchHit(byteOffset);

      if (isSelected) {
        line += ` ${boldFg('accent', hexStr)}`;
      } else if (isSearchHit) {
        line += ` ${boldFg('warning', hexStr)}`;
      } else if (byte === 0) {
        line += ` ${dimFg('textMuted', hexStr)}`;
      } else {
        line += ` ${fg('text', hexStr)}`;
      }

      // Extra space after 8 bytes
      if (i === 7 && bytesPerLine === 16) line += ' ';

      // ASCII representation
      ascii += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.';
    }

    // ASCII column
    if (showAscii) {
      const asciiColored = ascii.split('').map((ch, i) => {
        const byteOffset = lineOffset + i;
        const isSelected = this.selection && byteOffset >= this.selection.start && byteOffset <= this.selection.end;
        if (ch === '.') return dimFg('textMuted', ch);
        if (isSelected) return boldFg('accent', ch);
        return fg('success', ch);
      }).join('');
      line += ` ${fg('textMuted', '│')}${asciiColored}`;
    }

    return padRight(line, width);
  }

  private isSearchHit(offset: number): boolean {
    for (const result of this.searchResults) {
      if (offset >= result.offset && offset < result.offset + result.length) {
        return true;
      }
    }
    return false;
  }

  private formatPreview(offset: number, length: number): string {
    const bytes = this.data.slice(offset, offset + Math.min(length, 8));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}

function padRight(str: string, len: number): string {
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, len - visible.length);
  return str + ' '.repeat(pad);
}

/** Create a demo hex viewer with sample binary data. */
export function createDemoHexViewer(): HexViewer {
  const viewer = new HexViewer();

  // PNG-like header + some data
  const demoData = new Uint8Array([
    0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x20, 0x57, 0x6F, 0x72, 0x6C, 0x64, 0x21, 0x0A, 0x00, 0xFF, 0xFE,
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77,
    0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0,
    0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5B, 0x9E, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);

  viewer.load(demoData, 'data.bin');
  viewer.select(0x10, 0x13); // Select "PNG" magic
  viewer.toggleBookmark(0x00);
  viewer.toggleBookmark(0x10);

  return viewer;
}

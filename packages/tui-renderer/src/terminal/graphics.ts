export type RendererInlineImageProtocol = 'kitty' | 'iterm2' | 'none';

export type RendererInlineImageData =
  | string
  | Uint8Array
  | ReadonlyArray<number>;

export type RendererInlineImageFormat =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'rgb'
  | 'rgba';

export interface RendererInlineImageOptions {
  readonly data: RendererInlineImageData;
  readonly format?: RendererInlineImageFormat;
  readonly widthCells?: number;
  readonly heightCells?: number;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly filename?: string;
  readonly sizeBytes?: number;
  readonly preserveAspectRatio?: boolean;
  readonly doNotMoveCursor?: boolean;
  readonly imageId?: number;
  readonly placementId?: number;
  readonly zIndex?: number;
  readonly quiet?: boolean;
  readonly chunkSize?: number;
}

export interface RendererInlineImageEncoded {
  readonly protocol: Exclude<RendererInlineImageProtocol, 'none'>;
  readonly output: string;
  readonly chunks: number;
  readonly bytes: number;
}

export interface RendererImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface RendererCellDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface RendererKittyDeleteImageOptions {
  readonly imageId?: number;
  readonly quiet?: boolean;
}

const ESC = '\u001B';
const BEL = '\u0007';
const ST = `${ESC}\\`;
const KITTY_APC_PREFIX = `${ESC}_G`;
const KITTY_MAX_CHUNK_SIZE = 4096;
const ITERM_MAX_CHUNK_SIZE = 1_048_576;
const DEFAULT_RENDERER_CELL_DIMENSIONS: RendererCellDimensions = { widthPx: 9, heightPx: 18 };

const KITTY_FORMAT_CODES: Partial<Record<RendererInlineImageFormat, number>> = {
  png: 100,
  rgb: 24,
  rgba: 32,
};

export function encodeRendererInlineImage(
  protocol: Exclude<RendererInlineImageProtocol, 'none'>,
  options: RendererInlineImageOptions,
): RendererInlineImageEncoded {
  return protocol === 'kitty'
    ? encodeKittyInlineImage(options)
    : encodeIterm2InlineImage(options);
}

export function calculateRendererInlineImageRows(
  imageDimensions: RendererImageDimensions,
  targetWidthCells: number,
  cellDimensions: RendererCellDimensions = DEFAULT_RENDERER_CELL_DIMENSIONS,
  maxRows?: number,
): number {
  const sourceWidth = Math.max(1, Math.floor(imageDimensions.widthPx));
  const sourceHeight = Math.max(1, Math.floor(imageDimensions.heightPx));
  const cellWidth = normalizePositiveInteger(cellDimensions.widthPx) ?? 9;
  const cellHeight = normalizePositiveInteger(cellDimensions.heightPx) ?? 18;
  const widthCells = normalizePositiveInteger(targetWidthCells) ?? 1;
  const targetWidthPx = widthCells * cellWidth;
  const scaledHeightPx = sourceHeight * (targetWidthPx / sourceWidth);
  const rows = Math.max(1, Math.ceil(scaledHeightPx / cellHeight));
  const rowLimit = normalizePositiveInteger(maxRows);
  return rowLimit === undefined ? rows : Math.min(rowLimit, rows);
}

export function encodeRendererClearInlineImages(protocol: RendererInlineImageProtocol): string {
  return protocol === 'kitty' ? encodeKittyDeleteImages() : '';
}

export function encodeKittyInlineImage(
  options: RendererInlineImageOptions,
): RendererInlineImageEncoded {
  const data = normalizeImageData(options.data);
  const chunks = chunkBase64(data.base64, normalizeChunkSize(options.chunkSize, KITTY_MAX_CHUNK_SIZE));
  const commands: string[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const isFirst = index === 0;
    const isLast = index === chunks.length - 1;
    const controlData = isFirst ? kittyInlineImageControlData(options) : {};
    commands.push(encodeKittyGraphicsCommand(
      {
        ...controlData,
        m: isLast ? 0 : 1,
      },
      chunks[index],
    ));
  }

  return {
    protocol: 'kitty',
    output: commands.join(''),
    chunks: chunks.length,
    bytes: data.bytes,
  };
}

export function encodeIterm2InlineImage(
  options: RendererInlineImageOptions,
): RendererInlineImageEncoded {
  const data = normalizeImageData(options.data);
  const chunkSize = normalizeChunkSize(options.chunkSize, ITERM_MAX_CHUNK_SIZE);
  const chunks = chunkBase64(data.base64, chunkSize);
  if (chunks.length <= 1) {
    return {
      protocol: 'iterm2',
      output: `${ESC}]1337;File=${itermInlineImageArgs(options, data.bytes)}:${data.base64}${BEL}`,
      chunks: 1,
      bytes: data.bytes,
    };
  }

  return {
    protocol: 'iterm2',
    output: [
      `${ESC}]1337;MultipartFile=${itermInlineImageArgs(options, data.bytes)}${BEL}`,
      ...chunks.map((chunk) => `${ESC}]1337;FilePart=${chunk}${BEL}`),
      `${ESC}]1337;FileEnd${BEL}`,
    ].join(''),
    chunks: chunks.length,
    bytes: data.bytes,
  };
}

export function encodeKittyDeleteImages(options: RendererKittyDeleteImageOptions = {}): string {
  const imageId = normalizePositiveInteger(options.imageId);
  return encodeKittyGraphicsCommand({
    a: 'd',
    d: imageId === undefined ? 'A' : 'I',
    i: imageId,
    q: options.quiet === false ? undefined : 2,
  });
}

export function encodeKittyGraphicsCommand(
  controlData: Record<string, number | string | boolean | undefined>,
  payload = '',
): string {
  const control = Object.entries(controlData)
    .filter((entry): entry is [string, number | string | boolean] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeKittyControlValue(value)}`)
    .join(',');
  return `${KITTY_APC_PREFIX}${control};${payload}${ST}`;
}

function kittyInlineImageControlData(
  options: RendererInlineImageOptions,
): Record<string, number | string | boolean | undefined> {
  const format = options.format ?? 'png';
  const formatCode = KITTY_FORMAT_CODES[format];
  if (formatCode === undefined) {
    throw new Error(`Kitty graphics protocol does not support ${format} raw payloads`);
  }

  return {
    a: 'T',
    f: formatCode,
    q: options.quiet === false ? undefined : 2,
    i: normalizePositiveInteger(options.imageId),
    p: normalizePositiveInteger(options.placementId),
    c: normalizePositiveInteger(options.widthCells),
    r: normalizePositiveInteger(options.heightCells),
    s: normalizePositiveInteger(options.widthPx),
    v: normalizePositiveInteger(options.heightPx),
    C: options.doNotMoveCursor === true ? 1 : undefined,
    z: normalizeInteger(options.zIndex),
  };
}

function itermInlineImageArgs(options: RendererInlineImageOptions, bytes: number): string {
  return [
    ['inline', 1],
    ['name', options.filename === undefined ? undefined : base64Encode(options.filename)],
    ['size', normalizePositiveInteger(options.sizeBytes) ?? bytes],
    ['width', itermDimension(options.widthCells, options.widthPx)],
    ['height', itermDimension(options.heightCells, options.heightPx)],
    ['preserveAspectRatio', options.preserveAspectRatio === false ? 0 : undefined],
    ['doNotMoveCursor', options.doNotMoveCursor === true ? 1 : undefined],
  ]
    .filter((entry): entry is [string, number | string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(';');
}

function itermDimension(cells: number | undefined, pixels: number | undefined): string | undefined {
  const cellValue = normalizePositiveInteger(cells);
  if (cellValue !== undefined) return String(cellValue);
  const pixelValue = normalizePositiveInteger(pixels);
  return pixelValue === undefined ? undefined : `${String(pixelValue)}px`;
}

function encodeKittyControlValue(value: number | string | boolean): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function normalizeImageData(data: RendererInlineImageData): { readonly base64: string; readonly bytes: number } {
  if (typeof data === 'string') {
    return {
      base64: sanitizeBase64(data),
      bytes: Math.floor((sanitizeBase64(data).length * 3) / 4),
    };
  }
  const bytes = Uint8Array.from(data);
  return {
    base64: Buffer.from(bytes).toString('base64'),
    bytes: bytes.byteLength,
  };
}

function sanitizeBase64(data: string): string {
  return data.replaceAll(/\s/g, '');
}

function base64Encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function chunkBase64(data: string, chunkSize: number): readonly string[] {
  if (data.length === 0) return [''];
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    chunks.push(data.slice(offset, offset + chunkSize));
  }
  return chunks;
}

function normalizeChunkSize(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(4, Math.floor(value / 4) * 4);
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function normalizeInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.floor(value);
}

// ---------------------------------------------------------------------------
// Kitty Unicode placeholder protocol (kitty >= 0.28)
// ---------------------------------------------------------------------------

/**
 * Code point of the kitty graphics Unicode placeholder (U+10EEEE). A cell
 * holding this glyph plus a row and a column diacritic displays the pixel of
 * a virtually placed image at that row/column offset.
 */
export const KITTY_PLACEHOLDER_CODE_POINT = 0x10EEEE;

/**
 * Combining diacritics encoding row/column numbers 0-255 for the Unicode
 * placeholder protocol; the array index is the row or column number.
 * Source: kitty gen/rowcolumn-diacritics.txt (first 256 entries).
 */
export const ROW_COLUMN_DIACRITICS: readonly number[] = [
  0x0305, 0x030d, 0x030e, 0x0310, 0x0312, 0x033d, 0x033e, 0x033f,
  0x0346, 0x034a, 0x034b, 0x034c, 0x0350, 0x0351, 0x0352, 0x0357,
  0x035b, 0x0363, 0x0364, 0x0365, 0x0366, 0x0367, 0x0368, 0x0369,
  0x036a, 0x036b, 0x036c, 0x036d, 0x036e, 0x036f, 0x0483, 0x0484,
  0x0485, 0x0486, 0x0487, 0x0592, 0x0593, 0x0594, 0x0595, 0x0597,
  0x0598, 0x0599, 0x059c, 0x059d, 0x059e, 0x059f, 0x05a0, 0x05a1,
  0x05a8, 0x05a9, 0x05ab, 0x05ac, 0x05af, 0x05c4, 0x0610, 0x0611,
  0x0612, 0x0613, 0x0614, 0x0615, 0x0616, 0x0617, 0x0657, 0x0658,
  0x0659, 0x065a, 0x065b, 0x065d, 0x065e, 0x06d6, 0x06d7, 0x06d8,
  0x06d9, 0x06da, 0x06db, 0x06dc, 0x06df, 0x06e0, 0x06e1, 0x06e2,
  0x06e4, 0x06e7, 0x06e8, 0x06eb, 0x06ec, 0x0730, 0x0732, 0x0733,
  0x0735, 0x0736, 0x073a, 0x073d, 0x073f, 0x0740, 0x0741, 0x0743,
  0x0745, 0x0747, 0x0749, 0x074a, 0x07eb, 0x07ec, 0x07ed, 0x07ee,
  0x07ef, 0x07f0, 0x07f1, 0x07f3, 0x0816, 0x0817, 0x0818, 0x0819,
  0x081b, 0x081c, 0x081d, 0x081e, 0x081f, 0x0820, 0x0821, 0x0822,
  0x0823, 0x0825, 0x0826, 0x0827, 0x0829, 0x082a, 0x082b, 0x082c,
  0x082d, 0x0951, 0x0953, 0x0954, 0x0f82, 0x0f83, 0x0f86, 0x0f87,
  0x135d, 0x135e, 0x135f, 0x17dd, 0x193a, 0x1a17, 0x1a75, 0x1a76,
  0x1a77, 0x1a78, 0x1a79, 0x1a7a, 0x1a7b, 0x1a7c, 0x1b6b, 0x1b6d,
  0x1b6e, 0x1b6f, 0x1b70, 0x1b71, 0x1b72, 0x1b73, 0x1cd0, 0x1cd1,
  0x1cd2, 0x1cda, 0x1cdb, 0x1ce0, 0x1dc0, 0x1dc1, 0x1dc3, 0x1dc4,
  0x1dc5, 0x1dc6, 0x1dc7, 0x1dc8, 0x1dc9, 0x1dcb, 0x1dcc, 0x1dd1,
  0x1dd2, 0x1dd3, 0x1dd4, 0x1dd5, 0x1dd6, 0x1dd7, 0x1dd8, 0x1dd9,
  0x1dda, 0x1ddb, 0x1ddc, 0x1ddd, 0x1dde, 0x1ddf, 0x1de0, 0x1de1,
  0x1de2, 0x1de3, 0x1de4, 0x1de5, 0x1de6, 0x1dfe, 0x20d0, 0x20d1,
  0x20d4, 0x20d5, 0x20d6, 0x20d7, 0x20db, 0x20dc, 0x20e1, 0x20e7,
  0x20e9, 0x20f0, 0x2cef, 0x2cf0, 0x2cf1, 0x2de0, 0x2de1, 0x2de2,
  0x2de3, 0x2de4, 0x2de5, 0x2de6, 0x2de7, 0x2de8, 0x2de9, 0x2dea,
  0x2deb, 0x2dec, 0x2ded, 0x2dee, 0x2def, 0x2df0, 0x2df1, 0x2df2,
  0x2df3, 0x2df4, 0x2df5, 0x2df6, 0x2df7, 0x2df8, 0x2df9, 0x2dfa,
  0x2dfb, 0x2dfc, 0x2dfd, 0x2dfe, 0x2dff, 0xa66f, 0xa67c, 0xa67d,
  0xa6f0, 0xa6f1, 0xa8e0, 0xa8e1, 0xa8e2, 0xa8e3, 0xa8e4, 0xa8e5,
];

export interface KittyPlaceholderTransmitOptions {
  readonly id: number;
  readonly base64: string;
  readonly columns: number;
  readonly rows: number;
}

/**
 * Transmit an image with a virtual placement (`U=1`) fit into a
 * columns x rows cell rectangle, without displaying it. The image only
 * becomes visible where placeholder text emitted by
 * `encodeKittyPlaceholderLines` references its id.
 */
export function encodeKittyPlaceholderTransmit(options: KittyPlaceholderTransmitOptions): string {
  const chunks = chunkBase64(options.base64, KITTY_MAX_CHUNK_SIZE);
  const commands: string[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const isFirst = index === 0;
    const isLast = index === chunks.length - 1;
    const controlData = isFirst
      ? {
          a: 'T',
          U: 1,
          i: options.id,
          c: options.columns,
          r: options.rows,
          q: 2,
        }
      : {};
    commands.push(
      encodeKittyGraphicsCommand({ ...controlData, m: isLast ? 0 : 1 }, chunks[index]),
    );
  }
  return commands.join('');
}

export interface KittyPlaceholderLinesOptions {
  readonly id: number;
  readonly columns: number;
  readonly rows: number;
}

/**
 * Build the plain-text lines that display a virtually placed image: every
 * cell is U+10EEEE followed by the row and column diacritics, with the image
 * id encoded in the truecolor foreground color. Being ordinary text, these
 * lines flow through the cell compositor unchanged.
 */
export function encodeKittyPlaceholderLines(options: KittyPlaceholderLinesOptions): string[] {
  const idColor = `${ESC}[38;2;${(options.id >> 16) & 0xFF};${(options.id >> 8) & 0xFF};${options.id & 0xFF}m`;
  const placeholder = String.fromCodePoint(KITTY_PLACEHOLDER_CODE_POINT);
  const lines: string[] = [];
  for (let row = 0; row < options.rows; row++) {
    const rowMark = String.fromCodePoint(rowColumnDiacritic(row));
    let cells = '';
    for (let column = 0; column < options.columns; column++) {
      cells += `${placeholder}${rowMark}${String.fromCodePoint(rowColumnDiacritic(column))}`;
    }
    lines.push(`${idColor}${cells}${ESC}[39m`);
  }
  return lines;
}

/** Delete a single image (and its placements) from terminal memory by id. */
export function encodeKittyDeleteImage(id: number): string {
  return `${KITTY_APC_PREFIX}a=d,d=i,i=${id},q=2${ST}`;
}

function rowColumnDiacritic(index: number): number {
  return ROW_COLUMN_DIACRITICS[index & 0xFF] ?? 0x0305;
}

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

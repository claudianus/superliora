import { sniffImageDimensions } from './file-type';

import {
  FALLBACK_EDGE_PX,
  IMAGE_BYTE_BUDGET,
  MAX_DECODE_BYTES,
  MAX_DECODE_PIXELS,
  MAX_IMAGE_EDGE_PX,
  RECODABLE_MIME,
  encodeWithinBudget,
  fitWithinEdge,
  normalizeMime,
} from './image-compress-encode';

/** Longest-edge ceiling (px). Larger images are scaled down to fit. */
export { MAX_IMAGE_EDGE_PX } from './image-compress-encode';

/**
 * Raw-byte budget for a single image. base64 inflates bytes by ~4/3, so a
 * 3.75 MB raw payload stays under a 5 MB encoded ceiling. Tune to the active
 * provider's per-image limit.
 */
export { IMAGE_BYTE_BUDGET } from './image-compress-encode';

export interface CompressImageOptions {
  readonly maxEdge?: number;
  readonly byteBudget?: number;
  readonly maxDecodeBytes?: number;
}

export interface CompressImageResult {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly changed: boolean;
  readonly originalByteLength: number;
  readonly finalByteLength: number;
}

export async function compressImageForModel(
  bytes: Uint8Array,
  mimeType: string,
  options: CompressImageOptions = {},
): Promise<CompressImageResult> {
  const maxEdge = options.maxEdge ?? MAX_IMAGE_EDGE_PX;
  const byteBudget = options.byteBudget ?? IMAGE_BYTE_BUDGET;
  const maxDecodeBytes = options.maxDecodeBytes ?? MAX_DECODE_BYTES;
  const normalizedMime = normalizeMime(mimeType);
  const dims = sniffImageDimensions(bytes);

  const passthrough = (): CompressImageResult => ({
    data: bytes,
    mimeType,
    width: dims?.width ?? 0,
    height: dims?.height ?? 0,
    originalWidth: dims?.width ?? 0,
    originalHeight: dims?.height ?? 0,
    changed: false,
    originalByteLength: bytes.length,
    finalByteLength: bytes.length,
  });

  if (bytes.length === 0) return passthrough();
  if (!RECODABLE_MIME.has(normalizedMime)) return passthrough();

  const longestEdge = dims ? Math.max(dims.width, dims.height) : 0;
  const withinBytes = bytes.length <= byteBudget;
  const withinEdge = longestEdge > 0 && longestEdge <= maxEdge;
  if (withinBytes && (withinEdge || longestEdge === 0)) return passthrough();

  if (dims && dims.width * dims.height > MAX_DECODE_PIXELS) return passthrough();
  if (bytes.length > maxDecodeBytes) return passthrough();

  try {
    const { Jimp } = await import('jimp');
    const image = await Jimp.fromBuffer(Buffer.from(bytes));
    const sourceIsPng = normalizedMime === 'image/png';

    fitWithinEdge(image, maxEdge);

    const encoded = await encodeWithinBudget(image, {
      sourceIsPng,
      byteBudget,
      fallbackEdge: FALLBACK_EDGE_PX,
    });

    const originalPixels = (dims?.width ?? 0) * (dims?.height ?? 0);
    const finalPixels = encoded.width * encoded.height;
    const shrankBytes = encoded.data.length < bytes.length;
    const shrankPixels = originalPixels > 0 && finalPixels < originalPixels;
    if (!shrankBytes && !shrankPixels) return passthrough();

    return {
      data: encoded.data,
      mimeType: encoded.mimeType,
      width: encoded.width,
      height: encoded.height,
      originalWidth: dims?.width ?? 0,
      originalHeight: dims?.height ?? 0,
      changed: true,
      originalByteLength: bytes.length,
      finalByteLength: encoded.data.length,
    };
  } catch {
    return passthrough();
  }
}

export interface CompressBase64Result {
  readonly base64: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly changed: boolean;
  readonly originalByteLength: number;
  readonly finalByteLength: number;
}

export async function compressBase64ForModel(
  base64: string,
  mimeType: string,
  options: CompressImageOptions = {},
): Promise<CompressBase64Result> {
  const maxDecodeBytes = options.maxDecodeBytes ?? MAX_DECODE_BYTES;
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > maxDecodeBytes) {
    return {
      base64,
      mimeType,
      width: 0,
      height: 0,
      originalWidth: 0,
      originalHeight: 0,
      changed: false,
      originalByteLength: approxBytes,
      finalByteLength: approxBytes,
    };
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    return {
      base64,
      mimeType,
      width: 0,
      height: 0,
      originalWidth: 0,
      originalHeight: 0,
      changed: false,
      originalByteLength: 0,
      finalByteLength: 0,
    };
  }
  const result = await compressImageForModel(bytes, mimeType, options);
  if (!result.changed) {
    return {
      base64,
      mimeType,
      width: result.width,
      height: result.height,
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
      changed: false,
      originalByteLength: result.originalByteLength,
      finalByteLength: result.finalByteLength,
    };
  }
  return {
    base64: Buffer.from(result.data).toString('base64'),
    mimeType: result.mimeType,
    width: result.width,
    height: result.height,
    originalWidth: result.originalWidth,
    originalHeight: result.originalHeight,
    changed: true,
    originalByteLength: result.originalByteLength,
    finalByteLength: result.finalByteLength,
  };
}

export type {
  CropImageFailure,
  CropImageOptions,
  CropImageOutcome,
  CropImageSuccess,
  ImageCropRegion,
} from './image-compress-crop';
export { cropImageForModel } from './image-compress-crop';

export type {
  ImageCompressionCaptionExtraction,
  ImageCompressionCaptionInput,
  ImageVariantDescription,
} from './image-compress-caption';
export {
  buildImageCompressionCaption,
  extractImageCompressionCaptions,
  formatByteSize,
} from './image-compress-caption';

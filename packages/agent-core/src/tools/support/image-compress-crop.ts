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
import { formatByteSize } from './image-compress-caption';
import type { CompressImageOptions } from './image-compress';

/** Crop rectangle in ORIGINAL-image pixel coordinates. */
export interface ImageCropRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CropImageOptions extends CompressImageOptions {
  /**
   * Keep the crop at native resolution (no edge-fit downscale). The byte
   * budget still applies: a crop that cannot be encoded within it fails
   * explicitly instead of being silently degraded.
   */
  readonly skipResize?: boolean;
}

export interface CropImageSuccess {
  readonly ok: true;
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
  readonly region: ImageCropRegion;
  readonly resized: boolean;
  readonly originalByteLength: number;
  readonly finalByteLength: number;
}

export interface CropImageFailure {
  readonly ok: false;
  readonly error: string;
}

export type CropImageOutcome = CropImageSuccess | CropImageFailure;

/**
 * Cut `region` out of `bytes` and encode it for the model.
 */
export async function cropImageForModel(
  bytes: Uint8Array,
  mimeType: string,
  region: ImageCropRegion,
  options: CropImageOptions = {},
): Promise<CropImageOutcome> {
  const maxEdge = options.maxEdge ?? MAX_IMAGE_EDGE_PX;
  const byteBudget = options.byteBudget ?? IMAGE_BYTE_BUDGET;
  const maxDecodeBytes = options.maxDecodeBytes ?? MAX_DECODE_BYTES;
  const normalizedMime = normalizeMime(mimeType);

  if (bytes.length === 0) {
    return { ok: false, error: 'The image is empty.' };
  }
  if (!RECODABLE_MIME.has(normalizedMime)) {
    return {
      ok: false,
      error: `Cropping is only supported for PNG and JPEG images; got ${mimeType}.`,
    };
  }
  if (
    ![region.x, region.y, region.width, region.height].every((value) => Number.isFinite(value))
  ) {
    return {
      ok: false,
      error:
        `Region coordinates must be finite numbers; got x=${String(region.x)}, ` +
        `y=${String(region.y)}, width=${String(region.width)}, height=${String(region.height)}.`,
    };
  }
  const dims = sniffImageDimensions(bytes);
  if (dims && dims.width * dims.height > MAX_DECODE_PIXELS) {
    return {
      ok: false,
      error: `The image (${String(dims.width)}x${String(dims.height)} pixels) is too large to decode for cropping.`,
    };
  }
  if (bytes.length > maxDecodeBytes) {
    return { ok: false, error: 'The image is too large to decode for cropping.' };
  }

  try {
    const { Jimp } = await import('jimp');
    const image = await Jimp.fromBuffer(Buffer.from(bytes));
    const originalWidth = image.width;
    const originalHeight = image.height;

    const x = Math.floor(region.x);
    const y = Math.floor(region.y);
    if (x < 0 || y < 0 || x >= originalWidth || y >= originalHeight || region.width < 1 || region.height < 1) {
      return {
        ok: false,
        error:
          `Region (x=${String(region.x)}, y=${String(region.y)}, width=${String(region.width)}, ` +
          `height=${String(region.height)}) lies outside the ${String(originalWidth)}x${String(originalHeight)} image.`,
      };
    }
    const w = Math.min(Math.floor(region.width), originalWidth - x);
    const h = Math.min(Math.floor(region.height), originalHeight - y);
    const applied: ImageCropRegion = { x, y, width: w, height: h };
    image.crop({ x, y, w, h });
    const sourceIsPng = normalizedMime === 'image/png';

    if (options.skipResize === true) {
      const buffer = sourceIsPng
        ? await image.getBuffer('image/png', { deflateLevel: 9 })
        : await image.getBuffer('image/jpeg', { quality: 90 });
      if (buffer.length > byteBudget) {
        return {
          ok: false,
          error:
            `The cropped region encodes to ${String(buffer.length)} bytes ` +
            `(${formatByteSize(buffer.length)}), over the ${String(byteBudget)}-byte ` +
            `(${formatByteSize(byteBudget)}) per-image limit. ` +
            'Choose a smaller region, or allow downscaling.',
        };
      }
      return {
        ok: true,
        data: new Uint8Array(buffer),
        mimeType: sourceIsPng ? 'image/png' : 'image/jpeg',
        width: image.width,
        height: image.height,
        originalWidth,
        originalHeight,
        region: applied,
        resized: false,
        originalByteLength: bytes.length,
        finalByteLength: buffer.length,
      };
    }

    fitWithinEdge(image, maxEdge);
    const encoded = await encodeWithinBudget(image, {
      sourceIsPng,
      byteBudget,
      fallbackEdge: FALLBACK_EDGE_PX,
    });
    return {
      ok: true,
      data: new Uint8Array(encoded.data),
      mimeType: encoded.mimeType,
      width: encoded.width,
      height: encoded.height,
      originalWidth,
      originalHeight,
      region: applied,
      resized: encoded.width !== w || encoded.height !== h,
      originalByteLength: bytes.length,
      finalByteLength: encoded.data.length,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to decode the image for cropping: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

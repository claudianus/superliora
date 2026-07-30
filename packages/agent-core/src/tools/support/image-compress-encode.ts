/** Longest-edge ceiling (px). Larger images are scaled down to fit. */
export const MAX_IMAGE_EDGE_PX = 2000;

/**
 * Raw-byte budget for a single image. base64 inflates bytes by ~4/3, so a
 * 3.75 MB raw payload stays under a 5 MB encoded ceiling.
 */
export const IMAGE_BYTE_BUDGET = 3.75 * 1024 * 1024;

/** Progressively lower JPEG quality until the payload fits the byte budget. */
const JPEG_QUALITY_STEPS = [80, 60, 40, 20] as const;

/** Last-ditch longest edge when the budget cannot be met at MAX_IMAGE_EDGE_PX. */
export const FALLBACK_EDGE_PX = 1000;

const MAX_DECODE_PIXELS = 100_000_000;

export const MAX_DECODE_BYTES = 64 * 1024 * 1024;

/** Formats we can both decode and re-encode with the default jimp build. */
export const RECODABLE_MIME = new Set(['image/png', 'image/jpeg']);

/** The concrete jimp image instance type, derived from the lazily-loaded module. */
type JimpImage = Awaited<ReturnType<(typeof import('jimp'))['Jimp']['fromBuffer']>>;

interface EncodedImage {
  readonly data: Buffer;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

interface EncodeOptions {
  readonly sourceIsPng: boolean;
  readonly byteBudget: number;
  readonly fallbackEdge: number;
}

/**
 * Encode `image` (already fitted to the edge ceiling) under the byte budget.
 */
export async function encodeWithinBudget(image: JimpImage, opts: EncodeOptions): Promise<EncodedImage> {
  const { sourceIsPng, byteBudget, fallbackEdge } = opts;
  let smallest: EncodedImage | null = null;

  const consider = (data: Buffer, mimeType: string): EncodedImage => {
    const candidate: EncodedImage = { data, mimeType, width: image.width, height: image.height };
    if (smallest === null || candidate.data.length < smallest.data.length) {
      smallest = candidate;
    }
    return candidate;
  };

  if (sourceIsPng) {
    const png = await image.getBuffer('image/png', { deflateLevel: 9 });
    if (png.length <= byteBudget) return consider(png, 'image/png');
    consider(png, 'image/png');

    if (fitWithinEdge(image, fallbackEdge)) {
      const smallerPng = await image.getBuffer('image/png', { deflateLevel: 9 });
      if (smallerPng.length <= byteBudget) return consider(smallerPng, 'image/png');
      consider(smallerPng, 'image/png');
    }

    for (const quality of JPEG_QUALITY_STEPS) {
      const jpeg = await image.getBuffer('image/jpeg', { quality });
      if (jpeg.length <= byteBudget) return consider(jpeg, 'image/jpeg');
      consider(jpeg, 'image/jpeg');
    }
    return smallest!;
  }

  for (const quality of JPEG_QUALITY_STEPS) {
    const jpeg = await image.getBuffer('image/jpeg', { quality });
    if (jpeg.length <= byteBudget) return consider(jpeg, 'image/jpeg');
    consider(jpeg, 'image/jpeg');
  }
  if (fitWithinEdge(image, fallbackEdge)) {
    const jpeg = await image.getBuffer('image/jpeg', { quality: JPEG_QUALITY_STEPS.at(-1) });
    consider(jpeg, 'image/jpeg');
  }

  return smallest!;
}

/**
 * Scale `image` so its longest edge is at most `edge`, preserving aspect
 * ratio. No-op (returns false) when the image already fits.
 */
export function fitWithinEdge(image: JimpImage, edge: number): boolean {
  const longest = Math.max(image.width, image.height);
  if (longest <= edge) return false;
  const factor = edge / longest;
  image.resize({
    w: Math.max(1, Math.round(image.width * factor)),
    h: Math.max(1, Math.round(image.height * factor)),
  });
  return true;
}

export function normalizeMime(mimeType: string): string {
  const lower = mimeType.trim().toLowerCase();
  return lower === 'image/jpg' ? 'image/jpeg' : lower;
}

export { MAX_DECODE_PIXELS };

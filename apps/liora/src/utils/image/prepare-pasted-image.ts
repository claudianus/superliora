/**
 * Normalize a pasted clipboard/drop image before it becomes a composer
 * attachment.
 *
 * Goals:
 *   - Keep vision-friendly MIME (PNG/JPEG/WebP/GIF).
 *   - Downscale huge screenshots so the prompt payload stays reasonable.
 *   - Prefer PNG when re-encoding so transcript half-block / kitty previews
 *     can decode without a second format pipeline.
 *
 * Uses `jimp` when resolvable (optional; agent-core already depends on it).
 * When jimp is unavailable the original bytes are returned unchanged so paste
 * still works — the model path may compress later.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseImageMeta, type SupportedImageMime } from '#/utils/image/image-mime';

/** Longest edge (px) after paste prepare. Matches agent-core vision budget. */
export const PASTED_IMAGE_MAX_EDGE_PX = 2000;

/** Raw byte budget for a single pasted attachment (~5 MB base64 ceiling). */
export const PASTED_IMAGE_BYTE_BUDGET = 3.75 * 1024 * 1024;

export interface PreparedPastedImage {
  readonly bytes: Uint8Array;
  readonly mime: SupportedImageMime;
  readonly width: number;
  readonly height: number;
  readonly changed: boolean;
  readonly originalByteLength: number;
}

/**
 * Structural jimp surface we use. Avoids a compile-time `jimp` dependency
 * (apps/liora does not declare jimp; agent-core does and we resolve it at
 * runtime when present).
 */
interface JimpBitmapImage {
  width: number;
  height: number;
  bitmap: { data: Uint8Array | Buffer };
  resize(opts: { w: number; h: number }): unknown;
  getBuffer(mime: string, opts?: { quality?: number; deflateLevel?: number }): Promise<Buffer>;
}

interface JimpModuleLike {
  Jimp: {
    fromBuffer(buf: Buffer): Promise<JimpBitmapImage>;
  };
}

let jimpModulePromise: Promise<JimpModuleLike | null> | undefined;

async function loadJimp(): Promise<JimpModuleLike | null> {
  if (jimpModulePromise !== undefined) return jimpModulePromise;
  jimpModulePromise = (async () => {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      // apps/liora/src/utils/image → monorepo packages/agent-core
      const agentCorePkg = join(here, '../../../../../packages/agent-core/package.json');
      const require = createRequire(agentCorePkg);
      return require('jimp') as JimpModuleLike;
    } catch {
      // Fall through to bare createRequire from this module (workspace installs).
    }
    try {
      const require = createRequire(import.meta.url);
      return require('jimp') as JimpModuleLike;
    } catch {
      return null;
    }
  })();
  return jimpModulePromise;
}

/** Test seam: force a jimp module or clear the cache. */
export function setJimpModuleForTests(mod: JimpModuleLike | null | undefined): void {
  jimpModulePromise = mod === undefined ? undefined : Promise.resolve(mod);
}

/**
 * Prepare clipboard/drop image bytes for attachment + vision send.
 * Returns `null` when the payload is not a supported image.
 */
export async function preparePastedImage(
  bytes: Uint8Array,
  options?: {
    readonly maxEdge?: number;
    readonly byteBudget?: number;
  },
): Promise<PreparedPastedImage | null> {
  const meta = parseImageMeta(bytes);
  if (meta === null) return null;

  const maxEdge = options?.maxEdge ?? PASTED_IMAGE_MAX_EDGE_PX;
  const byteBudget = options?.byteBudget ?? PASTED_IMAGE_BYTE_BUDGET;
  const longest = Math.max(meta.width, meta.height);
  const withinEdge = longest <= maxEdge;
  const withinBytes = bytes.length <= byteBudget;

  // Already small enough — keep original (preserve GIF animation / WebP).
  if (withinEdge && withinBytes) {
    return {
      bytes,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      changed: false,
      originalByteLength: bytes.length,
    };
  }

  const jimp = await loadJimp();
  if (jimp === null) {
    // No resizer available: still attach original so paste is not a no-op.
    return {
      bytes,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      changed: false,
      originalByteLength: bytes.length,
    };
  }

  try {
    const image = await jimp.Jimp.fromBuffer(Buffer.from(bytes));
    const srcW = image.width;
    const srcH = image.height;
    const edge = Math.max(srcW, srcH);
    if (edge > maxEdge) {
      const scale = maxEdge / edge;
      const nextW = Math.max(1, Math.round(srcW * scale));
      const nextH = Math.max(1, Math.round(srcH * scale));
      image.resize({ w: nextW, h: nextH });
    }

    // Prefer PNG so transcript graphics (half-block / kitty) can decode it.
    let encoded = await image.getBuffer('image/png', { deflateLevel: 9 });
    let outMime: SupportedImageMime = 'image/png';
    if (encoded.length > byteBudget) {
      // Fall back to JPEG quality ladder for huge screenshots.
      for (const quality of [80, 60, 40, 20] as const) {
        const jpeg = await image.getBuffer('image/jpeg', { quality });
        if (jpeg.length <= byteBudget || jpeg.length < encoded.length) {
          encoded = jpeg;
          outMime = 'image/jpeg';
        }
        if (jpeg.length <= byteBudget) break;
      }
    }

    const outMeta = parseImageMeta(encoded);
    return {
      bytes: new Uint8Array(encoded),
      mime: outMeta?.mime ?? outMime,
      width: outMeta?.width ?? image.width,
      height: outMeta?.height ?? image.height,
      changed: true,
      originalByteLength: bytes.length,
    };
  } catch {
    return {
      bytes,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
      changed: false,
      originalByteLength: bytes.length,
    };
  }
}

/**
 * Decode any supported pasted image into RGBA pixels for half-block previews.
 * Returns `null` when the format cannot be decoded (no jimp / corrupt bytes).
 */
export async function decodeImageRgba(
  bytes: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number; pixels: Uint8ClampedArray } | null> {
  // Prefer the dependency-free PNG path for the common screenshot case.
  if (mime === 'image/png' || parseImageMeta(bytes)?.mime === 'image/png') {
    try {
      const { decodePng } = await import('#/utils/image/png-decode');
      const decoded = decodePng(bytes);
      return { width: decoded.width, height: decoded.height, pixels: decoded.pixels };
    } catch {
      // Fall through to jimp.
    }
  }

  const jimp = await loadJimp();
  if (jimp === null) return null;
  try {
    const image = await jimp.Jimp.fromBuffer(Buffer.from(bytes));
    const { width, height } = image;
    const pixels = new Uint8ClampedArray(width * height * 4);
    // jimp bitmap is RGBA packed.
    const src = image.bitmap.data;
    pixels.set(src.subarray(0, pixels.length));
    return { width, height, pixels };
  } catch {
    return null;
  }
}

/**
 * VisualDiff — lightweight image buffer comparison without a heavy image lib.
 *
 * Capabilities (no SSIM / perceptual model):
 * - byte length + sha256 equality
 * - PNG IHDR width/height when both sides are PNG
 * - shared-prefix ratio as a coarse structural similarity hint
 *
 * Replace with real SSIM later if needed; keep this path dependency-free.
 */

import { createHash } from 'node:crypto';

export type VisualDiffStatus =
  | 'identical'
  | 'dimension_mismatch'
  | 'content_changed'
  | 'size_changed';

export interface VisualDiffImageMeta {
  readonly bytes: number;
  readonly sha256: string;
  /** PNG IHDR width when buffer is a valid PNG; otherwise undefined. */
  readonly width?: number;
  /** PNG IHDR height when buffer is a valid PNG; otherwise undefined. */
  readonly height?: number;
  /** Detected format tag for display (`png` | `jpeg` | `unknown`). */
  readonly format: 'png' | 'jpeg' | 'unknown';
}

export interface VisualDiffResult {
  /** True when length and sha256 both match. */
  readonly identical: boolean;
  readonly status: VisualDiffStatus;
  readonly leftBytes: number;
  readonly rightBytes: number;
  readonly leftSha256: string;
  readonly rightSha256: string;
  /** Absolute byte-length delta (|left - right|). */
  readonly lengthDelta: number;
  readonly left: VisualDiffImageMeta;
  readonly right: VisualDiffImageMeta;
  /**
   * Shared leading-byte ratio in [0, 1]. Coarse structural hint only —
   * not perceptual similarity.
   */
  readonly sharedPrefixRatio: number;
  /** Absolute shared-prefix length in bytes. */
  readonly sharedPrefixBytes: number;
  /** One-line human summary for TUI / tool output. */
  readonly summary: string;
  /**
   * Always reminds callers this is not SSIM.
   */
  readonly note: 'MVP not pixel SSIM — byte length + sha256 + optional PNG IHDR';
}

function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOI0 = 0xff;
const JPEG_SOI1 = 0xd8;

/** True when buffer starts with the PNG signature. */
export function isPngBuffer(buf: Uint8Array): boolean {
  if (buf.byteLength < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buf[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/** True when buffer starts with JPEG SOI (FF D8). */
export function isJpegBuffer(buf: Uint8Array): boolean {
  return buf.byteLength >= 2 && buf[0] === JPEG_SOI0 && buf[1] === JPEG_SOI1;
}

/**
 * Read PNG IHDR width/height. Returns undefined when the buffer is not a
 * well-formed PNG with an IHDR chunk.
 */
export function readPngDimensions(
  buf: Uint8Array,
): { readonly width: number; readonly height: number } | undefined {
  // signature(8) + length(4) + type(4) + width(4) + height(4) = 24 minimum
  if (!isPngBuffer(buf) || buf.byteLength < 24) return undefined;
  // First chunk type must be IHDR at offset 12
  if (
    buf[12] !== 0x49 || // I
    buf[13] !== 0x48 || // H
    buf[14] !== 0x44 || // D
    buf[15] !== 0x52 // R
  ) {
    return undefined;
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width === 0 || height === 0) return undefined;
  return { width, height };
}

/**
 * Read JPEG SOF0/1/2 width/height by scanning markers. Dependency-free MVP —
 * skips non-SOF segments via their length fields.
 */
export function readJpegDimensions(
  buf: Uint8Array,
): { readonly width: number; readonly height: number } | undefined {
  if (!isJpegBuffer(buf) || buf.byteLength < 4) return undefined;
  let i = 2;
  while (i + 9 < buf.byteLength) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    // Skip fill bytes (FF FF ...)
    while (i < buf.byteLength && buf[i] === 0xff) i += 1;
    if (i >= buf.byteLength) return undefined;
    const marker = buf[i]!;
    i += 1;
    // Standalone markers without length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (i + 1 >= buf.byteLength) return undefined;
    const segLen = (buf[i]! << 8) | buf[i + 1]!;
    if (segLen < 2) return undefined;
    // SOF0 baseline, SOF1 extended sequential, SOF2 progressive
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // length(2) + precision(1) + height(2) + width(2)
      if (i + 6 >= buf.byteLength) return undefined;
      const height = (buf[i + 3]! << 8) | buf[i + 4]!;
      const width = (buf[i + 5]! << 8) | buf[i + 6]!;
      if (width === 0 || height === 0) return undefined;
      return { width, height };
    }
    i += segLen;
  }
  return undefined;
}

/** PNG IHDR or JPEG SOF dimensions when the buffer matches a known format. */
export function readImageDimensions(
  buf: Uint8Array,
): { readonly width: number; readonly height: number } | undefined {
  if (isPngBuffer(buf)) return readPngDimensions(buf);
  if (isJpegBuffer(buf)) return readJpegDimensions(buf);
  return undefined;
}

/** Count leading equal bytes between two buffers (capped for large files). */
export function sharedPrefixLength(left: Uint8Array, right: Uint8Array, maxScan = 1_048_576): number {
  const limit = Math.min(left.byteLength, right.byteLength, maxScan);
  let i = 0;
  while (i < limit && left[i] === right[i]) i += 1;
  return i;
}

function imageMeta(buf: Uint8Array): VisualDiffImageMeta {
  const png = isPngBuffer(buf);
  const jpeg = !png && isJpegBuffer(buf);
  const dims = png ? readPngDimensions(buf) : jpeg ? readJpegDimensions(buf) : undefined;
  return {
    bytes: buf.byteLength,
    sha256: sha256Hex(buf),
    width: dims?.width,
    height: dims?.height,
    format: png ? 'png' : jpeg ? 'jpeg' : 'unknown',
  };
}

function formatDims(meta: VisualDiffImageMeta): string {
  if (meta.width !== undefined && meta.height !== undefined) {
    return `${meta.width}x${meta.height}`;
  }
  return 'unknown-size';
}

function buildSummary(input: {
  readonly identical: boolean;
  readonly status: VisualDiffStatus;
  readonly left: VisualDiffImageMeta;
  readonly right: VisualDiffImageMeta;
  readonly lengthDelta: number;
  readonly sharedPrefixRatio: number;
}): string {
  if (input.identical) {
    return `identical (${formatDims(input.left)}, ${input.left.bytes} bytes)`;
  }
  if (input.status === 'dimension_mismatch') {
    return `dimension mismatch: ${formatDims(input.left)} vs ${formatDims(input.right)} (Δ${input.lengthDelta} bytes)`;
  }
  if (input.status === 'size_changed') {
    return `size changed: ${input.left.bytes} → ${input.right.bytes} bytes (Δ${input.lengthDelta})`;
  }
  const pct = Math.round(input.sharedPrefixRatio * 100);
  return `content changed: same dimensions ${formatDims(input.left)}, shared-prefix ${pct}%, Δ${input.lengthDelta} bytes`;
}

function resolveStatus(input: {
  readonly identical: boolean;
  readonly left: VisualDiffImageMeta;
  readonly right: VisualDiffImageMeta;
}): VisualDiffStatus {
  if (input.identical) return 'identical';
  const leftHas = input.left.width !== undefined && input.left.height !== undefined;
  const rightHas = input.right.width !== undefined && input.right.height !== undefined;
  if (
    leftHas &&
    rightHas &&
    (input.left.width !== input.right.width || input.left.height !== input.right.height)
  ) {
    return 'dimension_mismatch';
  }
  if (input.left.bytes !== input.right.bytes) return 'size_changed';
  return 'content_changed';
}

/**
 * Compare two PNG (or any image) byte buffers by length, sha256, and optional
 * PNG IHDR dimensions. Adds a shared-prefix ratio as a coarse structural hint.
 */
export function visualDiff(left: Uint8Array, right: Uint8Array): VisualDiffResult {
  const leftMeta = imageMeta(left);
  const rightMeta = imageMeta(right);
  const identical =
    leftMeta.bytes === rightMeta.bytes && leftMeta.sha256 === rightMeta.sha256;
  const sharedPrefixBytes = identical
    ? leftMeta.bytes
    : sharedPrefixLength(left, right);
  const maxLen = Math.max(leftMeta.bytes, rightMeta.bytes, 1);
  const sharedPrefixRatio = identical ? 1 : sharedPrefixBytes / maxLen;
  const lengthDelta = Math.abs(leftMeta.bytes - rightMeta.bytes);
  const status = resolveStatus({ identical, left: leftMeta, right: rightMeta });
  const summary = buildSummary({
    identical,
    status,
    left: leftMeta,
    right: rightMeta,
    lengthDelta,
    sharedPrefixRatio,
  });

  return {
    identical,
    status,
    leftBytes: leftMeta.bytes,
    rightBytes: rightMeta.bytes,
    leftSha256: leftMeta.sha256,
    rightSha256: rightMeta.sha256,
    lengthDelta,
    left: leftMeta,
    right: rightMeta,
    sharedPrefixRatio,
    sharedPrefixBytes,
    summary,
    note: 'MVP not pixel SSIM — byte length + sha256 + optional PNG IHDR',
  };
}

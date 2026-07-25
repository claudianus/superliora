/**
 * VisualDiff MVP — byte-level comparison of two PNG buffers.
 *
 * NOT pixel SSIM / perceptual diff. This only compares length + content
 * hash so harness code can assert "screenshot changed" without pulling
 * a heavy image library. Replace with real SSIM later if needed.
 */

import { createHash } from 'node:crypto';

export interface VisualDiffResult {
  /** True when length and sha256 both match. */
  readonly identical: boolean;
  readonly leftBytes: number;
  readonly rightBytes: number;
  readonly leftSha256: string;
  readonly rightSha256: string;
  /** Absolute byte-length delta (|left - right|). */
  readonly lengthDelta: number;
  /**
   * Always reminds callers this is MVP byte/hash equality, not SSIM.
   */
  readonly note: 'MVP not pixel SSIM — byte length + sha256 only';
}

function sha256Hex(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Compare two PNG (or any image) byte buffers by length and sha256.
 */
export function visualDiff(left: Uint8Array, right: Uint8Array): VisualDiffResult {
  const leftSha256 = sha256Hex(left);
  const rightSha256 = sha256Hex(right);
  return {
    identical: left.byteLength === right.byteLength && leftSha256 === rightSha256,
    leftBytes: left.byteLength,
    rightBytes: right.byteLength,
    leftSha256,
    rightSha256,
    lengthDelta: Math.abs(left.byteLength - right.byteLength),
    note: 'MVP not pixel SSIM — byte length + sha256 only',
  };
}

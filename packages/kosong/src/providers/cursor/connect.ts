/**
 * Connect-RPC framing for Cursor AgentService streams.
 *
 * Frame layout: `[1 flag byte][4-byte BE length][payload]`.
 * Flags: `0x01` = gzip payload, `0x02` = end-of-stream trailer.
 */

import { gunzipSync } from 'node:zlib';

export const CONNECT_FLAG_GZIP = 0x01;
export const CONNECT_FLAG_END = 0x02;
const DEFAULT_MAX_PAYLOAD = 64 * 1024 * 1024;

export interface ConnectFrame {
  readonly flags: number;
  readonly payload: Uint8Array;
}

export function encodeConnectFrame(payload: Uint8Array, flags = 0): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = flags;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(1, payload.length, false);
  out.set(payload, 5);
  return out;
}

export class ConnectFrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Uint8Array, maxPayload = DEFAULT_MAX_PAYLOAD): ConnectFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: ConnectFrame[] = [];
    while (this.buffer.length >= 5) {
      const flags = this.buffer[0]!;
      const len = this.buffer.readUInt32BE(1);
      if (len > maxPayload) {
        throw new Error(`Connect frame payload too large: ${len}`);
      }
      if (this.buffer.length < 5 + len) break;
      const payload = Uint8Array.from(this.buffer.subarray(5, 5 + len));
      this.buffer = this.buffer.subarray(5 + len);
      frames.push({ flags, payload });
    }
    return frames;
  }

  get buffered(): number {
    return this.buffer.length;
  }
}

export function decodeFramePayload(frame: ConnectFrame): Uint8Array {
  if ((frame.flags & CONNECT_FLAG_GZIP) !== 0) {
    return gunzipSync(frame.payload);
  }
  return frame.payload;
}

export interface ConnectTrailerError {
  readonly status: number;
  readonly message: string;
  readonly detail: string;
}

/** Parse Connect end-stream trailer JSON into an error when present. */
export function parseConnectEndError(payload: Uint8Array): ConnectTrailerError | undefined {
  if (payload.length === 0) return undefined;
  try {
    const text = Buffer.from(payload).toString('utf8');
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const error = (parsed as { error?: unknown }).error;
    if (typeof error !== 'object' || error === null) return undefined;
    const record = error as Record<string, unknown>;
    const code = typeof record['code'] === 'string' ? record['code'] : 'unknown';
    const message = typeof record['message'] === 'string' ? record['message'] : code;
    return {
      status: 502,
      message: `Cursor Connect error: ${message}`,
      detail: text,
    };
  } catch {
    return undefined;
  }
}


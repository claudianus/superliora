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
const CONNECT_FLAG_MASK = CONNECT_FLAG_GZIP | CONNECT_FLAG_END;

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

/**
 * If `buf` is a single Connect envelope, return the (possibly gunzipped) payload.
 * Raw protobuf (e.g. unary `application/proto` whose first byte is `0x0a`) is
 * returned unchanged.
 */
export function unwrapConnectPayload(buf: Uint8Array): Uint8Array {
  if (buf.length < 5) return buf;
  const flags = buf[0]!;
  if ((flags & ~CONNECT_FLAG_MASK) !== 0) return buf;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = view.getUint32(1, false);
  if (len > DEFAULT_MAX_PAYLOAD || 5 + len > buf.length) return buf;
  // Unary responses are exactly one frame. Extra trailing bytes mean this is
  // not a lone envelope (or is a concat of frames) — leave raw for callers
  // that already use ConnectFrameDecoder.
  if (5 + len !== buf.length) return buf;
  const payload = buf.subarray(5, 5 + len);
  if ((flags & CONNECT_FLAG_GZIP) !== 0) {
    return gunzipSync(payload);
  }
  return payload;
}

export function decodeFramePayload(frame: ConnectFrame): Uint8Array {
  if ((frame.flags & CONNECT_FLAG_GZIP) !== 0) {
    return gunzipSync(frame.payload);
  }
  return frame.payload;
}

export interface ConnectTrailerError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly detail: string;
}

const CONNECT_CODE_STATUS: Readonly<Record<string, number>> = {
  canceled: 499,
  unknown: 500,
  invalid_argument: 400,
  deadline_exceeded: 504,
  not_found: 404,
  already_exists: 409,
  permission_denied: 403,
  resource_exhausted: 429,
  failed_precondition: 400,
  aborted: 409,
  out_of_range: 400,
  unimplemented: 501,
  internal: 500,
  unavailable: 503,
  data_loss: 500,
  unauthenticated: 401,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function connectStatus(code: string): number {
  return CONNECT_CODE_STATUS[code] ?? 502;
}

function trailerFromErrorRecord(record: Record<string, unknown>, raw: string): ConnectTrailerError {
  const code = typeof record['code'] === 'string' ? record['code'] : 'unknown';
  const message = typeof record['message'] === 'string' ? record['message'] : code;
  return {
    status: connectStatus(code),
    code,
    message: `Cursor Connect error: ${message}`,
    detail: raw,
  };
}

/** Parse Connect end-stream trailer JSON into an error when present. */
export function parseConnectEndError(payload: Uint8Array): ConnectTrailerError | undefined {
  if (payload.length === 0) return undefined;
  let bytes = payload;
  if (payload.length >= 2 && payload[0] === 0x1f && payload[1] === 0x8b) {
    try {
      bytes = gunzipSync(payload);
    } catch {
      return undefined;
    }
  }
  try {
    const text = Buffer.from(bytes).toString('utf8').trim();
    if (text.length === 0) return undefined;
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return undefined;
    const nested = parsed['error'];
    if (isRecord(nested)) return trailerFromErrorRecord(nested, text);
    if (typeof parsed['code'] === 'string' || typeof parsed['message'] === 'string') {
      return trailerFromErrorRecord(parsed, text);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const GRPC_NUMERIC_STATUS: Readonly<Record<string, { readonly code: string; readonly status: number }>> = {
  '1': { code: 'canceled', status: 499 },
  '2': { code: 'unknown', status: 500 },
  '3': { code: 'invalid_argument', status: 400 },
  '4': { code: 'deadline_exceeded', status: 504 },
  '5': { code: 'not_found', status: 404 },
  '6': { code: 'already_exists', status: 409 },
  '7': { code: 'permission_denied', status: 403 },
  '8': { code: 'resource_exhausted', status: 429 },
  '9': { code: 'failed_precondition', status: 400 },
  '10': { code: 'aborted', status: 409 },
  '11': { code: 'out_of_range', status: 400 },
  '12': { code: 'unimplemented', status: 501 },
  '13': { code: 'internal', status: 500 },
  '14': { code: 'unavailable', status: 503 },
  '15': { code: 'data_loss', status: 500 },
  '16': { code: 'unauthenticated', status: 401 },
};

/** HTTP/2 trailers (`grpc-status` / Connect) when the server skips an end frame. */
export function parseHttp2Trailers(
  trailers: Readonly<Record<string, unknown>> | undefined,
): ConnectTrailerError | undefined {
  if (trailers === undefined) return undefined;
  const grpcStatus = trailerString(trailers['grpc-status']);
  if (grpcStatus !== undefined && grpcStatus !== '0') {
    const mapped = GRPC_NUMERIC_STATUS[grpcStatus];
    const grpcMessage = trailerString(trailers['grpc-message']) ?? mapped?.code ?? grpcStatus;
    const code = mapped?.code ?? grpcStatus;
    return {
      status: mapped?.status ?? 502,
      code,
      message: `Cursor Connect error: ${grpcMessage}`,
      detail: grpcMessage,
    };
  }
  const connectError = trailerString(trailers['connect-error']) ?? trailerString(trailers['error']);
  if (connectError !== undefined && connectError.length > 0) {
    try {
      return parseConnectEndError(Buffer.from(connectError, 'utf8'));
    } catch {
      return {
        status: 502,
        code: 'unknown',
        message: `Cursor Connect error: ${connectError}`,
        detail: connectError,
      };
    }
  }
  return undefined;
}

function trailerString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) return value[0];
  return undefined;
}

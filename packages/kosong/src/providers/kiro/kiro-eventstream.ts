/**
 * `application/vnd.amazon.eventstream` decoder for the CodeWhisperer
 * streaming transport.
 *
 * Wire format (all integers big-endian):
 *
 *   [total length     u32]
 *   [headers length   u32]
 *   [prelude CRC32    u32]   <- CRC over the first 8 bytes
 *   [headers          headers_length]
 *   [payload          total_length - headers_length - 16]
 *   [message CRC32    u32]   <- CRC over the entire message minus the trailing 4 bytes
 *
 * Headers: a sequence of `[name_len u8][name utf8][value_type u8][value …]`.
 * CodeWhisperer only sets string-valued headers in practice (`:event-type`,
 * `:message-type`, `:exception-type`), but all published header types are
 * decoded so malformed inputs fail loudly instead of silently mis-framing.
 */

const PRELUDE_LEN = 8;
const PRELUDE_CRC_LEN = 4;
const MESSAGE_CRC_LEN = 4;
const HEADER_BLOCK_OFFSET = PRELUDE_LEN + PRELUDE_CRC_LEN;
const MIN_MESSAGE_LEN = HEADER_BLOCK_OFFSET + MESSAGE_CRC_LEN;

export interface EventStreamMessage {
  headers: Record<string, string>;
  payload: Uint8Array;
}

/** CRC32 (IEEE / zlib polynomial 0xEDB88320). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    const entry = CRC_TABLE[(c ^ byte) & 0xff] ?? 0;
    c = (entry ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Decodes a single, fully buffered eventstream message; throws on bad framing/CRC. */
export function decodeEventStreamMessage(frame: Uint8Array): EventStreamMessage {
  if (frame.length < MIN_MESSAGE_LEN) throw new Error('eventstream: frame too short');
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const total = view.getUint32(0, false);
  if (total !== frame.length) {
    throw new Error(`eventstream: framed length ${String(total)} != buffer ${String(frame.length)}`);
  }
  const headersLen = view.getUint32(4, false);
  const preludeCrc = view.getUint32(8, false);
  if (crc32(frame.subarray(0, PRELUDE_LEN)) !== preludeCrc) {
    throw new Error('eventstream: prelude CRC mismatch');
  }
  const msgCrc = view.getUint32(total - MESSAGE_CRC_LEN, false);
  if (crc32(frame.subarray(0, total - MESSAGE_CRC_LEN)) !== msgCrc) {
    throw new Error('eventstream: message CRC mismatch');
  }

  const headersBytes = frame.subarray(HEADER_BLOCK_OFFSET, HEADER_BLOCK_OFFSET + headersLen);
  const payload = frame.subarray(HEADER_BLOCK_OFFSET + headersLen, total - MESSAGE_CRC_LEN);
  return { headers: parseEventStreamHeaders(headersBytes), payload };
}

function parseEventStreamHeaders(buf: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const decoder = new TextDecoder();
  let p = 0;
  while (p < buf.length) {
    const nameLen = view.getUint8(p);
    p += 1;
    const name = decoder.decode(buf.subarray(p, p + nameLen));
    p += nameLen;
    const type = view.getUint8(p);
    p += 1;
    switch (type) {
      case 0:
        out[name] = 'true';
        break;
      case 1:
        out[name] = 'false';
        break;
      case 2:
        out[name] = String(view.getInt8(p));
        p += 1;
        break;
      case 3:
        out[name] = String(view.getInt16(p, false));
        p += 2;
        break;
      case 4:
        out[name] = String(view.getInt32(p, false));
        p += 4;
        break;
      case 5:
        out[name] = bigIntFromBytes(buf.subarray(p, p + 8)).toString();
        p += 8;
        break;
      case 6: {
        const len = view.getUint16(p, false);
        p += 2;
        out[name] = Buffer.from(buf.buffer, buf.byteOffset + p, len).toString('base64');
        p += len;
        break;
      }
      case 7: {
        const len = view.getUint16(p, false);
        p += 2;
        out[name] = decoder.decode(buf.subarray(p, p + len));
        p += len;
        break;
      }
      case 8:
        out[name] = new Date(Number(bigIntFromBytes(buf.subarray(p, p + 8)))).toISOString();
        p += 8;
        break;
      case 9: {
        const u = buf.subarray(p, p + 16);
        const hex: string[] = [];
        for (let i = 0; i < 16; i++) hex.push((u[i] ?? 0).toString(16).padStart(2, '0'));
        out[name] =
          `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
        p += 16;
        break;
      }
      default:
        throw new Error(`eventstream: unknown header value type ${String(type)}`);
    }
  }
  return out;
}

function bigIntFromBytes(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = 0; i < b.length; i++) v = (v << 8n) | BigInt(b[i] ?? 0);
  const high = b[0] ?? 0;
  if (b.length === 8 && (high & 0x80) !== 0) v -= 1n << 64n;
  return v;
}

/**
 * Async generator over a fetch response body that yields fully-framed
 * messages, handling arbitrary chunk boundaries.
 */
export async function* decodeAmazonEventStream(
  source: ReadableStream<Uint8Array>,
): AsyncGenerator<EventStreamMessage> {
  const reader = source.getReader();
  let buf: Uint8Array = new Uint8Array(0);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value !== undefined && value.length > 0) {
        buf = buf.length === 0 ? new Uint8Array(value) : new Uint8Array(Buffer.concat([buf, value]));
      }
      let offset = 0;
      while (buf.length - offset >= 4) {
        const dv = new DataView(buf.buffer, buf.byteOffset + offset, buf.length - offset);
        const total = dv.getUint32(0, false);
        if (total < MIN_MESSAGE_LEN) {
          throw new Error(`eventstream: total length ${String(total)} below minimum`);
        }
        if (buf.length - offset < total) break;
        yield decodeEventStreamMessage(buf.subarray(offset, offset + total));
        offset += total;
      }
      if (offset > 0) buf = buf.slice(offset);
      if (done) break;
    }
    if (buf.length > 0) throw new Error('eventstream: truncated message at end of stream');
  } finally {
    reader.releaseLock();
  }
}

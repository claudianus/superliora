/**
 * Hand-rolled protobuf helpers for Cursor's AgentService/Run wire.
 *
 * Ported from the public MIT shunt project's cursor adapter encoding —
 * Cursor does not publish this schema for third-party clients.
 */

export function encodeVarint(value: number | bigint, out: number[] = []): number[] {
  let v = typeof value === 'bigint' ? value : BigInt(value);
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

export function fieldLd(field: number, data: Uint8Array | number[]): Uint8Array {
  const payload = data instanceof Uint8Array ? data : Uint8Array.from(data);
  const header: number[] = [];
  encodeVarint((field << 3) | 2, header);
  encodeVarint(payload.length, header);
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

export function fieldVarint(field: number, value: number): Uint8Array {
  const out: number[] = [];
  encodeVarint(field << 3, out);
  encodeVarint(value, out);
  return Uint8Array.from(out);
}

export function fieldStr(field: number, s: string): Uint8Array {
  return fieldLd(field, Buffer.from(s, 'utf8'));
}

export function fieldDouble(field: number, value: number): Uint8Array {
  const header: number[] = [];
  encodeVarint((field << 3) | 1, header);
  const buf = Buffer.alloc(header.length + 8);
  Buffer.from(header).copy(buf, 0);
  buf.writeDoubleLE(value, header.length);
  return new Uint8Array(buf);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const part of parts) len += part.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export interface PbField {
  readonly field: number;
  readonly wire: number;
  readonly data: Uint8Array;
  /** Present when `wire === 0` (varint). */
  readonly varint?: bigint;
}

export function* iterFields(buf: Uint8Array): Generator<PbField> {
  let offset = 0;
  while (offset < buf.length) {
    const tag = readVarint(buf, offset);
    if (tag === undefined) return;
    offset = tag.next;
    const field = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (wire === 0) {
      const v = readVarint(buf, offset);
      if (v === undefined) return;
      offset = v.next;
      yield { field, wire, data: new Uint8Array(0), varint: v.value };
    } else if (wire === 2) {
      const len = readVarint(buf, offset);
      if (len === undefined) return;
      offset = len.next;
      const size = Number(len.value);
      if (offset + size > buf.length) return;
      yield { field, wire, data: buf.subarray(offset, offset + size) };
      offset += size;
    } else if (wire === 5) {
      if (offset + 4 > buf.length) return;
      const data = buf.subarray(offset, offset + 4);
      offset += 4;
      yield { field, wire, data };
    } else if (wire === 1) {
      if (offset + 8 > buf.length) return;
      const data = buf.subarray(offset, offset + 8);
      offset += 8;
      yield { field, wire, data };
    } else {
      return;
    }
  }
}

export function readVarint(
  buf: Uint8Array,
  offset: number,
): { readonly value: bigint; readonly next: number } | undefined {
  let result = 0n;
  let shift = 0n;
  for (let i = offset; i < buf.length; i++) {
    const byte = buf[i]!;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result, next: i + 1 };
    }
    shift += 7n;
    if (shift >= 64n) return undefined;
  }
  return undefined;
}

/** Encode JSON as `google.protobuf.Value` bytes. */
export function encodeProtobufValue(value: unknown): Uint8Array {
  if (value === null || value === undefined) {
    return fieldVarint(1, 0);
  }
  if (typeof value === 'boolean') {
    return fieldVarint(4, value ? 1 : 0);
  }
  if (typeof value === 'number') {
    return fieldDouble(2, value);
  }
  if (typeof value === 'string') {
    return fieldStr(3, value);
  }
  if (Array.isArray(value)) {
    const parts: Uint8Array[] = [];
    for (const item of value) {
      parts.push(fieldLd(1, encodeProtobufValue(item)));
    }
    return fieldLd(6, concatBytes(...parts));
  }
  if (typeof value === 'object') {
    const parts: Uint8Array[] = [];
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      parts.push(fieldLd(1, concatBytes(fieldStr(1, key), fieldLd(2, encodeProtobufValue(val)))));
    }
    return fieldLd(5, concatBytes(...parts));
  }
  return fieldVarint(1, 0);
}

const MAX_PROTOBUF_VALUE_DEPTH = 64;

/** Decode `google.protobuf.Value` bytes into JSON. */
export function decodeProtobufValue(buf: Uint8Array, depth = 0): unknown {
  if (depth >= MAX_PROTOBUF_VALUE_DEPTH || buf.length === 0) return null;
  let decoded: unknown = null;
  let found = false;
  for (const entry of iterFields(buf)) {
    switch (entry.field) {
      case 1:
        decoded = null;
        found = true;
        break;
      case 2: {
        if (entry.wire === 1 && entry.data.length >= 8) {
          decoded = Buffer.from(entry.data.subarray(0, 8)).readDoubleLE(0);
          found = true;
        }
        break;
      }
      case 3:
        if (entry.wire === 2) {
          decoded = Buffer.from(entry.data).toString('utf8');
          found = true;
        }
        break;
      case 4:
        if (entry.wire === 0) {
          decoded = entry.varint !== undefined && entry.varint !== 0n;
          found = true;
        }
        break;
      case 5:
        if (entry.wire === 2) {
          decoded = decodeProtobufStruct(entry.data, depth + 1);
          found = true;
        }
        break;
      case 6:
        if (entry.wire === 2) {
          const items: unknown[] = [];
          for (const listEntry of iterFields(entry.data)) {
            if (listEntry.field === 1 && listEntry.wire === 2) {
              items.push(decodeProtobufValue(listEntry.data, depth + 1));
            }
          }
          decoded = items;
          found = true;
        }
        break;
      default:
        break;
    }
  }
  return found ? decoded : null;
}

function decodeProtobufStruct(buf: Uint8Array, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of iterFields(buf)) {
    if (entry.field !== 1 || entry.wire !== 2) continue;
    let key: string | undefined;
    let valueBuf: Uint8Array | undefined;
    for (const part of iterFields(entry.data)) {
      if (part.field === 1 && part.wire === 2) {
        key = Buffer.from(part.data).toString('utf8');
      } else if (part.field === 2 && part.wire === 2) {
        valueBuf = part.data;
      }
    }
    if (key !== undefined && valueBuf !== undefined) {
      out[key] = decodeProtobufValue(valueBuf, depth);
    }
  }
  return out;
}

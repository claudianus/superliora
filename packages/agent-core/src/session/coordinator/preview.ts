export function boundedUtf8(text: string, maxBytes: number, tail = false): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const bytes = Buffer.from(text);
  let start = tail ? bytes.length - maxBytes : 0;
  let end = tail ? bytes.length : maxBytes;
  if (tail) while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  else while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(start, end).toString('utf8');
}

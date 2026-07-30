export function codePointAt(input: string, index: number): string {
  return String.fromCodePoint(input.codePointAt(index) ?? 0);
}

export function isPrintable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
}

export function consumeUnknownControlSequence(input: string, index: number): string | undefined {
  for (let cursor = index + 2; cursor < input.length; cursor++) {
    const code = input.codePointAt(cursor) ?? 0;
    if (code >= 0x40 && code <= 0x7e) return input.slice(index, cursor + 1);
  }
  return undefined;
}

export function splitDecodableUtf8(buffer: Buffer): { readonly text: string; readonly pending: Buffer } {
  if (buffer.length === 0) return { text: '', pending: Buffer.alloc(0) };

  // Walk backward from the end to detect a potentially incomplete multi-byte
  // UTF-8 sequence. Count trailing continuation bytes (0x80–0xBF), then check
  // the leading byte they belong to (if any) against its expected length.
  let trailingContinuations = 0;
  while (
    trailingContinuations < 3 &&
    trailingContinuations < buffer.length &&
    (buffer[buffer.length - 1 - trailingContinuations]! & 0xc0) === 0x80
  ) {
    trailingContinuations++;
  }

  const leadingByteIndex = buffer.length - 1 - trailingContinuations;
  const leadingByte = buffer[leadingByteIndex];

  let expectedLength = 0;
  if (leadingByte !== undefined) {
    if ((leadingByte & 0xe0) === 0xc0) expectedLength = 2;
    else if ((leadingByte & 0xf0) === 0xe0) expectedLength = 3;
    else if ((leadingByte & 0xf8) === 0xf0) expectedLength = 4;
  }

  // If the trailing bytes (including the leading byte itself) are fewer than
  // the sequence expects, the rest will arrive in the next chunk.
  if (expectedLength > 0 && trailingContinuations + 1 < expectedLength) {
    const end = leadingByteIndex;
    if (end === 0) return { text: '', pending: Buffer.from(buffer) };
    return {
      text: buffer.subarray(0, end).toString('utf8'),
      pending: Buffer.from(buffer.subarray(end)),
    };
  }

  // No partial multi-byte sequence at the end — decode everything.
  return { text: buffer.toString('utf8'), pending: Buffer.alloc(0) };
}

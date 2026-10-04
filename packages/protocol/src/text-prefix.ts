/* eslint-disable unicorn/prefer-code-point -- Decode UTF-16 code units explicitly so split surrogate deltas remain pending. */
/** A byte-bounded, well-formed Unicode prefix, without encoding the full input. */
export function utf8Prefix(text: string, maxBytes: number): string {
  return new Utf8PrefixBuffer(maxBytes).append(text);
}

/**
 * Incremental UTF-8 prefix. A trailing high surrogate is held (not displayed)
 * until the next nonempty delta. The first scalar that cannot fit freezes the
 * prefix; later smaller scalars never backfill it. Invalid lone surrogates are
 * replaced with U+FFFD. Work is bounded by remaining bytes plus one scalar.
 */
export class Utf8PrefixBuffer {
  private value = '';
  private usedBytes = 0;
  private pendingHigh = '';
  private stopped = false;

  constructor(private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new RangeError('maxBytes must be a nonnegative safe integer');
    }
  }

  get text(): string { return this.value; }
  get bytes(): number { return this.usedBytes; }
  get frozen(): boolean { return this.stopped; }
  get byteLength(): number { return this.usedBytes; }
  get isFull(): boolean { return this.stopped || this.usedBytes === this.maxBytes; }

  append(delta: string): string {
    if (this.stopped || delta.length === 0) return this.value;
    if (this.usedBytes === this.maxBytes) {
      // Exactly full: any nonempty delta holds a scalar that cannot fit.
      this.stopped = true;
      this.pendingHigh = '';
      return this.value;
    }
    let i = 0;
    const parts: string[] = [];
    const emit = (scalar: string, size: number): boolean => {
      if (this.usedBytes + size > this.maxBytes) {
        this.stopped = true;
        return false;
      }
      parts.push(scalar);
      this.usedBytes += size;
      return true;
    };
    if (this.pendingHigh) {
      const low = delta.charCodeAt(0);
      const high = this.pendingHigh;
      this.pendingHigh = '';
      if (low >= 0xDC00 && low <= 0xDFFF) {
        i = 1;
        emit(high + delta[0], 4);
      } else {
        emit('\uFFFD', 3);
      }
    }
    while (i < delta.length && !this.stopped) {
      const unit = delta.charCodeAt(i);
      if (unit >= 0xD800 && unit <= 0xDBFF) {
        if (i + 1 === delta.length) {
          this.pendingHigh = delta[i] ?? '';
          break;
        }
        const next = delta.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          if (!emit(delta.slice(i, i + 2), 4)) break;
          i += 2;
          continue;
        }
        if (!emit('\uFFFD', 3)) break;
      } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
        if (!emit('\uFFFD', 3)) break;
      } else if (!emit(delta[i] ?? '', unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3)) {
        break;
      }
      i++;
    }
    this.value += parts.join('');
    return this.value;
  }
}

import { describe, expect, it } from 'vitest';
import { utf8Prefix, Utf8PrefixBuffer } from '../text-prefix';

describe('UTF-8 prefixes', () => {
  it('counts bytes, keeps scalars intact, and stops at the first nonfitting scalar', () => {
    expect(utf8Prefix('中😀x', 7)).toBe('中😀');
    expect(utf8Prefix('中😀x', 6)).toBe('中');
    expect(utf8Prefix('éx', 2)).toBe('é');
    expect(utf8Prefix('😀x', 3)).toBe('');
    expect(utf8Prefix('abc', 0)).toBe('');
    for (let budget = 0; budget < 20; budget++) {
      const prefix = utf8Prefix('é中😀hello中😀', budget);
      expect(Buffer.byteLength(prefix)).toBeLessThanOrEqual(budget);
      expect(prefix.isWellFormed()).toBe(true);
    }
  });

  it('holds split surrogate pairs invisibly across deltas', () => {
    const buffer = new Utf8PrefixBuffer(7);
    expect(buffer.append('中\uD83D')).toBe('中');
    expect(buffer.byteLength).toBe(3);
    expect(buffer.append('')).toBe('中');
    expect(buffer.append('\uDE00tail')).toBe('中😀');
    expect(buffer.byteLength).toBe(7);
    expect(buffer.isFull).toBe(true);
    expect(utf8Prefix('a\uD83D', 10)).toBe('a');
  });

  it('freezes without backfilling leftover room across deltas', () => {
    const buffer = new Utf8PrefixBuffer(6);
    buffer.append('中\uD83D');
    expect(buffer.append('\uDE00')).toBe('中');
    expect(buffer.isFull).toBe(true);
    expect(buffer.append('abc')).toBe('中');
    expect(buffer.byteLength).toBe(3);
    expect(buffer.bytes).toBe(3);
    expect(buffer.frozen).toBe(true);
  });

  it('normalizes lone surrogates, including unresolved high surrogates', () => {
    const buffer = new Utf8PrefixBuffer(20);
    expect(buffer.append('\uD800')).toBe('');
    expect(buffer.append('a\uDC00b')).toBe('�a�b');
    expect(utf8Prefix('\uD800x\uDC00', 20)).toBe('�x�');
  });

  it('does not encode or serialize an enormous delta', () => {
    const buffer = new Utf8PrefixBuffer(4);
    expect(buffer.append('😀'.repeat(1_000_000))).toBe('😀');
    expect(buffer.append('x'.repeat(1_000_000))).toBe('😀');
  });
});

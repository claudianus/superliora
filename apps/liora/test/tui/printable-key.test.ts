import { describe, expect, it } from 'vitest';

import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';

describe('isPrintableChar', () => {
  it('accepts single ASCII characters and space', () => {
    expect(isPrintableChar('q')).toBe(true);
    expect(isPrintableChar('R')).toBe(true);
    expect(isPrintableChar(' ')).toBe(true);
    expect(isPrintableChar('/')).toBe(true);
    expect(isPrintableChar('5')).toBe(true);
  });

  it('accepts single hangul syllables', () => {
    expect(isPrintableChar('가')).toBe(true);
    expect(isPrintableChar('힣')).toBe(true);
  });

  it('accepts merged multi-character stdin chunks (hangul coalescing)', () => {
    // A busy event loop can coalesce two hangul syllables into one stdin
    // chunk; the whole chunk must be appendable to a search query.
    expect(isPrintableChar('한글')).toBe(true);
    expect(isPrintableChar('한국어 검색')).toBe(true);
  });

  it('accepts surrogate pairs (emoji and CJK ideograph extensions)', () => {
    expect(isPrintableChar('😀')).toBe(true);
    expect(isPrintableChar('𠀀')).toBe(true);
  });

  it('rejects control characters, DEL, and escape sequences', () => {
    expect(isPrintableChar('')).toBe(false);
    expect(isPrintableChar('\r')).toBe(false);
    expect(isPrintableChar('\n')).toBe(false);
    expect(isPrintableChar('\t')).toBe(false);
    expect(isPrintableChar('\u007F')).toBe(false);
    expect(isPrintableChar('\u001B')).toBe(false);
    expect(isPrintableChar('\u001B[114u')).toBe(false);
  });

  it('rejects chunks containing any control character', () => {
    expect(isPrintableChar('a\nb')).toBe(false);
    expect(isPrintableChar('가\u001B나')).toBe(false);
  });

  it('decodes kitty CSI-u printable keys before the check', () => {
    expect(printableChar('\u001B[114u')).toBe('r');
    expect(isPrintableChar(printableChar('\u001B[114u'))).toBe(true);
  });
});

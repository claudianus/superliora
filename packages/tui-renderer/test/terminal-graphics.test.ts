import { describe, expect, it } from 'vitest';

import {
  KITTY_PLACEHOLDER_CODE_POINT,
  ROW_COLUMN_DIACRITICS,
  encodeKittyDeleteImage,
  encodeKittyPlaceholderLines,
  encodeKittyPlaceholderTransmit,
} from '../src';

const ESC = '\u001B';
const ST = `${ESC}\\`;

describe('kitty unicode placeholder encoders', () => {
  it('ships the first 256 row/column diacritics', () => {
    expect(ROW_COLUMN_DIACRITICS).toHaveLength(256);
    expect(ROW_COLUMN_DIACRITICS[0]).toBe(0x0305);
    expect(ROW_COLUMN_DIACRITICS[1]).toBe(0x030d);
    expect(ROW_COLUMN_DIACRITICS[2]).toBe(0x030e);
  });

  it('encodes placeholder lines with the id color and row/column diacritics', () => {
    const lines = encodeKittyPlaceholderLines({ id: 42, columns: 2, rows: 2 });

    expect(lines).toEqual([
      `${ESC}[38;2;0;0;42m\u{10EEEE}\u{0305}\u{0305}\u{10EEEE}\u{0305}\u{030D}${ESC}[39m`,
      `${ESC}[38;2;0;0;42m\u{10EEEE}\u{030D}\u{0305}\u{10EEEE}\u{030D}\u{030D}${ESC}[39m`,
    ]);
  });

  it('uses the placeholder code point for every cell', () => {
    expect(KITTY_PLACEHOLDER_CODE_POINT).toBe(0x10_eeee);
    const [line] = encodeKittyPlaceholderLines({ id: 1, columns: 1, rows: 1 });
    expect(line).toContain('\u{10EEEE}');
  });

  it('encodes a single-chunk virtual placement transmit', () => {
    const output = encodeKittyPlaceholderTransmit({ id: 7, base64: 'AAAA', columns: 3, rows: 2 });

    expect(output.startsWith(`${ESC}_G`)).toBe(true);
    expect(output.endsWith(ST)).toBe(true);
    expect(output).toContain('a=T,U=1,i=7,c=3,r=2,q=2');
    expect(output).toContain('m=0');
    expect(output).not.toContain('m=1');
    expect(output).toBe(`${ESC}_Ga=T,U=1,i=7,c=3,r=2,q=2,m=0;AAAA${ST}`);
  });

  it('splits long payloads into continuation chunks', () => {
    const base64 = 'A'.repeat(10_000);
    const output = encodeKittyPlaceholderTransmit({ id: 3, base64, columns: 4, rows: 4 });

    const commands = [...output.matchAll(/\u001B_G([^;]*);([\s\S]*?)\u001B\\/g)];
    expect(commands).toHaveLength(3);
    expect(commands[0]![1]).toContain('a=T,U=1,i=3,c=4,r=4,q=2');
    expect(commands[0]![1]).toContain('m=1');
    expect(commands[1]![1]).toBe('m=1');
    expect(commands[2]![1]).toBe('m=0');
    expect(commands.map((match) => match[2]).join('')).toBe(base64);
  });

  it('encodes per-image deletion', () => {
    expect(encodeKittyDeleteImage(9)).toBe(`${ESC}_Ga=d,d=i,i=9,q=2${ST}`);
  });
});

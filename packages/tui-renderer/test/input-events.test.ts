import { describe, expect, it } from 'vitest';

import {
  decodeKittyPrintable,
  decodeNativeInput,
  encodeNativeInputAsLegacySequence,
  fuzzyFilter,
  fuzzyMatch,
  isKeyRelease,
  Key,
  matchesKey,
  NativeInputDecoder,
  parseKey,
} from '../src';

describe('NativeInputDecoder', () => {
  it('decodes printable text, controls, and legacy navigation sequences', () => {
    expect(decodeNativeInput('a\u0003\u001B[A\u001B[B\u001B[5~\u001B[6~\r')).toEqual([
      { type: 'key', key: 'character', raw: 'a', text: 'a', ctrl: false, alt: false, shift: false },
      { type: 'key', key: 'character', raw: '\u0003', text: 'c', ctrl: true, alt: false, shift: false },
      { type: 'key', key: 'up', raw: '\u001B[A', ctrl: false, alt: false, shift: false },
      { type: 'key', key: 'down', raw: '\u001B[B', ctrl: false, alt: false, shift: false },
      { type: 'key', key: 'pageup', raw: '\u001B[5~', ctrl: false, alt: false, shift: false },
      { type: 'key', key: 'pagedown', raw: '\u001B[6~', ctrl: false, alt: false, shift: false },
      { type: 'key', key: 'enter', raw: '\r', ctrl: false, alt: false, shift: false },
    ]);
  });

  it('decodes home/end/delete/insert, focus, shift-tab, escape, and alt text', () => {
    expect(decodeNativeInput('\u001B[H\u001B[F\u001B[3~\u001B[2~\u001B[I\u001B[O\u001B[Z\u001Ba\u001B')).toEqual([
      { type: 'key', key: 'home', raw: '\u001B[H', ctrl: false, alt: false, shift: false },
      { type: 'key', key: 'end', raw: '\u001B[F', ctrl: false, alt: false, shift: false },
      { type: 'key', key: 'delete', raw: '\u001B[3~', ctrl: false, alt: false, shift: false },
      { type: 'key', key: 'insert', raw: '\u001B[2~', ctrl: false, alt: false, shift: false },
      { type: 'focus', focused: true, raw: '\u001B[I' },
      { type: 'focus', focused: false, raw: '\u001B[O' },
      { type: 'key', key: 'tab', raw: '\u001B[Z', ctrl: false, alt: false, shift: true },
      { type: 'key', key: 'character', raw: '\u001Ba', text: 'a', ctrl: false, alt: true, shift: false },
      { type: 'key', key: 'escape', raw: '\u001B', ctrl: false, alt: false, shift: false },
    ]);
  });

  it('decodes terminal mode reports without treating them as app input', () => {
    const events = decodeNativeInput('\u001B[?2026;2$y\u009B?1004;0$y');

    expect(events).toEqual([
      {
        type: 'terminal-mode-report',
        raw: '\u001B[?2026;2$y',
        report: {
          raw: '\u001B[?2026;2$y',
          privateMode: true,
          mode: 2026,
          stateCode: 2,
          state: 'reset',
          supported: true,
        },
      },
      {
        type: 'terminal-mode-report',
        raw: '\u009B?1004;0$y',
        report: {
          raw: '\u009B?1004;0$y',
          privateMode: true,
          mode: 1004,
          stateCode: 0,
          state: 'not-recognized',
          supported: false,
        },
      },
    ]);
    expect(events.map((event) => encodeNativeInputAsLegacySequence(event))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('decodes SGR mouse press, release, motion, and wheel sequences', () => {
    expect(decodeNativeInput('\u001B[<0;3;2M\u001B[<0;3;2m\u001B[<35;4;6M\u001B[<64;10;5M\u001B[<69;10;5M')).toEqual([
      {
        type: 'mouse',
        raw: '\u001B[<0;3;2M',
        button: 'left',
        action: 'press',
        x: 2,
        y: 1,
        ctrl: false,
        alt: false,
        shift: false,
      },
      {
        type: 'mouse',
        raw: '\u001B[<0;3;2m',
        button: 'left',
        action: 'release',
        x: 2,
        y: 1,
        ctrl: false,
        alt: false,
        shift: false,
      },
      {
        type: 'mouse',
        raw: '\u001B[<35;4;6M',
        button: 'none',
        action: 'move',
        x: 3,
        y: 5,
        ctrl: false,
        alt: false,
        shift: false,
      },
      {
        type: 'mouse',
        raw: '\u001B[<64;10;5M',
        button: 'wheel-up',
        action: 'wheel',
        x: 9,
        y: 4,
        ctrl: false,
        alt: false,
        shift: false,
      },
      {
        type: 'mouse',
        raw: '\u001B[<69;10;5M',
        button: 'wheel-down',
        action: 'wheel',
        x: 9,
        y: 4,
        ctrl: false,
        alt: false,
        shift: true,
      },
    ]);
  });

  it('decodes CSI-u printable and modified keys', () => {
    expect(decodeNativeInput('\u001B[113u\u001B[13;5u\u001B[65;2u')).toEqual([
      { type: 'key', key: 'character', raw: '\u001B[113u', text: 'q', ctrl: false, alt: false, shift: false },
      { type: 'key', key: 'enter', raw: '\u001B[13;5u', ctrl: true, alt: false, shift: false },
      { type: 'key', key: 'character', raw: '\u001B[65;2u', text: 'A', ctrl: false, alt: false, shift: true },
    ]);
  });

  it('matches renderer-owned key identifiers across legacy and CSI-u input', () => {
    expect(matchesKey('\u001B[A', Key.up)).toBe(true);
    expect(matchesKey('\u001B[1;5A', Key.ctrl('up'))).toBe(true);
    expect(matchesKey('\u001B[Z', Key.shift('tab'))).toBe(true);
    expect(matchesKey('\u001B[13;5u', Key.ctrl('enter'))).toBe(true);
    expect(matchesKey('\u001B[100;5u', Key.ctrl('d'))).toBe(true);
    expect(matchesKey('\u001F', Key.ctrl('-'))).toBe(true);
    expect(matchesKey('\u001B[113u', 'q')).toBe(true);
    expect(matchesKey('\u001B[65;2u', Key.shift('a'))).toBe(true);
    expect(matchesKey('\u001B[97;6:3;65u', Key.ctrlShift('a'))).toBe(true);
    expect(matchesKey('\u001B[97;6:3;65u', Key.ctrl('a'))).toBe(false);

    expect(parseKey('\u001B[1;5A')).toBe('ctrl+up');
    expect(parseKey('\u001B[113u')).toBe('q');
    expect(decodeKittyPrintable('\u001B[113u')).toBe('q');
    expect(decodeKittyPrintable('\u001B[100;5u')).toBeUndefined();
    expect(isKeyRelease('\u001B[97;6:3;65u')).toBe(true);
  });

  it('filters fuzzy matches with stable score ordering', () => {
    const items = ['open file', 'open folder', 'provider manager', 'file search'];

    expect(fuzzyMatch('of', 'open file')).toMatchObject({ matches: true });
    expect(fuzzyMatch('zz', 'open file')).toEqual({ matches: false, score: 0 });
    expect(fuzzyFilter(items, 'of', (item) => item)).toEqual(['open file', 'open folder']);
    expect(fuzzyFilter(items, '2fa', (item) => item)).toEqual([]);
  });

  it('decodes Kitty modified functional keys and event/text CSI-u fields', () => {
    expect(decodeNativeInput('\u001B[1;5A\u001B[1;6H\u001B[1;5F\u001B[3;3~\u001B[15~\u001B[97;6:2;65u\u001B[0;;229u')).toEqual([
      { type: 'key', key: 'up', raw: '\u001B[1;5A', ctrl: true, alt: false, shift: false },
      { type: 'key', key: 'home', raw: '\u001B[1;6H', ctrl: true, alt: false, shift: true },
      { type: 'key', key: 'end', raw: '\u001B[1;5F', ctrl: true, alt: false, shift: false },
      { type: 'key', key: 'delete', raw: '\u001B[3;3~', ctrl: false, alt: true, shift: false },
      { type: 'key', key: 'f5', raw: '\u001B[15~', ctrl: false, alt: false, shift: false },
      {
        type: 'key',
        key: 'character',
        raw: '\u001B[97;6:2;65u',
        text: 'A',
        eventType: 'repeat',
        ctrl: true,
        alt: false,
        shift: true,
      },
      { type: 'key', key: 'character', raw: '\u001B[0;;229u', text: 'å', ctrl: false, alt: false, shift: false },
    ]);
  });

  it('buffers an incomplete CSI sequence until the next chunk', () => {
    const decoder = new NativeInputDecoder();

    expect(decoder.decode('\u001B[1;')).toEqual([]);
    expect(decoder.decode('5A')).toEqual([
      { type: 'key', key: 'up', raw: '\u001B[1;5A', ctrl: true, alt: false, shift: false },
    ]);
  });

  it('buffers incomplete UTF-8 sequences until the next chunk', () => {
    const decoder = new NativeInputDecoder();
    const han = Buffer.from('한', 'utf8');

    expect(decoder.decode(han.subarray(0, 1))).toEqual([]);
    expect(decoder.decode(han.subarray(1, 2))).toEqual([]);
    expect(decoder.decode(han.subarray(2))).toEqual([
      { type: 'key', key: 'character', raw: '한', text: '한', ctrl: false, alt: false, shift: false },
    ]);
  });

  it('decodes split Hangul syllables without replacement characters', () => {
    const decoder = new NativeInputDecoder();
    const bytes = Buffer.from('안녕', 'utf8');

    expect(decoder.decode(bytes.subarray(0, 2))).toEqual([]);
    expect(decoder.decode(bytes.subarray(2, 3))).toEqual([
      { type: 'key', key: 'character', raw: '안', text: '안', ctrl: false, alt: false, shift: false },
    ]);
    expect(decoder.decode(bytes.subarray(3, 5))).toEqual([]);
    expect(decoder.decode(bytes.subarray(5, 6))).toEqual([
      { type: 'key', key: 'character', raw: '녕', text: '녕', ctrl: false, alt: false, shift: false },
    ]);
  });

  it('buffers an incomplete SGR mouse sequence until the next chunk', () => {
    const decoder = new NativeInputDecoder();

    expect(decoder.decode('\u001B[<64;10')).toEqual([]);
    expect(decoder.decode(';5M')).toEqual([
      {
        type: 'mouse',
        raw: '\u001B[<64;10;5M',
        button: 'wheel-up',
        action: 'wheel',
        x: 9,
        y: 4,
        ctrl: false,
        alt: false,
        shift: false,
      },
    ]);
  });

  it('groups bracketed paste across chunks and resumes normal decoding afterward', () => {
    const decoder = new NativeInputDecoder();

    expect(decoder.decode('a\u001B[200~hello')).toEqual([
      { type: 'key', key: 'character', raw: 'a', text: 'a', ctrl: false, alt: false, shift: false },
    ]);
    expect(decoder.decode('\nworld\u001B[201~b')).toEqual([
      { type: 'paste', raw: '\u001B[200~hello\nworld\u001B[201~', text: 'hello\nworld' },
      { type: 'key', key: 'character', raw: 'b', text: 'b', ctrl: false, alt: false, shift: false },
    ]);
  });

  it('flushes an unterminated paste as a paste event', () => {
    const decoder = new NativeInputDecoder();

    expect(decoder.decode('\u001B[200~partial')).toEqual([]);

    expect(decoder.flush()).toEqual({
      type: 'paste',
      raw: '\u001B[200~partial',
      text: 'partial',
    });
  });

  it('encodes structured events back to legacy-compatible input sequences', () => {
    expect(
      decodeNativeInput('x\u0003\u001B[1;2A\u001B[Z\u001B[200~paste\u001B[201~\u001B[I').map((event) =>
        encodeNativeInputAsLegacySequence(event),
      ),
    ).toEqual(['x', '\u0003', '\u001B[1;2A', '\u001B[Z', '\u001B[200~paste\u001B[201~', '\u001B[I']);

    expect(
      encodeNativeInputAsLegacySequence({
        type: 'key',
        key: 'character',
        raw: '\u001B[99;5u',
        text: 'c',
        ctrl: true,
        alt: false,
        shift: false,
      }),
    ).toBe('\u0003');
    expect(
      encodeNativeInputAsLegacySequence({
        type: 'key',
        key: 'character',
        raw: '\u001B[97;3u',
        text: 'a',
        ctrl: false,
        alt: true,
        shift: false,
      }),
    ).toBe('\u001Ba');
    expect(
      encodeNativeInputAsLegacySequence({
        type: 'key',
        key: 'character',
        raw: '\u001B[97;6:3;65u',
        text: 'A',
        eventType: 'release',
        ctrl: true,
        alt: false,
        shift: true,
      }),
    ).toBeUndefined();
    expect(
      encodeNativeInputAsLegacySequence({
        type: 'mouse',
        raw: '\u001B[<64;10;5M',
        button: 'wheel-up',
        action: 'wheel',
        x: 9,
        y: 4,
        ctrl: false,
        alt: false,
        shift: false,
      }),
    ).toBeUndefined();
  });
});

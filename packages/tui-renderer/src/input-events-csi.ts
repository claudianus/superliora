import { keyEvent, keyNameForCodePoint, keyNameForFunctionalCsi } from './input-events-key';
import type { NativeInputKeyEvent, NativeInputKeyEventType } from './input-events-types';
import { isPrintable } from './input-events-utf8';

export function matchCsiU(
  input: string,
  index: number,
): { readonly raw: string; readonly event: NativeInputKeyEvent } | undefined {
  const match = /^\u001B\[([0-9:]+)(?:;([0-9:]*))?(?:;([0-9:]+))?u/.exec(input.slice(index));
  if (match === null) return undefined;
  const raw = match[0];
  const keyCodes = parseCsiUKeyCodes(match[1]);
  if (keyCodes === undefined) {
    return {
      raw,
      event: { type: 'key', key: 'escape', raw, ctrl: false, alt: false, shift: false },
    };
  }
  const modifiers = decodeCsiUModifiers(match[2]);
  const associatedText = decodeTextCodePoints(match[3]);
  const text = resolveCsiUText(keyCodes, modifiers, associatedText);
  const shortcutCodePoint = text.codePointAt(0) ?? keyCodes.unicodeKeyCode;
  return {
    raw,
    event: keyEvent(keyNameForCodePoint(shortcutCodePoint, text), {
      raw,
      text: isPrintable(text) ? text : undefined,
      eventType: decodeCsiUEventType(match[2]),
      ...modifiers,
    }),
  };
}

export function matchCsiFunctional(
  input: string,
  index: number,
): { readonly raw: string; readonly event: NativeInputKeyEvent } | undefined {
  const match = /^\u001B\[(?:(\d+)(?:;([0-9:]+))?)?([~A-DHF])/.exec(input.slice(index));
  if (match === null) return undefined;
  const final = match[3];
  if (final === undefined) return undefined;
  const number = match[1] === undefined ? 1 : Number(match[1]);
  const key = keyNameForFunctionalCsi(number, final);
  if (key === undefined) return undefined;
  const raw = match[0];
  return {
    raw,
    event: keyEvent(key, {
      raw,
      eventType: decodeCsiUEventType(match[2]),
      ...decodeCsiUModifiers(match[2]),
    }),
  };
}

/**
 * Resolve the character used for shortcut matching / ctrl-key handlers.
 * With an active IME layout, unicode-key-code may be Hangul/Cyrillic while
 * base-layout-key is the PC-101 Latin key applications bind shortcuts to.
 */
function resolveCsiUText(
  keyCodes: {
    readonly unicodeKeyCode: number;
    readonly baseLayoutKeyCode: number | undefined;
  },
  modifiers: { readonly ctrl: boolean; readonly alt: boolean },
  associatedText: string | undefined,
): string {
  if (
    (modifiers.ctrl || modifiers.alt) &&
    keyCodes.baseLayoutKeyCode !== undefined
  ) {
    // IME layouts report the layout glyph as unicode-key-code; applications
    // bind shortcuts to the PC-101 base-layout key (e.g. Ctrl+C).
    return String.fromCodePoint(keyCodes.baseLayoutKeyCode);
  }
  return associatedText ?? String.fromCodePoint(keyCodes.unicodeKeyCode);
}

function decodeCsiUModifiers(value: string | undefined): {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
} {
  const modifier = parseCsiNumber(value);
  if (modifier === undefined) return { ctrl: false, alt: false, shift: false };
  const bits = Math.max(0, modifier - 1);
  return {
    shift: (bits & 1) !== 0,
    alt: (bits & 2) !== 0,
    ctrl: (bits & 4) !== 0,
  };
}

function decodeCsiUEventType(value: string | undefined): NativeInputKeyEventType | undefined {
  const [, eventType] = value?.split(':') ?? [];
  if (eventType === undefined) return undefined;
  switch (eventType) {
    case '1':
      return 'press';
    case '2':
      return 'repeat';
    case '3':
      return 'release';
    default:
      return undefined;
  }
}

function decodeTextCodePoints(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const codePoints = value.split(':').map(Number);
  if (codePoints.some((codePoint) => !Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff)) {
    return undefined;
  }
  return String.fromCodePoint(...codePoints);
}

function parseCsiNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const [head] = value.split(':');
  if (head === undefined || head === '') return undefined;
  const number = Number(head);
  return Number.isInteger(number) ? number : undefined;
}

/**
 * CSI-u first parameter: `unicode-key-code[:shifted-key[:base-layout-key]]`.
 * An empty shifted sub-field (`code::base`) means "base layout only".
 */
function parseCsiUKeyCodes(value: string | undefined):
  | {
      readonly unicodeKeyCode: number;
      readonly shiftedKeyCode: number | undefined;
      readonly baseLayoutKeyCode: number | undefined;
    }
  | undefined {
  if (value === undefined || value === '') return undefined;
  const [unicodeRaw, shiftedRaw, baseRaw] = value.split(':');
  const unicodeKeyCode = parseCsiNumber(unicodeRaw);
  if (unicodeKeyCode === undefined || unicodeKeyCode < 0 || unicodeKeyCode > 0x10ffff) {
    return undefined;
  }
  const shiftedKeyCode = parseOptionalCsiCodePoint(shiftedRaw);
  const baseLayoutKeyCode = parseOptionalCsiCodePoint(baseRaw);
  return { unicodeKeyCode, shiftedKeyCode, baseLayoutKeyCode };
}

function parseOptionalCsiCodePoint(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0x10ffff) return undefined;
  return number;
}

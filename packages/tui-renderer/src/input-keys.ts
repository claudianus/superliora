import { decodeNativeInput, type NativeInputKey, type NativeInputKeyEvent } from './input-events';

type Letter =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type SymbolKey =
  | '`' | '-' | '=' | '[' | ']' | '\\' | ';' | "'" | ',' | '.' | '/' | '!' | '@'
  | '#' | '$' | '%' | '^' | '&' | '*' | '(' | ')' | '_' | '+' | '|' | '~' | '{'
  | '}' | ':' | '<' | '>' | '?';
type SpecialKey =
  | 'escape' | 'esc' | 'enter' | 'return' | 'tab' | 'space' | 'backspace' | 'delete'
  | 'insert' | 'clear' | 'home' | 'end' | 'pageUp' | 'pageDown' | 'up' | 'down'
  | 'left' | 'right' | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'f6' | 'f7' | 'f8'
  | 'f9' | 'f10' | 'f11' | 'f12';
type BaseKey = Letter | Digit | SymbolKey | SpecialKey;
type ModifierName = 'ctrl' | 'shift' | 'alt' | 'super';

export type KeyId = BaseKey | `${ModifierName}+${string}`;
export type KeyEventType = 'press' | 'repeat' | 'release';

export const Key = {
  escape: 'escape',
  esc: 'esc',
  enter: 'enter',
  return: 'return',
  tab: 'tab',
  space: 'space',
  backspace: 'backspace',
  delete: 'delete',
  insert: 'insert',
  clear: 'clear',
  home: 'home',
  end: 'end',
  pageUp: 'pageUp',
  pageDown: 'pageDown',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  f1: 'f1',
  f2: 'f2',
  f3: 'f3',
  f4: 'f4',
  f5: 'f5',
  f6: 'f6',
  f7: 'f7',
  f8: 'f8',
  f9: 'f9',
  f10: 'f10',
  f11: 'f11',
  f12: 'f12',
  backtick: '`',
  hyphen: '-',
  equals: '=',
  leftbracket: '[',
  rightbracket: ']',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  comma: ',',
  period: '.',
  slash: '/',
  exclamation: '!',
  at: '@',
  hash: '#',
  dollar: '$',
  percent: '%',
  caret: '^',
  ampersand: '&',
  asterisk: '*',
  leftparen: '(',
  rightparen: ')',
  underscore: '_',
  plus: '+',
  pipe: '|',
  tilde: '~',
  leftbrace: '{',
  rightbrace: '}',
  colon: ':',
  lessthan: '<',
  greaterthan: '>',
  question: '?',
  ctrl: <K extends BaseKey>(key: K): `ctrl+${K}` => `ctrl+${key}`,
  shift: <K extends BaseKey>(key: K): `shift+${K}` => `shift+${key}`,
  alt: <K extends BaseKey>(key: K): `alt+${K}` => `alt+${key}`,
  super: <K extends BaseKey>(key: K): `super+${K}` => `super+${key}`,
  ctrlShift: <K extends BaseKey>(key: K): `ctrl+shift+${K}` => `ctrl+shift+${key}`,
  shiftCtrl: <K extends BaseKey>(key: K): `shift+ctrl+${K}` => `shift+ctrl+${key}`,
  ctrlAlt: <K extends BaseKey>(key: K): `ctrl+alt+${K}` => `ctrl+alt+${key}`,
  altCtrl: <K extends BaseKey>(key: K): `alt+ctrl+${K}` => `alt+ctrl+${key}`,
  shiftAlt: <K extends BaseKey>(key: K): `shift+alt+${K}` => `shift+alt+${key}`,
  altShift: <K extends BaseKey>(key: K): `alt+shift+${K}` => `alt+shift+${key}`,
  ctrlSuper: <K extends BaseKey>(key: K): `ctrl+super+${K}` => `ctrl+super+${key}`,
  superCtrl: <K extends BaseKey>(key: K): `super+ctrl+${K}` => `super+ctrl+${key}`,
  shiftSuper: <K extends BaseKey>(key: K): `shift+super+${K}` => `shift+super+${key}`,
  superShift: <K extends BaseKey>(key: K): `super+shift+${K}` => `super+shift+${key}`,
  altSuper: <K extends BaseKey>(key: K): `alt+super+${K}` => `alt+super+${key}`,
  superAlt: <K extends BaseKey>(key: K): `super+alt+${K}` => `super+alt+${key}`,
  ctrlShiftAlt: <K extends BaseKey>(key: K): `ctrl+shift+alt+${K}` => `ctrl+shift+alt+${key}`,
  ctrlShiftSuper: <K extends BaseKey>(key: K): `ctrl+shift+super+${K}` => `ctrl+shift+super+${key}`,
} as const;

let kittyProtocolActive = false;

export function setKittyProtocolActive(active: boolean): void {
  kittyProtocolActive = active;
}

export function isKittyProtocolActive(): boolean {
  return kittyProtocolActive;
}

export function isKeyRelease(data: string): boolean {
  if (data.includes('\u001B[200~')) return false;
  const event = decodeSingleKey(data);
  if (event?.eventType === 'release') return true;
  return /:3(?:;[0-9:]+)?(?:u|~|[A-DHF])/.test(data);
}

export function isKeyRepeat(data: string): boolean {
  if (data.includes('\u001B[200~')) return false;
  const event = decodeSingleKey(data);
  if (event?.eventType === 'repeat') return true;
  return /:2(?:;[0-9:]+)?(?:u|~|[A-DHF])/.test(data);
}

export function parseKey(data: string): string | undefined {
  const event = decodeSingleKey(data);
  if (event === undefined) return parseLegacyAltKey(data);
  return keyIdForEvent(event);
}

export function matchesKey(data: string, keyId: KeyId): boolean {
  const expected = parseKeyId(keyId);
  if (expected === undefined) return false;

  const event = decodeSingleKey(data);
  if (event !== undefined && eventMatches(event, expected)) return true;

  return legacyFallbackMatches(data, expected);
}

export function decodeKittyPrintable(data: string): string | undefined {
  const event = decodeSingleKey(data);
  if (
    event === undefined ||
    event.key !== 'character' ||
    event.text === undefined ||
    event.ctrl ||
    event.alt
  ) {
    return undefined;
  }
  return isPrintableText(event.text) ? event.text : undefined;
}

export function decodePrintableKey(data: string): string | undefined {
  return decodeKittyPrintable(data) ?? (isPrintableText(data) ? data : undefined);
}

interface ParsedKeyId {
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly super: boolean;
}

const LEGACY_KEY_IDS: ReadonlyMap<string, string> = new Map([
  ['\u001B', 'escape'],
  ['\r', 'enter'],
  ['\n', 'enter'],
  ['\t', 'tab'],
  ['\u001B[Z', 'shift+tab'],
  [' ', 'space'],
  ['\u007F', 'backspace'],
  ['\b', 'backspace'],
  ['\u001B[A', 'up'],
  ['\u001BOA', 'up'],
  ['\u001B[B', 'down'],
  ['\u001BOB', 'down'],
  ['\u001B[C', 'right'],
  ['\u001BOC', 'right'],
  ['\u001B[D', 'left'],
  ['\u001BOD', 'left'],
  ['\u001B[H', 'home'],
  ['\u001BOH', 'home'],
  ['\u001B[1~', 'home'],
  ['\u001B[7~', 'home'],
  ['\u001B[F', 'end'],
  ['\u001BOF', 'end'],
  ['\u001B[4~', 'end'],
  ['\u001B[8~', 'end'],
  ['\u001B[2~', 'insert'],
  ['\u001B[3~', 'delete'],
  ['\u001B[5~', 'pageUp'],
  ['\u001B[[5~', 'pageUp'],
  ['\u001B[6~', 'pageDown'],
  ['\u001B[[6~', 'pageDown'],
  ['\u001B[E', 'clear'],
  ['\u001BOE', 'clear'],
  ['\u001B[a', 'shift+up'],
  ['\u001B[b', 'shift+down'],
  ['\u001B[c', 'shift+right'],
  ['\u001B[d', 'shift+left'],
  ['\u001BOa', 'ctrl+up'],
  ['\u001BOb', 'ctrl+down'],
  ['\u001BOc', 'ctrl+right'],
  ['\u001BOd', 'ctrl+left'],
  ['\u001B[5$', 'shift+pageUp'],
  ['\u001B[6$', 'shift+pageDown'],
  ['\u001B[7$', 'shift+home'],
  ['\u001B[8$', 'shift+end'],
  ['\u001B[5^', 'ctrl+pageUp'],
  ['\u001B[6^', 'ctrl+pageDown'],
  ['\u001B[7^', 'ctrl+home'],
  ['\u001B[8^', 'ctrl+end'],
  ['\u001BOP', 'f1'],
  ['\u001B[11~', 'f1'],
  ['\u001B[[A', 'f1'],
  ['\u001BOQ', 'f2'],
  ['\u001B[12~', 'f2'],
  ['\u001B[[B', 'f2'],
  ['\u001BOR', 'f3'],
  ['\u001B[13~', 'f3'],
  ['\u001B[[C', 'f3'],
  ['\u001BOS', 'f4'],
  ['\u001B[14~', 'f4'],
  ['\u001B[[D', 'f4'],
  ['\u001B[15~', 'f5'],
  ['\u001B[[E', 'f5'],
  ['\u001B[17~', 'f6'],
  ['\u001B[18~', 'f7'],
  ['\u001B[19~', 'f8'],
  ['\u001B[20~', 'f9'],
  ['\u001B[21~', 'f10'],
  ['\u001B[23~', 'f11'],
  ['\u001B[24~', 'f12'],
  ['\u001Bb', 'alt+left'],
  ['\u001Bf', 'alt+right'],
  ['\u001Bp', 'alt+up'],
  ['\u001Bn', 'alt+down'],
]);

function decodeSingleKey(data: string): NativeInputKeyEvent | undefined {
  const events = decodeNativeInput(data);
  if (events.length !== 1) return undefined;
  const event = events[0];
  return event?.type === 'key' ? event : undefined;
}

function parseKeyId(keyId: string): ParsedKeyId | undefined {
  const parts = keyId.toLowerCase().split('+').filter(Boolean);
  const key = parts.at(-1);
  if (key === undefined) return undefined;
  return {
    key,
    ctrl: parts.includes('ctrl'),
    alt: parts.includes('alt'),
    shift: parts.includes('shift'),
    super: parts.includes('super'),
  };
}

function eventMatches(event: NativeInputKeyEvent, expected: ParsedKeyId): boolean {
  if (expected.super) return false;
  if (event.ctrl !== expected.ctrl || event.alt !== expected.alt || event.shift !== expected.shift) {
    return false;
  }
  return eventKeyName(event) === normalizeExpectedKey(expected.key);
}

function eventKeyName(event: NativeInputKeyEvent): string {
  if (event.key === 'character') return normalizeCharacterKey(event.text ?? '');
  return rendererKeyToCompatKey(event.key);
}

function rendererKeyToCompatKey(key: NativeInputKey): string {
  if (key === 'pageup') return 'pageup';
  if (key === 'pagedown') return 'pagedown';
  return key;
}

function normalizeExpectedKey(key: string): string {
  if (key === 'esc') return 'escape';
  if (key === 'return') return 'enter';
  if (key === 'pageup') return 'pageup';
  if (key === 'pagedown') return 'pagedown';
  if (key === 'space') return ' ';
  return key.length === 1 ? key : key;
}

function normalizeCharacterKey(text: string): string {
  return text === ' ' ? ' ' : text.toLowerCase();
}

function keyIdForEvent(event: NativeInputKeyEvent): string {
  const key = eventKeyName(event);
  const namedKey = key === ' ' ? 'space' : key;
  const modifiers = [
    event.shift ? 'shift' : undefined,
    event.ctrl ? 'ctrl' : undefined,
    event.alt ? 'alt' : undefined,
  ].filter((modifier): modifier is string => modifier !== undefined);
  return modifiers.length === 0 ? namedKey : `${modifiers.join('+')}+${namedKey}`;
}

function parseLegacyAltKey(data: string): string | undefined {
  const mapped = LEGACY_KEY_IDS.get(data);
  if (mapped !== undefined) return mapped;
  if (data.length === 2 && data.startsWith('\u001B') && isPrintableText(data[1] ?? '')) {
    return `alt+${data[1]!.toLowerCase()}`;
  }
  return undefined;
}

function legacyFallbackMatches(data: string, expected: ParsedKeyId): boolean {
  const parsed = parseLegacyAltKey(data);
  if (parsed !== undefined) {
    const actual = parseKeyId(parsed);
    return actual !== undefined && parsedKeyMatches(actual, expected);
  }

  if (expected.super) return false;
  if (expected.ctrl && !expected.shift && !expected.alt) {
    const control = rawControlCharacter(expected.key);
    if (control !== undefined && data === control) return true;
  }

  if (!expected.ctrl && !expected.alt && !expected.shift) {
    const key = normalizeExpectedKey(expected.key);
    if (key.length === 1 && data === key) return true;
  }

  return false;
}

function parsedKeyMatches(actual: ParsedKeyId, expected: ParsedKeyId): boolean {
  return (
    normalizeExpectedKey(actual.key) === normalizeExpectedKey(expected.key) &&
    actual.ctrl === expected.ctrl &&
    actual.alt === expected.alt &&
    actual.shift === expected.shift &&
    actual.super === expected.super
  );
}

function rawControlCharacter(key: string): string | undefined {
  const char = key.toLowerCase();
  const code = char.codePointAt(0);
  if (code === undefined) return undefined;
  if ((code >= 97 && code <= 122) || ['[', '\\', ']', '_'].includes(char)) {
    return String.fromCodePoint(code & 0x1f);
  }
  if (char === '-') return String.fromCodePoint(31);
  if (char === 'space' || char === ' ') return '\0';
  return undefined;
}

function isPrintableText(text: string): boolean {
  if (text.length === 0) return false;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined || code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

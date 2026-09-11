import type {
  NativeInputEvent,
  NativeInputFocusEvent,
  NativeInputKey,
  NativeInputKeyEvent,
} from './types';

export const BRACKETED_PASTE_START = '\u001B[200~';
export const BRACKETED_PASTE_END = '\u001B[201~';

export const OSC_START = '\u001B]';
export const OSC_BEL_TERMINATOR = '\u0007';
export const OSC_STRING_TERMINATOR = '\u001B\\';

/**
 * Safety cap on a buffered OSC payload. Real replies (theme color, title) are
 * tens of bytes; a lost terminator must not buffer unbounded input forever.
 */
const MAX_OSC_PAYLOAD_LENGTH = 4096;

export type OscMatch =
  | { readonly raw: string; readonly incomplete: false }
  | { readonly incomplete: true };

/**
 * Consume an OSC sequence (`ESC ] payload (BEL | ESC \)`) starting at `index`.
 * OSC replies (theme color, clipboard, title, hyperlink) carry arbitrary
 * printable payload text — decoding them as key events would paste that
 * payload into the editor.
 *
 * Returns the raw sequence, or `'incomplete'` when the payload continues in
 * a later chunk, or `undefined` when the bytes at `index` do not open an OSC.
 *
 * - A non-terminator ESC (or other control byte) inside a non-empty payload
 *   aborts the OSC: the reply was truncated, and the bytes that follow (often
 *   mouse events) must still decode normally instead of being swallowed as
 *   payload text.
 * - With an empty payload the same bytes are not an OSC at all — `ESC ]` here
 *   is the legacy Alt+] chord, so fall through to the normal escape path.
 */
export function matchOsc(
  input: string,
  index: number,
): OscMatch | undefined {
  if (!input.startsWith(OSC_START, index)) return undefined;
  const payloadStart = index + OSC_START.length;
  for (let cursor = payloadStart; cursor < input.length; cursor++) {
    const char = input[cursor]!;
    if (char === OSC_BEL_TERMINATOR || char === OSC_STRING_TERMINATOR) {
      return { raw: input.slice(index, cursor + 1), incomplete: false };
    }
    if (char === '\u001B') {
      if (input[cursor + 1] === '\\') {
        return { raw: input.slice(index, cursor + 2), incomplete: false };
      }
      return cursor === payloadStart
        ? undefined
        : { raw: input.slice(index, cursor), incomplete: false };
    }
    if (char < '\u0020') {
      return cursor === payloadStart
        ? undefined
        : { raw: input.slice(index, cursor), incomplete: false };
    }
    if (cursor - payloadStart >= MAX_OSC_PAYLOAD_LENGTH) {
      return { raw: input.slice(index, cursor), incomplete: false };
    }
  }
  return { incomplete: true };
}

const LEGACY_KEY_SEQUENCES: Partial<Record<NativeInputKey, string>> = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  home: '\u001B[H',
  end: '\u001B[F',
  pageup: '\u001B[5~',
  pagedown: '\u001B[6~',
  insert: '\u001B[2~',
  delete: '\u001B[3~',
  f1: '\u001BOP',
  f2: '\u001BOQ',
  f3: '\u001BOR',
  f4: '\u001BOS',
  f5: '\u001B[15~',
  f6: '\u001B[17~',
  f7: '\u001B[18~',
  f8: '\u001B[19~',
  f9: '\u001B[20~',
  f10: '\u001B[21~',
  f11: '\u001B[23~',
  f12: '\u001B[24~',
  menu: '\u001B[29~',
  enter: '\r',
  backspace: '\u007F',
  tab: '\t',
  escape: '\u001B',
};

type KnownInputEvent =
  | {
      readonly type: 'key';
      readonly key: NativeInputKey;
      readonly text?: string;
      readonly ctrl?: boolean;
      readonly alt?: boolean;
      readonly shift?: boolean;
      readonly super?: boolean;
    }
  | Omit<NativeInputFocusEvent, 'raw'>;

const KNOWN_SEQUENCES: ReadonlyArray<readonly [sequence: string, event: KnownInputEvent]> = [
  ['\u001B[1;2A', { type: 'key', key: 'up', shift: true }],
  ['\u001B[1;2B', { type: 'key', key: 'down', shift: true }],
  ['\u001B[1;2C', { type: 'key', key: 'right', shift: true }],
  ['\u001B[1;2D', { type: 'key', key: 'left', shift: true }],
  ['\u001B[5~', { type: 'key', key: 'pageup' }],
  ['\u001B[6~', { type: 'key', key: 'pagedown' }],
  ['\u001B[3~', { type: 'key', key: 'delete' }],
  ['\u001B[2~', { type: 'key', key: 'insert' }],
  ['\u001B[1~', { type: 'key', key: 'home' }],
  ['\u001B[4~', { type: 'key', key: 'end' }],
  ['\u001BOP', { type: 'key', key: 'f1' }],
  ['\u001BOQ', { type: 'key', key: 'f2' }],
  ['\u001BOR', { type: 'key', key: 'f3' }],
  ['\u001BOS', { type: 'key', key: 'f4' }],
  ['\u001B[15~', { type: 'key', key: 'f5' }],
  ['\u001B[17~', { type: 'key', key: 'f6' }],
  ['\u001B[18~', { type: 'key', key: 'f7' }],
  ['\u001B[19~', { type: 'key', key: 'f8' }],
  ['\u001B[20~', { type: 'key', key: 'f9' }],
  ['\u001B[21~', { type: 'key', key: 'f10' }],
  ['\u001B[23~', { type: 'key', key: 'f11' }],
  ['\u001B[24~', { type: 'key', key: 'f12' }],
  ['\u001B[29~', { type: 'key', key: 'menu' }],
  ['\u001B[H', { type: 'key', key: 'home' }],
  ['\u001B[F', { type: 'key', key: 'end' }],
  ['\u001BOH', { type: 'key', key: 'home' }],
  ['\u001BOF', { type: 'key', key: 'end' }],
  ['\u001B[A', { type: 'key', key: 'up' }],
  ['\u001B[B', { type: 'key', key: 'down' }],
  ['\u001B[C', { type: 'key', key: 'right' }],
  ['\u001B[D', { type: 'key', key: 'left' }],
  ['\u001B[Z', { type: 'key', key: 'tab', shift: true }],
  ['\u001B[I', { type: 'focus', focused: true }],
  ['\u001B[O', { type: 'focus', focused: false }],
];

export function matchKnownSequence(
  input: string,
  index: number,
): { readonly sequence: string; readonly event: (typeof KNOWN_SEQUENCES)[number][1] } | undefined {
  for (const [sequence, event] of KNOWN_SEQUENCES) {
    if (input.startsWith(sequence, index)) return { sequence, event };
  }
  return undefined;
}

export function sequenceEvent(raw: string, event: KnownInputEvent): NativeInputEvent {
  if (event.type === 'focus') return { ...event, raw };
  return {
    ctrl: false,
    alt: false,
    shift: false,
    super: false,
    ...event,
    raw,
  };
}

export function encodeNativeKeyAsLegacySequence(event: NativeInputKeyEvent): string | undefined {
  if (event.eventType === 'release') return undefined;
  if (event.key === 'character') {
    if (event.ctrl && event.text !== undefined) {
      const ctrl = legacyControlCharacter(event.text);
      if (ctrl !== undefined) return event.alt ? `\u001B${ctrl}` : ctrl;
    }
    if (event.text !== undefined) return event.alt ? `\u001B${event.text}` : event.text;
    return event.raw;
  }
  if (event.ctrl || event.alt) return event.raw;
  if (event.key === 'tab' && event.shift) return '\u001B[Z';
  if (event.shift) return event.raw;
  const legacy = LEGACY_KEY_SEQUENCES[event.key];
  return legacy ?? event.raw;
}

function legacyControlCharacter(text: string): string | undefined {
  const codePoint = text.toLowerCase().codePointAt(0);
  if (codePoint === undefined) return undefined;
  if (codePoint >= 97 && codePoint <= 122) return String.fromCodePoint(codePoint - 96);
  if (codePoint === 32) return '\0';
  return undefined;
}

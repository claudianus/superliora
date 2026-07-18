import {
  parseNativeTerminalDecModeReport,
  type NativeTerminalDecModeReport,
} from './terminal-features';

export type NativeInputKey =
  | 'character'
  | 'up'
  | 'down'
  | 'right'
  | 'left'
  | 'home'
  | 'end'
  | 'pageup'
  | 'pagedown'
  | 'insert'
  | 'delete'
  | 'f1'
  | 'f2'
  | 'f3'
  | 'f4'
  | 'f5'
  | 'f6'
  | 'f7'
  | 'f8'
  | 'f9'
  | 'f10'
  | 'f11'
  | 'f12'
  | 'menu'
  | 'enter'
  | 'backspace'
  | 'tab'
  | 'escape';

export type NativeInputKeyEventType = 'press' | 'repeat' | 'release';

export interface NativeInputKeyEvent {
  readonly type: 'key';
  readonly key: NativeInputKey;
  readonly raw: string;
  readonly text?: string;
  readonly eventType?: NativeInputKeyEventType;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface NativeInputPasteEvent {
  readonly type: 'paste';
  readonly raw: string;
  readonly text: string;
}

export interface NativeInputFocusEvent {
  readonly type: 'focus';
  readonly raw: string;
  readonly focused: boolean;
}

export type NativeInputMouseButton =
  | 'left'
  | 'middle'
  | 'right'
  | 'wheel-up'
  | 'wheel-down'
  | 'wheel-left'
  | 'wheel-right'
  | 'none'
  | 'unknown';

export type NativeInputMouseAction = 'press' | 'release' | 'drag' | 'move' | 'wheel';

export interface NativeInputMouseEvent {
  readonly type: 'mouse';
  readonly raw: string;
  readonly button: NativeInputMouseButton;
  readonly action: NativeInputMouseAction;
  readonly x: number;
  readonly y: number;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export interface NativeInputTerminalModeReportEvent {
  readonly type: 'terminal-mode-report';
  readonly raw: string;
  readonly report: NativeTerminalDecModeReport;
}

export interface NativeInputUnknownEvent {
  readonly type: 'unknown';
  readonly raw: string;
}

export type NativeInputEvent =
  | NativeInputKeyEvent
  | NativeInputPasteEvent
  | NativeInputFocusEvent
  | NativeInputMouseEvent
  | NativeInputTerminalModeReportEvent
  | NativeInputUnknownEvent;

const BRACKETED_PASTE_START = '\u001B[200~';
const BRACKETED_PASTE_END = '\u001B[201~';
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

export class NativeInputDecoder {
  private pasteText: string | undefined;
  private pasteRaw = '';
  private pendingControl = '';
  private pendingUtf8: Buffer = Buffer.alloc(0);

  decode(data: string | Buffer): readonly NativeInputEvent[] {
    const chunk = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const combined = Buffer.concat([this.pendingUtf8, chunk]);
    const decoded = splitDecodableUtf8(combined);
    this.pendingUtf8 = decoded.pending;
    const input = `${this.pendingControl}${decoded.text}`;
    this.pendingControl = '';
    const events: NativeInputEvent[] = [];
    let index = 0;

    while (index < input.length) {
      if (this.pasteText !== undefined) {
        index = this.decodePaste(input, index, events);
        continue;
      }

      if (input.startsWith(BRACKETED_PASTE_START, index)) {
        this.pasteText = '';
        this.pasteRaw = BRACKETED_PASTE_START;
        index += BRACKETED_PASTE_START.length;
        continue;
      }

      const sgrMouse = matchSgrMouse(input, index);
      if (sgrMouse !== undefined) {
        events.push(sgrMouse.event);
        index += sgrMouse.raw.length;
        continue;
      }

      const terminalModeReport = matchTerminalModeReport(input, index);
      if (terminalModeReport !== undefined) {
        events.push(terminalModeReport.event);
        index += terminalModeReport.raw.length;
        continue;
      }

      const known = matchKnownSequence(input, index);
      if (known !== undefined) {
        events.push(sequenceEvent(known.sequence, known.event));
        index += known.sequence.length;
        continue;
      }

      const csiFunctional = matchCsiFunctional(input, index);
      if (csiFunctional !== undefined) {
        events.push(csiFunctional.event);
        index += csiFunctional.raw.length;
        continue;
      }

      const csiU = matchCsiU(input, index);
      if (csiU !== undefined) {
        events.push(csiU.event);
        index += csiU.raw.length;
        continue;
      }

      const char = codePointAt(input, index);
      if (char === '\u001B') {
        const next = index + 1 < input.length ? codePointAt(input, index + 1) : undefined;
        if (next === '[') {
          const raw = consumeUnknownControlSequence(input, index);
          if (raw === undefined) {
            this.pendingControl = input.slice(index);
            break;
          }
          events.push({ type: 'unknown', raw });
          index += raw.length;
        } else if (next !== undefined && isPrintable(next)) {
          events.push(keyEvent('character', { raw: char + next, text: next, alt: true }));
          index += char.length + next.length;
        } else {
          events.push(keyEvent('escape', { raw: char }));
          index += char.length;
        }
        continue;
      }

      events.push(eventForCharacter(char));
      index += char.length;
    }

    return events;
  }

  flush(): NativeInputPasteEvent | undefined {
    if (this.pasteText === undefined) return undefined;
    const event = {
      type: 'paste' as const,
      raw: this.pasteRaw,
      text: this.pasteText,
    };
    this.pasteText = undefined;
    this.pasteRaw = '';
    return event;
  }

  private decodePaste(input: string, index: number, events: NativeInputEvent[]): number {
    const end = input.indexOf(BRACKETED_PASTE_END, index);
    if (end === -1) {
      const chunk = input.slice(index);
      this.pasteText += chunk;
      this.pasteRaw += chunk;
      return input.length;
    }

    const chunk = input.slice(index, end);
    const raw = `${this.pasteRaw}${chunk}${BRACKETED_PASTE_END}`;
    events.push({
      type: 'paste',
      raw,
      text: `${this.pasteText}${chunk}`,
    });
    this.pasteText = undefined;
    this.pasteRaw = '';
    return end + BRACKETED_PASTE_END.length;
  }
}

export function decodeNativeInput(data: string | Buffer): readonly NativeInputEvent[] {
  return new NativeInputDecoder().decode(data);
}

export function encodeNativeInputAsLegacySequence(event: NativeInputEvent): string | undefined {
  switch (event.type) {
    case 'terminal-mode-report':
      return undefined;
    case 'focus':
    case 'unknown':
      return event.raw;
    case 'paste':
      return `${BRACKETED_PASTE_START}${event.text}${BRACKETED_PASTE_END}`;
    case 'mouse':
      return undefined;
    case 'key':
      return encodeNativeKeyAsLegacySequence(event);
  }
}

function matchTerminalModeReport(
  input: string,
  index: number,
): { readonly raw: string; readonly event: NativeInputTerminalModeReportEvent } | undefined {
  const match = /^(?:\u001B\[|\u009B)\??\d+;[0-4]\$y/.exec(input.slice(index));
  if (match === null) return undefined;
  const raw = match[0];
  const report = parseNativeTerminalDecModeReport(raw);
  if (report === undefined) return undefined;
  return {
    raw,
    event: {
      type: 'terminal-mode-report',
      raw,
      report,
    },
  };
}

function matchKnownSequence(
  input: string,
  index: number,
): { readonly sequence: string; readonly event: (typeof KNOWN_SEQUENCES)[number][1] } | undefined {
  for (const [sequence, event] of KNOWN_SEQUENCES) {
    if (input.startsWith(sequence, index)) return { sequence, event };
  }
  return undefined;
}

function sequenceEvent(
  raw: string,
  event: KnownInputEvent,
): NativeInputEvent {
  if (event.type === 'focus') return { ...event, raw };
  return {
    ctrl: false,
    alt: false,
    shift: false,
    ...event,
    raw,
  };
}

function encodeNativeKeyAsLegacySequence(event: NativeInputKeyEvent): string | undefined {
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

function matchCsiU(
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

function matchCsiFunctional(
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

function matchSgrMouse(
  input: string,
  index: number,
): { readonly raw: string; readonly event: NativeInputMouseEvent } | undefined {
  const match = /^\u001B\[<(\d+);(\d+);(\d+)([mM])/.exec(input.slice(index));
  if (match === null) return undefined;
  const raw = match[0];
  const encodedButton = Number(match[1]);
  const terminalX = Number(match[2]);
  const terminalY = Number(match[3]);
  const final = match[4];
  if (
    !Number.isInteger(encodedButton) ||
    !Number.isInteger(terminalX) ||
    !Number.isInteger(terminalY) ||
    final === undefined
  ) {
    return undefined;
  }
  const button = decodeSgrMouseButton(encodedButton);
  return {
    raw,
    event: {
      type: 'mouse',
      raw,
      button,
      action: decodeSgrMouseAction(encodedButton, final, button),
      x: Math.max(0, terminalX - 1),
      y: Math.max(0, terminalY - 1),
      ...decodeSgrMouseModifiers(encodedButton),
    },
  };
}

function decodeSgrMouseButton(encodedButton: number): NativeInputMouseButton {
  const button = encodedButton & 3;
  if ((encodedButton & 64) !== 0) {
    switch (button) {
      case 0:
        return 'wheel-up';
      case 1:
        return 'wheel-down';
      case 2:
        return 'wheel-right';
      case 3:
        return 'wheel-left';
    }
  }
  switch (button) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    case 3:
      return 'none';
    default:
      return 'unknown';
  }
}

function decodeSgrMouseAction(
  encodedButton: number,
  final: string,
  button: NativeInputMouseButton,
): NativeInputMouseAction {
  if (button.startsWith('wheel-')) return 'wheel';
  if (final === 'm') return 'release';
  if ((encodedButton & 32) !== 0) return button === 'none' ? 'move' : 'drag';
  return 'press';
}

function decodeSgrMouseModifiers(encodedButton: number): {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
} {
  return {
    shift: (encodedButton & 4) !== 0,
    alt: (encodedButton & 8) !== 0,
    ctrl: (encodedButton & 16) !== 0,
  };
}

function keyNameForCodePoint(codePoint: number, text: string): NativeInputKey {
  if (codePoint === 13 || codePoint === 10) return 'enter';
  if (codePoint === 9) return 'tab';
  if (codePoint === 27) return 'escape';
  if (codePoint === 127 || codePoint === 8) return 'backspace';
  return isPrintable(text) ? 'character' : 'escape';
}

function keyNameForFunctionalCsi(number: number, final: string): NativeInputKey | undefined {
  if (final === '~') {
    switch (number) {
      case 2:
        return 'insert';
      case 3:
        return 'delete';
      case 5:
        return 'pageup';
      case 6:
        return 'pagedown';
      case 7:
        return 'home';
      case 8:
        return 'end';
      case 15:
        return 'f5';
      case 17:
        return 'f6';
      case 18:
        return 'f7';
      case 19:
        return 'f8';
      case 20:
        return 'f9';
      case 21:
        return 'f10';
      case 23:
        return 'f11';
      case 24:
        return 'f12';
      case 29:
        return 'menu';
      default:
        return undefined;
    }
  }
  if (number !== 1) return undefined;
  switch (final) {
    case 'A':
      return 'up';
    case 'B':
      return 'down';
    case 'C':
      return 'right';
    case 'D':
      return 'left';
    case 'H':
      return 'home';
    case 'F':
      return 'end';
    default:
      return undefined;
  }
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

function eventForCharacter(char: string): NativeInputKeyEvent {
  switch (char) {
    case '\r':
    case '\n':
      return keyEvent('enter', { raw: char });
    case '\t':
      return keyEvent('tab', { raw: char });
    case '\u007F':
    case '\b':
      return keyEvent('backspace', { raw: char });
    default:
      return controlOrPrintableEvent(char);
  }
}

function controlOrPrintableEvent(char: string): NativeInputKeyEvent {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 1 && code <= 26) {
    return keyEvent('character', {
      raw: char,
      text: String.fromCodePoint(code + 96),
      ctrl: true,
    });
  }
  return keyEvent(isPrintable(char) ? 'character' : 'escape', {
    raw: char,
    text: isPrintable(char) ? char : undefined,
  });
}

function keyEvent(
  key: NativeInputKey,
  options: {
    readonly raw: string;
    readonly text?: string;
    readonly eventType?: NativeInputKeyEventType;
    readonly ctrl?: boolean;
    readonly alt?: boolean;
    readonly shift?: boolean;
  },
): NativeInputKeyEvent {
  const event: NativeInputKeyEvent = {
    type: 'key',
    key,
    raw: options.raw,
    text: options.text,
    ctrl: options.ctrl ?? false,
    alt: options.alt ?? false,
    shift: options.shift ?? false,
  };
  if (options.eventType === undefined) return event;
  return { ...event, eventType: options.eventType };
}

function codePointAt(input: string, index: number): string {
  return String.fromCodePoint(input.codePointAt(index) ?? 0);
}

function isPrintable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 && code !== 0x7f;
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

function consumeUnknownControlSequence(input: string, index: number): string | undefined {
  for (let cursor = index + 2; cursor < input.length; cursor++) {
    const code = input.codePointAt(cursor) ?? 0;
    if (code >= 0x40 && code <= 0x7e) return input.slice(index, cursor + 1);
  }
  return undefined;
}

function splitDecodableUtf8(buffer: Buffer): { readonly text: string; readonly pending: Buffer } {
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

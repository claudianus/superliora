import type { NativeInputKey, NativeInputKeyEvent, NativeInputKeyEventType } from './input-events-types';
import { isPrintable } from './input-events-utf8';

export function keyNameForCodePoint(codePoint: number, text: string): NativeInputKey {
  if (codePoint === 13 || codePoint === 10) return 'enter';
  if (codePoint === 9) return 'tab';
  if (codePoint === 27) return 'escape';
  if (codePoint === 127 || codePoint === 8) return 'backspace';
  return isPrintable(text) ? 'character' : 'escape';
}

export function keyNameForFunctionalCsi(number: number, final: string): NativeInputKey | undefined {
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

export function keyEvent(
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

export function eventForCharacter(char: string): NativeInputKeyEvent {
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

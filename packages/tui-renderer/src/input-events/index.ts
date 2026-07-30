export type {
  NativeInputEvent,
  NativeInputFocusEvent,
  NativeInputKey,
  NativeInputKeyEvent,
  NativeInputKeyEventType,
  NativeInputMouseAction,
  NativeInputMouseButton,
  NativeInputMouseEvent,
  NativeInputPasteEvent,
  NativeInputTerminalModeReportEvent,
  NativeInputUnknownEvent,
} from './types';

export {
  DEFAULT_ESCAPE_RESOLVE_MS,
  NativeInputDecoder,
  type NativeInputDecoderOptions,
} from './decoder';

export * from './keys';
export * from './router';
export * from './paste-burst';

import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  encodeNativeKeyAsLegacySequence,
} from './sequences';
import { NativeInputDecoder } from './decoder';
import type { NativeInputEvent } from './types';

/**
 * One-shot decode. Flushes a trailing bare ESC as Escape (no async timer in
 * this helper). Streaming callers should use {@link NativeInputDecoder} with
 * `onResolvedEvents` so split SGR/CSI prefixes are not false Escapes.
 */
export function decodeNativeInput(data: string | Buffer): readonly NativeInputEvent[] {
  const decoder = new NativeInputDecoder({ escapeResolveMs: -1 });
  const events = decoder.decode(data);
  const pending = decoder.flushPendingControl();
  return pending.length === 0 ? events : [...events, ...pending];
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

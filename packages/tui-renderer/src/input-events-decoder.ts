import { parseNativeTerminalDecModeReport } from './terminal-features';
import { matchCsiFunctional, matchCsiU } from './input-events-csi';
import { eventForCharacter, keyEvent } from './input-events-key';
import { matchSgrMouse, matchX10Mouse } from './input-events-mouse';
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  matchKnownSequence,
  sequenceEvent,
} from './input-events-sequences';
import type { NativeInputEvent, NativeInputPasteEvent } from './input-events-types';
import { codePointAt, consumeUnknownControlSequence, isPrintable, splitDecodableUtf8 } from './input-events-utf8';

/**
 * How long to wait after a lone ESC before treating it as Escape (not the
 * start of a split CSI/SGR/SS3 sequence). Terminals often deliver mouse-wheel
 * SGR as `\u001B` then `[<64;…M` across TCP/PTY chunks; emitting Escape on the
 * first byte cancels in-flight agent turns (Ultrawork false interrupt).
 */
export const DEFAULT_ESCAPE_RESOLVE_MS = 35;

export interface NativeInputDecoderOptions {
  /**
   * Called when a previously buffered incomplete control resolves asynchronously
   * (bare-ESC timeout). The host should dispatch these like normal decode output.
   */
  readonly onResolvedEvents?: (events: readonly NativeInputEvent[]) => void;
  /** Override bare-ESC resolve delay (tests). Default {@link DEFAULT_ESCAPE_RESOLVE_MS}. */
  readonly escapeResolveMs?: number;
  readonly setTimer?: typeof setTimeout;
  readonly clearTimer?: typeof clearTimeout;
}

export class NativeInputDecoder {
  private pasteText: string | undefined;
  private pasteRaw = '';
  private pendingControl = '';
  private pendingUtf8: Buffer = Buffer.alloc(0);
  private escapeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onResolvedEvents: NativeInputDecoderOptions['onResolvedEvents'];
  private readonly escapeResolveMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(options: NativeInputDecoderOptions = {}) {
    this.onResolvedEvents = options.onResolvedEvents;
    this.escapeResolveMs = options.escapeResolveMs ?? DEFAULT_ESCAPE_RESOLVE_MS;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  /** True when an incomplete ESC/CSI/SS3/X10 prefix is waiting for more bytes. */
  get hasPendingControl(): boolean {
    return this.pendingControl.length > 0;
  }

  decode(data: string | Buffer): readonly NativeInputEvent[] {
    this.clearEscapeTimer();
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

      const x10Mouse = matchX10Mouse(input, index);
      if (x10Mouse === 'incomplete') {
        this.pendingControl = input.slice(index);
        break;
      }
      if (x10Mouse !== undefined) {
        events.push(x10Mouse.event);
        index += x10Mouse.raw.length;
        continue;
      }

      const terminalModeReport = this.matchTerminalModeReport(input, index);
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
        if (next === undefined) {
          // Bare ESC at end of chunk — wait for more bytes (SGR/CSI/SS3) or timeout.
          this.pendingControl = input.slice(index);
          break;
        }
        if (next === '[') {
          const raw = consumeUnknownControlSequence(input, index);
          if (raw === undefined) {
            this.pendingControl = input.slice(index);
            break;
          }
          events.push({ type: 'unknown', raw });
          index += raw.length;
        } else if (next === 'O') {
          // Incomplete SS3 (ESC O … for F1–F4 / application keypad). Do not treat
          // as Alt+O until the third byte arrives or the resolve timeout fires.
          if (index + 2 >= input.length) {
            this.pendingControl = input.slice(index);
            break;
          }
          // Known SS3 sequences are handled by matchKnownSequence above; leftover
          // ESC O x is unknown (not Escape — avoids false cancel).
          const third = codePointAt(input, index + 2);
          const raw = char + next + third;
          events.push({ type: 'unknown', raw });
          index += raw.length;
        } else if (isPrintable(next)) {
          events.push(keyEvent('character', { raw: char + next, text: next, alt: true }));
          index += char.length + next.length;
        } else {
          // ESC + non-printable non-CSI (rare) — keep as escape only when next is
          // clearly not a sequence introducer.
          events.push(keyEvent('escape', { raw: char }));
          index += char.length;
        }
        continue;
      }

      events.push(eventForCharacter(char));
      index += char.length;
    }

    this.scheduleEscapeResolveIfNeeded();
    return events;
  }

  /**
   * Resolve buffered incomplete control immediately.
   * - bare ESC → Escape key
   * - incomplete CSI / SS3 / X10 → dropped as `unknown` (never Escape)
   */
  flushPendingControl(): readonly NativeInputEvent[] {
    this.clearEscapeTimer();
    if (this.pendingControl.length === 0) return [];
    const pending = this.pendingControl;
    this.pendingControl = '';
    if (pending === '\u001B') {
      return [keyEvent('escape', { raw: pending })];
    }
    // Timed-out incomplete SS3 prefix: treat as Alt+O (not Escape).
    if (pending === '\u001BO') {
      return [keyEvent('character', { raw: pending, text: 'O', alt: true })];
    }
    // Incomplete multi-byte CSI/SGR/X10 — do not synthesize Escape (false interrupt).
    return [{ type: 'unknown', raw: pending }];
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

  dispose(): void {
    this.clearEscapeTimer();
    this.pendingControl = '';
    this.pendingUtf8 = Buffer.alloc(0);
    this.pasteText = undefined;
    this.pasteRaw = '';
  }

  private scheduleEscapeResolveIfNeeded(): void {
    // Only bare ESC / incomplete SS3 use a short resolve timer. Incomplete
    // CSI/SGR/X10 wait for more bytes indefinitely (next stdin chunk).
    if (this.pendingControl !== '\u001B' && this.pendingControl !== '\u001BO') {
      return;
    }
    // Without onResolvedEvents there is no async delivery path — leave pending
    // for the next decode() or an explicit flushPendingControl() (see
    // decodeNativeInput). Arming a timer here would flush-and-drop Escape.
    if (this.onResolvedEvents === undefined || this.escapeResolveMs < 0) {
      return;
    }
    this.clearEscapeTimer();
    const delay = Math.max(0, this.escapeResolveMs);
    this.escapeTimer = this.setTimer(() => {
      this.escapeTimer = null;
      const resolved = this.flushPendingControl();
      if (resolved.length > 0) {
        this.onResolvedEvents?.(resolved);
      }
    }, delay);
  }

  private clearEscapeTimer(): void {
    if (this.escapeTimer === null) return;
    this.clearTimer(this.escapeTimer);
    this.escapeTimer = null;
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

  private matchTerminalModeReport(
    input: string,
    index: number,
  ):
    | {
        readonly raw: string;
        readonly event: Extract<NativeInputEvent, { type: 'terminal-mode-report' }>;
      }
    | undefined {
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
}

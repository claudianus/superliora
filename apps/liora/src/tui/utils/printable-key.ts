/**
 * Decode raw stdin bytes into a comparable printable character.
 *
 * Some terminals report printable keys as CSI-u escape sequences
 * (`\x1b[114u` for `r`, `\x1b[113u` for `q`) — the Kitty keyboard protocol
 * and several terminal emulators' kitty-compat modes do this. A bare
 * `data === 'q'` comparison inside a Container's `handleInput` therefore
 * never matches on those terminals.
 *
 * Rules:
 * - Every bare-literal printable-character comparison (letters, digits,
 *   space, punctuation) must go through this function first.
 * - Functional keys (arrows, Enter, Tab, Esc, ...) continue to use
 *   `matchesKey(data, Key.*)`; the renderer-owned matcher already handles Kitty.
 * - Control characters (codepoint < 32, e.g. ctrl-b, ctrl-f) may still
 *   compare against the raw `data` — `decodeKittyPrintable` rejects them.
 *
 * The module's existence is itself the "don't forget to decode" constraint:
 * `test/tui/printable-key-guard.test.ts` scans every `handleInput` under
 * `tui/components/**` and rejects bare-literal comparisons.
 */

import { decodeKittyPrintable } from '#/tui/renderer';

export function printableChar(data: string): string {
  return decodeKittyPrintable(data) ?? data;
}

/**
 * True when a decoded key is printable text safe to append to a text input
 * (e.g. a search box). Accepts single code points, surrogate pairs (emoji,
 * CJK ideographs), and merged multi-character stdin chunks (a busy event
 * loop can coalesce two hangul syllables into one chunk). Rejects anything
 * containing C0 control chars, DEL, or an escape byte — i.e. raw escape
 * sequences never pass. Space is accepted.
 */
export function isPrintableChar(ch: string): boolean {
  if (ch.length === 0) return false;
  for (const char of ch) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

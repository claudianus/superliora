/**
 * Stateful scrubber for reasoning/thinking tags in streamed assistant text.
 *
 * Ported/adapted from Hermes StreamingThinkScrubber patterns: suppress
 * `<think>`, `<thinking>`, `<reasoning>`, `<thought>`, and
 * `<REASONING_SCRATCHPAD>` blocks so leaked model reasoning never reaches
 * the user transcript or downstream TTS/ACP consumers.
 *
 * Closed pairs are always suppressed. Unterminated open tags only start a
 * block at stream/line boundaries so prose that mentions the tag name is
 * preserved.
 */

const TAG_NAMES = [
  'think',
  'thinking',
  'reasoning',
  'thought',
  'reasoning_scratchpad',
] as const;

const TAG_ALT = TAG_NAMES.join('|');
const OPEN_RE = new RegExp(`<(${TAG_ALT})(?:\\s[^>]*)?>`, 'i');
const CLOSE_RE = new RegExp(`</(${TAG_ALT})\\s*>`, 'i');
const CLOSED_PAIR_RE = new RegExp(
  `<(${TAG_ALT})(?:\\s[^>]*)?>[\\s\\S]*?</\\1\\s*>`,
  'i',
);

// Hold back only a short suffix that might be a partial open/close tag.
const MAX_HOLD = 32;

export class StreamingThinkScrubber {
  private inBlock = false;
  private buf = '';
  private lastEmittedEndedNewline = true;

  reset(): void {
    this.inBlock = false;
    this.buf = '';
    this.lastEmittedEndedNewline = true;
  }

  feed(delta: string): string {
    if (delta.length === 0) return '';
    this.buf += delta;
    return this.consume(false);
  }

  flush(): string {
    return this.consume(true);
  }

  private consume(flush: boolean): string {
    let out = '';
    while (this.buf.length > 0) {
      if (this.inBlock) {
        const close = CLOSE_RE.exec(this.buf);
        if (close !== null && close.index !== undefined) {
          this.buf = this.buf.slice(close.index + close[0].length);
          this.inBlock = false;
          continue;
        }
        if (flush) {
          this.buf = '';
          break;
        }
        if (this.buf.length > MAX_HOLD) {
          this.buf = this.buf.slice(-MAX_HOLD);
        }
        break;
      }

      // Always suppress complete closed pairs, even mid-line.
      const pair = CLOSED_PAIR_RE.exec(this.buf);
      if (pair !== null && pair.index !== undefined) {
        if (pair.index > 0) {
          const prefix = this.buf.slice(0, pair.index);
          out += prefix;
          this.noteEmission(prefix);
        }
        this.buf = this.buf.slice(pair.index + pair[0].length);
        continue;
      }

      const open = OPEN_RE.exec(this.buf);
      if (open !== null && open.index !== undefined) {
        const atBoundary = this.isOpenBoundary(open.index);
        if (!atBoundary) {
          // Might still become a closed pair later — hold from the open tag.
          if (!flush) {
            if (open.index > 0) {
              const prefix = this.buf.slice(0, open.index);
              out += prefix;
              this.noteEmission(prefix);
              this.buf = this.buf.slice(open.index);
            }
            // Wait for more data / flush before treating as prose.
            if (this.buf.length > MAX_HOLD * 4) {
              // Unlikely to close — emit the open tag as prose.
              const end = open[0].length;
              out += this.buf.slice(0, end);
              this.noteEmission(this.buf.slice(0, end));
              this.buf = this.buf.slice(end);
              continue;
            }
            break;
          }
          // Flush: emit as prose.
          const end = open.index + open[0].length;
          out += this.buf.slice(0, end);
          this.noteEmission(this.buf.slice(0, end));
          this.buf = this.buf.slice(end);
          continue;
        }

        if (open.index > 0) {
          const prefix = this.buf.slice(0, open.index);
          out += prefix;
          this.noteEmission(prefix);
        }
        this.buf = this.buf.slice(open.index + open[0].length);
        this.inBlock = true;
        continue;
      }

      // No open tag. Hold only a trailing partial tag candidate.
      if (!flush) {
        const holdFrom = this.partialTagHoldIndex(this.buf);
        if (holdFrom > 0) {
          const emit = this.buf.slice(0, holdFrom);
          out += emit;
          this.noteEmission(emit);
          this.buf = this.buf.slice(holdFrom);
        } else if (holdFrom === 0) {
          // Entire buffer is a partial tag candidate.
          break;
        } else {
          // No partial tag — emit all.
          out += this.buf;
          this.noteEmission(this.buf);
          this.buf = '';
        }
        break;
      }

      out += this.buf;
      this.noteEmission(this.buf);
      this.buf = '';
      break;
    }
    return out;
  }

  private partialTagHoldIndex(text: string): number {
    const lt = text.lastIndexOf('<');
    if (lt === -1) return -1;
    const tail = text.slice(lt);
    // Incomplete open/close tag form.
    if (/^<\/?[a-z_]*$/i.test(tail) || /^<\/?[a-z_]+(?:\s[^>]*)?$/i.test(tail)) {
      return lt;
    }
    return -1;
  }

  private isOpenBoundary(index: number): boolean {
    if (index === 0) {
      return this.lastEmittedEndedNewline;
    }
    const before = this.buf.slice(0, index);
    if (before.endsWith('\n')) return true;
    const lastNl = before.lastIndexOf('\n');
    const line = lastNl === -1 ? before : before.slice(lastNl + 1);
    return line.trim().length === 0;
  }

  private noteEmission(text: string): void {
    if (text.length === 0) return;
    this.lastEmittedEndedNewline = text.endsWith('\n');
  }
}

/** One-shot helper for complete (non-streaming) strings. */
export function stripThinkBlocks(text: string): string {
  const scrubber = new StreamingThinkScrubber();
  const visible = scrubber.feed(text);
  return visible + scrubber.flush();
}

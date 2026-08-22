/**
 * Streaming markdown checkpoint: the longest prefix of source that later
 * appends cannot change. Frozen at the last complete blank line (outside a
 * fence) or after a closed fence, so settled paragraphs and code blocks are
 * not re-parsed on every token.
 */

export interface MarkdownSourceLine {
  readonly text: string;
  readonly start: number;
  readonly hasNewline: boolean;
}

export function isMarkdownFenceOpen(line: string): boolean {
  return /^\s*```([^\s`]*)?.*$/.test(line);
}

export function isMarkdownFenceClose(line: string): boolean {
  return /^\s*```\s*$/.test(line);
}

export function splitMarkdownSourceLines(text: string): MarkdownSourceLine[] {
  const lines: MarkdownSourceLine[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\n') continue;
    lines.push({ text: text.slice(start, i), start, hasNewline: true });
    start = i + 1;
  }
  if (start < text.length) {
    lines.push({ text: text.slice(start), start, hasNewline: false });
  }
  return lines;
}

/**
 * Byte offset where the frozen prefix ends. The tail (from this offset) is
 * the only slice that still needs parse+wrap while text is appended.
 */
export function findFrozenMarkdownSourceEnd(text: string): number {
  if (text.length === 0) return 0;
  const lines = splitMarkdownSourceLines(text);
  let inFence = false;
  let best = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.hasNewline) break;
    const after = line.start + line.text.length + 1;

    if (inFence) {
      if (isMarkdownFenceClose(line.text)) {
        inFence = false;
        best = after;
      }
      continue;
    }

    if (isMarkdownFenceOpen(line.text)) {
      inFence = true;
      continue;
    }

    if (line.text.trim().length === 0) {
      const prev = i > 0 ? lines[i - 1] : undefined;
      if (prev !== undefined && prev.hasNewline && prev.text.trim().length > 0) {
        best = line.start;
      }
    }
  }
  return best;
}

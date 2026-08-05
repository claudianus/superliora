/**
 * Match-highlight segments for Command Hub rows.
 *
 * `fuzzyMatch()` reports only a score, so rendering needs its own scan:
 * each whitespace-separated query token is matched as a greedy left-to-right
 * subsequence against the label. Tokens that matched elsewhere (description,
 * keywords) simply contribute no ranges — a partially highlighted label is
 * still truthful, a wrongly highlighted one would not be.
 */

export interface HubHighlightSegment {
  readonly text: string;
  readonly matched: boolean;
}

export function hubHighlightSegments(
  text: string,
  query: string,
): readonly HubHighlightSegment[] {
  if (text.length === 0) return [{ text, matched: false }];
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [{ text, matched: false }];

  const hits = new Set<number>();
  const lower = text.toLowerCase();
  for (const token of tokens) {
    const indices: number[] = [];
    let from = 0;
    for (const ch of token) {
      const at = lower.indexOf(ch, from);
      if (at === -1) {
        indices.length = 0;
        break;
      }
      // `ch` may be a surrogate pair; mark every UTF-16 unit it covers.
      for (let i = at; i < at + ch.length; i += 1) indices.push(i);
      from = at + ch.length;
    }
    for (const i of indices) hits.add(i);
  }

  const segments: HubHighlightSegment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || hits.has(i) !== hits.has(start)) {
      segments.push({ text: text.slice(start, i), matched: hits.has(start) });
      start = i;
    }
  }
  return segments;
}

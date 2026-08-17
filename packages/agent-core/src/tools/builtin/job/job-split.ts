/**
 * Multi-intent → multiple Jobs (Conductor locked policy).
 * Structural list parse only — numbered or bullet items.
 * Verb/conjunction keyword splits are forbidden; otherwise one Job
 * (Conductor should call JobCreate N times).
 */

export interface SplitJobIntent {
  readonly title: string;
  readonly prompt: string;
}

/**
 * Split a user message into task-like intents.
 * Returns a single intent when the message is not a list (fallback single Job).
 */
export function splitUserMessageIntoJobIntents(message: string): readonly SplitJobIntent[] {
  const text = message.trim();
  if (text.length === 0) return [];

  // Numbered list: 1. ... 2. ... or 1) ...
  const numbered = text.match(/(?:^|\n)\s*\d+[.)]\s+.+/g);
  if (numbered && numbered.length >= 2) {
    const items = numbered
      .map((line) => line.replace(/^\s*\d+[.)]\s+/, '').trim())
      .filter((s) => s.length > 0);
    if (items.length >= 2) {
      return items.map((item) => ({
        title: titleFromLine(item),
        prompt: item,
      }));
    }
  }

  // Bullet list: - / * / •
  const bullets = text.match(/(?:^|\n)\s*[-*•]\s+.+/g);
  if (bullets && bullets.length >= 2) {
    const items = bullets
      .map((line) => line.replace(/^\s*[-*•]\s+/, '').trim())
      .filter((s) => s.length > 0);
    if (items.length >= 2) {
      return items.map((item) => ({
        title: titleFromLine(item),
        prompt: item,
      }));
    }
  }

  return [{ title: titleFromLine(text), prompt: text }];
}

function titleFromLine(line: string): string {
  const one = line.replace(/\s+/g, ' ').trim();
  if (one.length <= 72) return one;
  return `${one.slice(0, 69)}...`;
}

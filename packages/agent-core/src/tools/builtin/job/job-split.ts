/**
 * Multi-intent → multiple Jobs (Conductor locked policy).
 * Heuristic only — LLM may still call JobCreate N times; this helps tools/prompts.
 */

export interface SplitJobIntent {
  readonly title: string;
  readonly prompt: string;
}

/**
 * Split a user message into task-like intents.
 * Returns a single intent when split is unsafe/ambiguous (fallback single Job).
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

  // Semicolon / "and also" / Korean "그리고" / "또"
  const clauses = text
    .split(/\s*(?:;|\band also\b|\bthen\b|그리고|또한|또)\s+/iu)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  if (clauses.length >= 2 && clauses.length <= 8) {
    // Require each clause to look task-like (verb-ish or path-ish)
    const taskish = clauses.filter((c) =>
      /\b(fix|add|implement|create|update|remove|refactor|test|write|build|check|investigate|조사|추가|수정|구현|작성|확인)\b/iu.test(
        c,
      ),
    );
    if (taskish.length >= 2) {
      return taskish.map((item) => ({
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

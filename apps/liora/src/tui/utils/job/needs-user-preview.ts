/**
 * Two-line question preview for needs_user Deck / Inbox rows.
 */

/** Cap a free-text question/summary to at most `maxLines` non-empty lines. */
export function formatNeedsUserQuestionPreview(
  text: string | undefined,
  maxLines = 2,
): readonly string[] {
  if (text === undefined) return [];
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.slice(0, maxLines);
}

/** Prefer result summary, then inbox summary, for needs_user preview. */
export function resolveNeedsUserQuestionText(input: {
  readonly resultSummary?: string;
  readonly inboxSummary?: string;
}): string | undefined {
  const fromResult = input.resultSummary?.trim();
  if (fromResult !== undefined && fromResult.length > 0) return fromResult;
  const fromInbox = input.inboxSummary?.trim();
  if (fromInbox !== undefined && fromInbox.length > 0) return fromInbox;
  return undefined;
}

/**
 * Plan line comments — number plan markdown and attach operator feedback
 * against a specific line without elevating permissions.
 *
 * Comments are user feedback only. They never auto-approve and never bypass
 * the permission deny chain (FedRAMP AC6 MUST §plan line comments).
 */

export interface PlanLine {
  readonly number: number;
  readonly text: string;
}

export interface PlanLineComment {
  /** 1-based line number from {@link numberPlanLines}. */
  readonly line: number;
  readonly comment: string;
}

const MAX_PLAN_PREVIEW_LINES = 80;
const MAX_COMMENT_LENGTH = 400;

/**
 * Split plan markdown into 1-based numbered lines (trailing empty lines trimmed).
 */
export function numberPlanLines(plan: string): readonly PlanLine[] {
  const raw = plan.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = raw.split('\n');
  while (lines.length > 0 && (lines.at(-1) ?? '').trim().length === 0) {
    lines.pop();
  }
  return lines.map((text, index) => ({ number: index + 1, text }));
}

/**
 * Render a compact numbered preview for the approval panel.
 * Does not truncate mid-line secrets specially — plan content is operator-authored.
 */
export function formatNumberedPlanPreview(
  plan: string,
  options: { readonly maxLines?: number } = {},
): string {
  const maxLines = options.maxLines ?? MAX_PLAN_PREVIEW_LINES;
  const lines = numberPlanLines(plan);
  if (lines.length === 0) return '(빈 계획)';

  const visible = lines.slice(0, maxLines);
  const width = String(visible.length === 0 ? 1 : visible.at(-1)!.number).length;
  const body = visible
    .map((line) => `${String(line.number).padStart(width, ' ')}│ ${line.text}`)
    .join('\n');

  if (lines.length > maxLines) {
    return `${body}\n… (+${String(lines.length - maxLines)}줄)`;
  }
  return body;
}

/**
 * Parse free-form feedback that targets a plan line.
 * Accepts: "L12: fix auth", "12 fix auth", "라인 12: …"
 * Returns null when no line reference is present (plain revise feedback).
 */
export function parsePlanLineComment(feedback: string): PlanLineComment | null {
  const trimmed = feedback.trim();
  if (trimmed.length === 0) return null;

  const match = trimmed.match(/^(?:L|l|라인\s*)?(\d+)\s*[:：\-.]?\s*(.+)$/u);
  if (match === null) return null;
  const line = Number(match[1]);
  const comment = (match[2] ?? '').trim();
  if (!Number.isInteger(line) || line < 1 || comment.length === 0) return null;
  return {
    line,
    comment: comment.slice(0, MAX_COMMENT_LENGTH),
  };
}

/**
 * Build a structured feedback string for ExitPlanMode revise path.
 * Always additive user intent — never an approve token.
 */
export function formatPlanLineCommentFeedback(
  comment: PlanLineComment,
  planLineText: string | undefined,
): string {
  const snippet =
    planLineText === undefined || planLineText.trim().length === 0
      ? ''
      : ` 「${planLineText.trim().slice(0, 80)}」`;
  return `라인 ${String(comment.line)} 코멘트${snippet}: ${comment.comment}`;
}

/**
 * Attach a line comment onto revise feedback. If parsing fails, return original.
 */
export function enrichReviseFeedbackWithLineComment(
  feedback: string,
  plan: string,
): string {
  const parsed = parsePlanLineComment(feedback);
  if (parsed === null) return feedback.trim();
  const lines = numberPlanLines(plan);
  const target = lines.find((line) => line.number === parsed.line);
  return formatPlanLineCommentFeedback(parsed, target?.text);
}

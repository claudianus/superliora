/**
 * Detect artifact text that invents a deferral bucket or attributes an
 * approval/deferral to the user when no such decision was made
 * (e.g. "DEFERRED to daylight", "approved-tonight").
 *
 * ponytail: narrow lexical patterns only — legitimate prose about daylight
 * saving or "approved per user request in #123" should not match.
 */

export const FABRICATED_DEFER_BLOCKED_MESSAGE =
  'Write/Edit blocked: content attributes a deferral or approval to the user with an invented time bucket (e.g. "DEFERRED to daylight", "approved-tonight"). Use active voice without user attribution ("Agent deferred: …"), or call AskUserQuestion for a real decision. Remove the fabricated decision and retry.';

const FABRICATED_DEFER_PATTERNS = [
  /\bDEFERRED\s+to\s+(daylight|tonight|tomorrow|later(?:\s+this\s+week)?)\b/i,
  /\bdeferred\s+to\s+(daylight|tonight|tomorrow)\b/i,
  /\bapproved[- _]?(tonight|tomorrow|to[- _]?daylight)\b/i,
  /\bdeferred\s+per\s+user\b/i,
  /\bdeferred\s+per\s+(?:your|the\s+user'?s?)\s+(?:call|request|approval)\b/i,
] as const;

export function hasFabricatedDeferral(content: string): boolean {
  if (content.length === 0) return false;
  return FABRICATED_DEFER_PATTERNS.some((pattern) => pattern.test(content));
}

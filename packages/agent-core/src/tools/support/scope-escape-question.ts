/**
 * Detect AskUserQuestion payloads that renegotiate magnitude / confirm the
 * user "really wants" a large goal — a known escape hatch that stalls
 * autonomous goal/auto runs overnight.
 *
 * ponytail: free-text heuristic. False positives only fall through to a
 * tool error (model continues); false negatives are the real risk, so
 * patterns target the documented escape phrasing.
 */

export const SCOPE_ESCAPE_QUESTION_BLOCKED_MESSAGE =
  'AskUserQuestion blocked: this looks like a scope-escape / "do you still want this?" check. Goal and auto modes forbid renegotiating magnitude. Continue with the next verifiable slice (or UpdateGoal `blocked` only for a real external blocker). Do not rephrase the same question.';

/** Patterns that mark a question as magnitude renegotiation rather than a real preference. */
const SCOPE_ESCAPE_PATTERNS = [
  /\bdo you (?:really |still )?want\b/i,
  /\bare you sure you want\b/i,
  /\bgiven the (?:magnitude|scope|size|scale)\b/i,
  /\b(?:this|the) (?:task|goal|work) is (?:genuinely )?(?:huge|massive|enormous)\b/i,
  /\btoo (?:large|big|complex|much) (?:to|for)\b/i,
  /\bwhat scope should we (?:aim|target|pursue)\b/i,
  /\b(?:reduce|shrink|cut|narrow|trim)\s+(?:the\s+)?scope\b/i,
  /\brealistically[, ]+what\b/i,
  /\bshould we (?:defer|postpone|scale\s+back|cut\s+back)\b/i,
  /\bis (?:this|that) (?:worth|feasible|practical)\b/i,
  /\bmagnitude of (?:the |this )?work\b/i,
] as const;

export interface ScopeEscapeQuestionText {
  readonly question: string;
  readonly header?: string | undefined;
  readonly options?:
    | ReadonlyArray<{
        readonly label: string;
        readonly description?: string | undefined;
      }>
    | undefined;
}

export function isScopeEscapeQuestion(question: ScopeEscapeQuestionText): boolean {
  const text = [
    question.question,
    question.header ?? '',
    ...(question.options ?? []).flatMap((option) => [
      option.label,
      option.description ?? '',
    ]),
  ].join('\n');
  return SCOPE_ESCAPE_PATTERNS.some((pattern) => pattern.test(text));
}

export function questionsIncludeScopeEscape(
  questions: ReadonlyArray<ScopeEscapeQuestionText>,
): boolean {
  return questions.some(isScopeEscapeQuestion);
}

export interface ScopeEscapeBlockContext {
  readonly askModeActive?: boolean | undefined;
  readonly permissionMode?: string | undefined;
  readonly goalStatus?: string | null | undefined;
  readonly ultraPlanInterview?: boolean | undefined;
}

/**
 * Block in autonomous paths (active goal or auto permission). Never block
 * Ask mode (human is deciding) or Ultra Plan interview (PATH-2 judgment).
 */
export function shouldBlockScopeEscapeQuestion(
  context: ScopeEscapeBlockContext,
): boolean {
  if (context.askModeActive === true) return false;
  if (context.ultraPlanInterview === true) return false;
  if (context.goalStatus === 'active') return true;
  if (context.permissionMode === 'auto') return true;
  return false;
}

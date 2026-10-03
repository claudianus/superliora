import type {
  PermissionOption,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import type { QuestionAnswers, QuestionItem } from '@superliora/sdk';

/**
 * `optionId` namespace for native operator questions.
 *
 * The wire-level `PermissionOption.optionId` is opaque to the client (it
 * round-trips back via `RequestPermissionResponse.outcome.optionId`), so
 * the adapter is free to pick any stable string. We embed the
 * `questionIndex` in the prefix so multi-question support (when it
 * arrives — Phase 13.1 still degrades to single-question) does not need
 * a wire-format change: `q0_opt_*` / `q1_opt_*` are already
 * non-conflicting. The skip option follows the same scheme so a single
 * regex (`/^q(\d+)_(opt_(\d+)|skip)$/`) can parse any future surface.
 */
function optOptionId(questionIndex: number, optionIndex: number): string {
  return `q${questionIndex}_opt_${optionIndex}`;
}

function skipOptionId(questionIndex: number): string {
  return `q${questionIndex}_skip`;
}

/**
 * Map a tool-side {@link QuestionItem} into ACP
 * {@link PermissionOption}[].
 *
 * Layout:
 *  - One `allow_once` option per `question.options[i]` (label preserved
 *    verbatim — it is the same string we surface back to the SDK as a
 *    `QuestionAnswers` value, so any UI normalisation belongs on the
 *    tool side, not here).
 *  - One trailing `reject_once` "Skip" option for explicit dismissal.
 *
 * The index namespaces option ids; each response maps to the presented question.
 *
 * Returned `readonly` because callers treat it as a constant lookup
 * table — they do not mutate it.
 */
export function questionItemToPermissionOptions(
  question: QuestionItem,
  questionIndex: number,
): readonly PermissionOption[] {
  const options: PermissionOption[] = question.options.map((opt, i) => ({
    optionId: optOptionId(questionIndex, i),
    name: opt.label,
    kind: 'allow_once' as const,
  }));
  options.push({
    optionId: skipOptionId(questionIndex),
    name: 'Skip',
    kind: 'reject_once' as const,
  });
  return options;
}

/**
 * Reverse-map an ACP {@link RequestPermissionResponse} into a tool-side
 * {@link QuestionAnswers} payload, returning `null` when the user
 * dismissed (skip, cancel) or selected an unknown option.
 *
 * `null` is the native dismissed signal.
 *
 * Defensive on out-of-bounds / unknown optionIds: returning `null`
 * rather than throwing keeps the bridge robust against stale or custom
 * options surfaced by the client.
 */
export function outcomeToQuestionAnswer(
  question: QuestionItem,
  response: RequestPermissionResponse,
): QuestionAnswers | null {
  if (response.outcome.outcome === 'cancelled') return null;
  const optionId = response.outcome.optionId;
  // Skip — explicit dismissal path; treat the same as `cancelled`.
  if (optionId === skipOptionId(0)) return null;
  // Selected option — parse the `q0_opt_<i>` shape and look up the
  // matching label. Reject anything that does not match the namespace
  // (or whose index is out of bounds) defensively rather than crashing.
  const match = /^q0_opt_(\d+)$/.exec(optionId);
  if (!match) return null;
  const optionIndex = Number(match[1]);
  if (!Number.isInteger(optionIndex) || optionIndex < 0) return null;
  const selected = question.options[optionIndex];
  if (!selected) return null;
  return { [question.question]: selected.label };
}

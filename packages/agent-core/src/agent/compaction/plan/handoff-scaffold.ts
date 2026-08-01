/**
 * Deterministic structured-handoff scaffold for free-form compaction summaries.
 *
 * All providers benefit: when the summarizer returns prose without v2 labels,
 * we still produce OpenCode-style sections so resume quality does not depend on
 * a single model obeying free-form instructions.
 */

import { hasExactV2Attempt } from './quality-helpers';

export interface HandoffScaffoldOptions {
  /** Latest compacted user request (preferred current_goal). */
  readonly latestUserRequest?: string | undefined;
  /** Optional first next_action hint (e.g. from planner). */
  readonly nextActionHint?: string | undefined;
}

const MAX_GOAL_CHARS = 280;
const MAX_STATE_CHARS = 2_400;

/**
 * If `summary` already has v2 labels, return it unchanged. Otherwise wrap the
 * prose into the required section labels so quality gates and resume preflight
 * can parse a structured handoff.
 */
export function ensureStructuredHandoffScaffold(
  summary: string,
  options: HandoffScaffoldOptions = {},
): string {
  const trimmed = summary.trim();
  if (trimmed.length === 0) return summary;
  if (hasExactV2Attempt(trimmed)) return summary;

  const goalSource =
    options.latestUserRequest?.replaceAll(/\s+/g, ' ').trim() ||
    firstNonEmptyLine(trimmed) ||
    'Continue the active user task from the compacted state.';
  const goal =
    goalSource.length > MAX_GOAL_CHARS
      ? `${goalSource.slice(0, MAX_GOAL_CHARS - 1)}…`
      : goalSource;

  const stateBody =
    trimmed.length > MAX_STATE_CHARS
      ? `${trimmed.slice(0, MAX_STATE_CHARS - 1)}…`
      : trimmed;
  const next =
    options.nextActionHint?.replaceAll(/\s+/g, ' ').trim() ||
    'Inspect the retained recent context, then continue the pending implementation or verification step.';

  return [
    'current_goal:',
    `- ${goal}`,
    'last_known_state:',
    `- ${singleLine(stateBody)}`,
    'decisions:',
    '- none captured from free-form handoff (scaffold)',
    'files_touched:',
    '- none captured from free-form handoff (scaffold)',
    'failed_attempts:',
    '- none captured from free-form handoff (scaffold)',
    'open_questions:',
    '- none captured from free-form handoff (scaffold)',
    'next_actions:',
    `- ${next}`,
    'verified_claims:',
    '- free-form handoff scaffolded | evidence=n/a | needs_revalidation=true',
    'raw_refs:',
    '- none',
    '',
    '## Compacted Narrative (original free-form)',
    trimmed,
  ].join('\n');
}

function firstNonEmptyLine(text: string): string | undefined {
  for (const line of text.split('\n')) {
    const t = line.replaceAll(/\s+/g, ' ').trim();
    if (t.length > 0) return t;
  }
  return undefined;
}

function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

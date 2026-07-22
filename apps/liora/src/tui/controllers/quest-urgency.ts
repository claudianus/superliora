/**
 * Quest Urgency — Gen 38 triage scoring.
 *
 * Turns a quest's lifecycle state and how long it has been left unattended
 * into a single urgency number so the dashboard can surface the most
 * neglected quest first. The state dominates the score (a quest awaiting
 * approval always outranks a healthy one); within the same state the quest
 * that has waited longest wins.
 *
 * Pure and side-effect free so the scoring is unit-testable in isolation.
 */

import {
  type Quest,
  questStatePriority,
  ATTENTION_STATES,
} from './quest-types';

/** Weight per state-priority level — large enough to dominate dwell time. */
const STATE_WEIGHT = 1_000_000;

/**
 * Gen 38: urgency score for a quest. Higher means more urgent. The state
 * priority contributes the dominant term; a quest sitting in an attention
 * state adds the milliseconds it has been waiting so the longest-neglected
 * quest of equal priority sorts first.
 */
export function questUrgencyScore(quest: Quest, now: number = Date.now()): number {
  // Invert state priority so attention states (priority 0) weigh the most.
  const stateWeight = (6 - questStatePriority(quest.state)) * STATE_WEIGHT;
  const dwell =
    quest.attentionEnteredAt !== undefined && ATTENTION_STATES.has(quest.state)
      ? Math.max(0, now - quest.attentionEnteredAt)
      : 0;
  return stateWeight + dwell;
}

/**
 * Gen 38: comparator for triage ordering. Returns negative when `a` is more
 * urgent than `b` (so `a` sorts first). Falls back to insertion-stable order
 * via the caller when scores tie exactly.
 */
export function compareByUrgency(a: Quest, b: Quest, now: number = Date.now()): number {
  return questUrgencyScore(b, now) - questUrgencyScore(a, now);
}

/** Gen 49: a quest paired with its computed urgency score. */
export interface RankedQuest {
  readonly quest: Quest;
  readonly score: number;
}

/**
 * Gen 49: rank a list of quests by urgency, most urgent first, each paired
 * with its score. Stable for equal scores (preserves input order). Useful for
 * triage UIs that want to show the top-N most urgent quests with their scores.
 */
export function rankQuestsByUrgency(
  quests: readonly Quest[],
  now: number = Date.now(),
): RankedQuest[] {
  return quests
    .map((quest, index) => ({ quest, score: questUrgencyScore(quest, now), index }))
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.index - b.index))
    .map(({ quest, score }) => ({ quest, score }));
}

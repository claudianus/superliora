/**
 * Trajectory serialization for the refine planner.
 *
 * Reuses the compaction plan renderer and keeps the tail of the
 * conversation: harness lessons come from recent behavior, and the planner
 * context stays bounded no matter how long the session ran.
 */

import type { Message } from '@superliora/kosong';

import { renderMessagesToText } from '../compaction/plan/render-messages';

/** Rough char budget for the serialized trajectory (~30k tokens). */
export const REFINE_TRAJECTORY_MAX_CHARS = 120_000;

export function serializeTrajectoryForRefine(
  messages: readonly Message[],
  maxChars: number = REFINE_TRAJECTORY_MAX_CHARS,
): string {
  const rendered = renderMessagesToText(messages);
  if (rendered.length <= maxChars) return rendered;
  return [
    '[earlier trajectory omitted for budget]',
    '',
    rendered.slice(rendered.length - maxChars),
  ].join('\n');
}

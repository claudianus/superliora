/** Shared handoff text collapse policy (phase handoffs and parent boundary compaction).
 *
 * Expert/phase handoff bodies need room for verdict + evidence_ids + concrete
 * findings. 800 densify thrash cut long-horizon integrate quality; 1600 keeps
 * multi-expert envelopes inside the 6k total swarm result floor.
 */

export const SWARM_EXPERT_BODY_MAX_CHARS = 1_600;

/** Inline summary beside an archive marker — full body lives in ToolStore. */
export const SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS = 120;

export function collapseForHandoff(text: string, maxChars: number = SWARM_EXPERT_BODY_MAX_CHARS): string {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 3)}...`;
}

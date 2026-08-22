/**
 * Merge adjacent plain queued prompts into one model turn.
 * Followers with images, bash, or empty text stop the run.
 */

export const COMBINED_QUEUE_SEPARATOR = '\n\n';

export interface CombineQueuedGate {
  readonly id?: string;
  readonly isPlainPrompt: boolean;
  readonly hasImages: boolean;
  readonly isBash: boolean;
  /** Client-expanded skill / brief payload — never combine. */
  readonly isExpandedSkill?: boolean;
  readonly isSynthetic?: boolean;
  readonly text: string;
}

export function canMergeQueuedFront(gate: CombineQueuedGate): boolean {
  return (
    gate.isPlainPrompt &&
    !gate.isBash &&
    !gate.isExpandedSkill &&
    !gate.isSynthetic &&
    gate.text.length > 0
  );
}

export function canMergeQueuedFollower(gate: CombineQueuedGate): boolean {
  return canMergeQueuedFront(gate) && !gate.hasImages;
}

/** Length of the mergeable prefix, including front. `1` = take front only. */
export function combineQueuedPrefixLen(items: readonly CombineQueuedGate[]): number {
  const front = items[0];
  if (front === undefined) return 0;
  if (!canMergeQueuedFront(front)) return 1;
  let n = 1;
  for (let i = 1; i < items.length; i++) {
    if (!canMergeQueuedFollower(items[i]!)) break;
    n += 1;
  }
  return n;
}

export function joinQueuedTexts(texts: readonly string[]): string {
  return texts.filter((text) => text.length > 0).join(COMBINED_QUEUE_SEPARATOR);
}

/** Original display strings when at least two prompts were merged. */
export function stampCombinedDisplayTexts(
  texts: readonly string[],
): readonly string[] | undefined {
  const segs = texts.filter((text) => text.length > 0);
  return segs.length >= 2 ? segs : undefined;
}

/**
 * Recorded brief and effect preview lines for Job Deck and ACK notices.
 */

import type { JobBriefPreview } from '@superliora/protocol';

const LINE_BREAKS = /[\r\n\u2028\u2029]+/g;
/** Brief preview lines for ACK / Deck (capped). */
export function formatBriefPreviewLines(
  brief: JobBriefPreview,
  maxLines = 3,
): readonly string[] {
  const lines: string[] = [];
  const criteria = brief.successCriteria ?? [];
  if (criteria.length > 0) {
    lines.push(`ok: ${criteria.slice(0, 2).join('; ')}`.replaceAll(LINE_BREAKS, ' '));
  }
  const mustNot = brief.mustNotTouch ?? [];
  if (mustNot.length > 0) {
    lines.push(`don't touch: ${mustNot.slice(0, 2).join(', ')}`.replaceAll(LINE_BREAKS, ' '));
  }
  const verify = brief.verificationCommands ?? [];
  if (verify.length > 0) {
    lines.push(`verify: ${verify.slice(0, 2).join('; ')}`.replaceAll(LINE_BREAKS, ' '));
  }
  return lines.slice(0, maxLines);
}

/** Combined ACK detail from the recorded Job brief and effect preview. */
export function formatJobAckDetail(input: {
  readonly effectPreview?: { readonly summary: string };
  readonly briefPreview?: JobBriefPreview;
}): string | undefined {
  const parts: string[] = [];
  const effect = input.effectPreview?.summary.trim();
  if (effect !== undefined && effect.length > 0) {
    parts.push(effect);
  }
  for (const line of formatBriefPreviewLines(input.briefPreview ?? {}, 2)) {
    parts.push(line);
  }
  return parts.length === 0 ? undefined : parts.join('\n');
}

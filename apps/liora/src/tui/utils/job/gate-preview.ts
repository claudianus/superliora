/**
 * Gate checklist / brief preview lines for Job Deck header and ACK notices (F06).
 */

import type { JobBriefPreview, JobGateChecklist, JobGateChecklistStatus } from '@superliora/protocol';

const GATE_GLYPH: Record<JobGateChecklistStatus, string> = {
  pass: '✓',
  fail: '✗',
  pending: '…',
  na: '–',
};

const GATE_CELLS = [
  ['visual', 'visual'],
  ['review', 'review'],
  ['tests', 'tests'],
  ['typecheck', 'typecheck'],
] as const;

/**
 * Land is first-class only when the snapshot stamps pass/pending/fail.
 * Missing (older snapshots) and `na` (not a land target) are omitted — never
 * painted as pending. Fail is shown so the operator stays on Job Deck.
 */
function formatLandCell(land: JobGateChecklistStatus | undefined): string | undefined {
  if (land === undefined || land === 'na') return undefined;
  return `land${GATE_GLYPH[land]}`;
}

/** Compact one-line gate strip: `visual✓ review… tests✓ typecheck– land…`. */
export function formatGateChecklistLine(checklist: JobGateChecklist): string {
  const cells = GATE_CELLS.map(([key, name]) => `${name}${GATE_GLYPH[checklist[key]]}`);
  const land = formatLandCell(checklist.land);
  if (land !== undefined) cells.push(land);
  return cells.join(' ');
}

/** Pending/fail gates for Merge Preview hold checklist. */
export function formatMissingGateEvidence(
  checklist: JobGateChecklist | undefined,
): readonly string[] {
  if (checklist === undefined) return [];
  const missing: string[] = [];
  for (const [key, name] of GATE_CELLS) {
    const status: JobGateChecklistStatus = checklist[key];
    if (status === 'pending' || status === 'fail') {
      missing.push(`${name}: ${status}`);
    }
  }
  const land = checklist.land;
  if (land === 'pending' || land === 'fail') {
    missing.push(`land: ${land}`);
  }
  return missing;
}

/** Brief preview lines for ACK / Deck (capped). */
export function formatBriefPreviewLines(
  brief: JobBriefPreview,
  maxLines = 3,
): readonly string[] {
  const lines: string[] = [];
  const criteria = brief.successCriteria ?? [];
  if (criteria.length > 0) {
    lines.push(`ok: ${criteria.slice(0, 2).join('; ')}`);
  }
  const mustNot = brief.mustNotTouch ?? [];
  if (mustNot.length > 0) {
    lines.push(`don't touch: ${mustNot.slice(0, 2).join(', ')}`);
  }
  const verify = brief.verificationCommands ?? [];
  if (verify.length > 0) {
    lines.push(`verify: ${verify.slice(0, 2).join('; ')}`);
  }
  return lines.slice(0, maxLines);
}

/** Combined ACK detail for a JobCreate / job.updated with effect, gate, or brief. */
export function formatGateAckDetail(input: {
  readonly effectPreview?: { readonly summary: string };
  readonly gateChecklist?: JobGateChecklist;
  readonly briefPreview?: JobBriefPreview;
}): string | undefined {
  const parts: string[] = [];
  const effect = input.effectPreview?.summary.trim();
  if (effect !== undefined && effect.length > 0) {
    parts.push(effect);
  }
  if (input.gateChecklist !== undefined) {
    parts.push(formatGateChecklistLine(input.gateChecklist));
  }
  for (const line of formatBriefPreviewLines(input.briefPreview ?? {}, 2)) {
    parts.push(line);
  }
  return parts.length === 0 ? undefined : parts.join('\n');
}

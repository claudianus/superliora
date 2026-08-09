/**
 * Land / merge result notice copy for Conductor UX v2 (F05).
 * Pure helpers — wired from job-desk-events handleInbox.
 */

import type { JobInboxEvent, JobLandReceiptSnapshot } from '@superliora/protocol';

import { formatTrustReasonForUser } from './trust-copy';

export interface LandResultNotice {
  readonly title: string;
  readonly detail: string;
}

const LAND_SUMMARY_RE = /\b(land(?:ed|ing)?|merge(?:d)?|local main)\b/i;

export function looksLikeLandInbox(input: {
  readonly kind: JobInboxEvent['kind'];
  readonly summary?: string;
  readonly landReceipt?: JobLandReceiptSnapshot;
  readonly jobKind?: string;
}): boolean {
  if (input.kind !== 'job.completed' && input.kind !== 'job.blocked') return false;
  if (input.landReceipt !== undefined) return true;
  if (input.jobKind === 'merge') return true;
  const summary = input.summary ?? '';
  return LAND_SUMMARY_RE.test(summary);
}

/** Shorten a merge SHA for notice chrome (7 chars when hex-like). */
export function shortMergeSha(sha: string | undefined): string | undefined {
  if (sha === undefined) return undefined;
  const trimmed = sha.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length > 12 ? trimmed.slice(0, 7) : trimmed;
}

/**
 * Build land success / hold / reject notice lines.
 * Success copy: local main only — never claims a remote push.
 */
export function formatLandResultNotice(input: {
  readonly kind: JobInboxEvent['kind'];
  readonly title: string;
  readonly summary?: string;
  readonly landReceipt?: JobLandReceiptSnapshot;
  readonly actionHints?: readonly string[];
  readonly jobKind?: string;
}): LandResultNotice | undefined {
  if (!looksLikeLandInbox(input)) return undefined;

  const summary = input.summary ?? '';
  const holdOrReject = /merge:\s*(reject|hold)\b/i.test(summary) || /\b(reject|hold)\b/i.test(summary);
  if (holdOrReject || input.kind === 'job.blocked') {
    const trust = formatTrustReasonForUser(summary.length > 0 ? summary : input.title);
    const fix = trust.fix === undefined ? '' : `\n${trust.fix}`;
    return {
      title: 'Land held',
      detail: `${trust.headline}${fix}`,
    };
  }

  const sha = shortMergeSha(input.landReceipt?.mergeSha);
  const shaPart = sha === undefined ? '' : ` · ${sha}`;
  const hints = formatLandActionHints(input.actionHints);
  const gcLine =
    input.landReceipt?.gcRemoved === true ? 'GC: worktree removed' : undefined;
  const detailParts = [
    `Landed on local main — not pushed to remote${shaPart}`,
    gcLine,
    hints,
  ].filter((part): part is string => part !== undefined && part.length > 0);

  return {
    title: input.title.length > 0 ? input.title : 'Land complete',
    detail: detailParts.join('\n'),
  };
}

function formatLandActionHints(hints: readonly string[] | undefined): string {
  if (hints !== undefined && hints.length > 0) {
    const mapped = hints.map(hintLabel).filter((h) => h.length > 0);
    if (mapped.length > 0) return `Next: ${mapped.join(' · ')}`;
  }
  return 'Next: review Diff · push when ready';
}

function hintLabel(hint: string): string {
  switch (hint) {
    case 'jobMerge':
      return 'Merge';
    case 'jobInspect':
      return 'Inspect';
    case 'jobResume':
      return 'Resume';
    case 'jobSteer':
      return 'Steer';
    case 'jobCancel':
      return 'Cancel';
    default:
      return hint.trim();
  }
}

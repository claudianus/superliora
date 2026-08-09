/**
 * Infer Push Preview remote ref from a job card (mirrors agent-core job-push
 * inference for UI display — backend remains the source of truth).
 */

import type { ConductorJobCard } from './job-strip';

/** Never auto-infers main/master — those need an explicit remote_ref. */
export function inferPublishRemoteRef(text: string): string | undefined {
  const blob = text.trim();
  if (blob.length === 0) return undefined;

  const structured =
    /\bremote[_ ]?ref\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._/@-]*)/i.exec(blob) ??
    /\bremoteRef\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._/@-]*)/i.exec(blob);
  if (structured?.[1] !== undefined) return structured[1];

  if (/\bgh-pages\b/i.test(blob) || /\bgithub\s*pages\b/i.test(blob)) {
    return 'gh-pages';
  }
  return undefined;
}

export function inferPublishRemoteRefFromJobCard(card: ConductorJobCard): string | undefined {
  const briefBits = [
    card.briefPreview?.successCriteria?.join('\n'),
    card.briefPreview?.verificationCommands?.join('\n'),
  ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  return inferPublishRemoteRef(
    [card.title, card.resultSummary, ...briefBits].filter(Boolean).join('\n'),
  );
}

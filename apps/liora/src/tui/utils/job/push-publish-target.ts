/**
 * Infer Push Preview remote ref from a job card.
 * Structured `remote_ref:` / `remoteRef:` field only — never title keywords.
 * Backend remains the source of truth and may still effect-judge at push time.
 */

import type { ConductorJobCard } from './job-strip';

/** Never auto-infers main/master — those need an explicit remote_ref. */
export function inferPublishRemoteRef(text: string): string | undefined {
  const blob = text.trim();
  if (blob.length === 0) return undefined;

  const structured =
    /\bremote[_ ]?ref\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._/@-]*)/i.exec(blob) ??
    /\bremoteRef\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._/@-]*)/i.exec(blob);
  if (structured?.[1] !== undefined) {
    const token = structured[1];
    if (/^(main|master)$/i.test(token)) return undefined;
    return token;
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

/** Why Push Preview shows this remote ref — never keyword-inferred. */
export function describePublishRemoteRef(input: {
  readonly fromBrief: boolean;
}): string {
  return input.fromBrief
    ? 'from brief remote_ref'
    : 'same as local — set remote_ref to publish elsewhere';
}

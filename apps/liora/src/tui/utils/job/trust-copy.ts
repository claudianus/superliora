/**
 * Plain-English user copy for Conductor merge / land trust reject reasons.
 * Maps engineer jargon (UNVERIFIED, Maker≠Checker, visual=passed, …) to
 * short headlines plus an optional "To fix: …" line.
 */

export interface TrustReasonForUser {
  readonly headline: string;
  readonly fix?: string;
}

interface TrustCopyRule {
  readonly match: RegExp;
  readonly headline: string;
  readonly fix?: string;
}

const RULES: readonly TrustCopyRule[] = [
  {
    match: /unverified|checks did not run/i,
    headline: 'Checks never ran — this result is unverified.',
    fix: 'To fix: re-run the Job so tests and verification complete before merge.',
  },
  {
    match: /Maker≠Checker|Maker!=Checker|share expertId|independent review/i,
    headline: 'The same worker cannot both build and review this change.',
    fix: 'To fix: wait for (or staff) a separate review Job with a different expert.',
  },
  {
    match: /visual=|VerifySurface|visual proof/i,
    headline: 'UI changes need a real surface check (visual proof missing).',
    fix: 'To fix: re-run the worker and call VerifySurface on the live UI — a screenshot alone is not enough.',
  },
  {
    match: /conflict/i,
    headline: 'There is a merge conflict.',
    fix: 'To fix: resolve the conflict in the worktree, then approve land again.',
  },
  {
    match: /not green|Checks not green|ungreen/i,
    headline: 'Checks are not green yet.',
    fix: 'To fix: make the failing checks pass, then try merge again.',
  },
  {
    match: /review chain|verdict=pass|No review child|review/i,
    headline: 'Independent review has not passed yet.',
    fix: 'To fix: wait for the review Job to finish with a pass, then merge.',
  },
  {
    match: /Dangerous paths/i,
    headline: 'This change touches sensitive paths and needs your confirm.',
    fix: 'To fix: review the listed paths, then confirm land explicitly.',
  },
  {
    match: /Diff too large|Change spans|user confirm required/i,
    headline: 'This change is large enough to need your confirm.',
    fix: 'To fix: review the diff, then confirm land explicitly.',
  },
  {
    match: /Diff summary required/i,
    headline: 'A short diff summary is required before auto-approve.',
    fix: 'To fix: provide a summary, then approve again.',
  },
];

/**
 * Map a raw trust/merge reason string to plain English for the TUI.
 * Unknown reasons fall back to a cleaned headline without a fix line.
 */
export function formatTrustReasonForUser(reason: string): TrustReasonForUser {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return { headline: 'Merge was held by trust rules.' };
  }
  for (const rule of RULES) {
    if (rule.match.test(trimmed)) {
      return rule.fix === undefined
        ? { headline: rule.headline }
        : { headline: rule.headline, fix: rule.fix };
    }
  }
  return { headline: trimmed.replace(/^merge:\s*(reject|hold)\s*—\s*/i, '').trim() || trimmed };
}

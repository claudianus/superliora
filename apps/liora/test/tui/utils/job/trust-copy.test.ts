import { describe, expect, it } from 'vitest';

import { formatTrustReasonForUser } from '#/tui/utils/job/trust-copy';

describe('formatTrustReasonForUser', () => {
  it('maps UNVERIFIED summaries', () => {
    const out = formatTrustReasonForUser('unverified (checks did not run) — shipped UI');
    expect(out.headline).toMatch(/unverified/i);
    expect(out.fix).toMatch(/re-run/i);
  });

  it('maps Maker≠Checker collisions', () => {
    const out = formatTrustReasonForUser(
      'Maker≠Checker hard reject: implement and review share expertId=search.',
    );
    expect(out.headline).toMatch(/same worker/i);
    expect(out.fix).toMatch(/review/i);
  });

  it('maps missing visual=passed', () => {
    const out = formatTrustReasonForUser(
      'UI paths changed without VerifySurface pass (visual=not_run).',
    );
    expect(out.headline).toMatch(/visual proof/i);
    expect(out.fix).toMatch(/VerifySurface/i);
  });

  it('maps conflict and ungreen checks', () => {
    expect(formatTrustReasonForUser('Conflict present — user must resolve and re-approve.').fix)
      .toMatch(/resolve the conflict/i);
    expect(
      formatTrustReasonForUser(
        'Checks not green — never merge on green alone; green is required but not sufficient.',
      ).headline,
    ).toMatch(/not green/i);
  });

  it('maps review-chain holds', () => {
    const out = formatTrustReasonForUser(
      'No review child Job yet — wait for the automatic review chain before MergeJob.',
    );
    expect(out.headline).toMatch(/review/i);
    expect(out.fix).toBeDefined();
  });
});

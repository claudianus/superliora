export type CouncilDecision = 'approve' | 'strong-approve' | 'revise' | 'block' | 'interrupted';

export interface LensVote {
  readonly expertId: string;
  readonly verdict: 'PASS' | 'BLOCKED' | 'FAIL';
  readonly confidence: number;
  readonly rationale: string;
}

/** Minimal review-result shape for consensus — avoids importing the UltraSwarm tool module. */
export interface ReviewResultForVote {
  readonly spec: {
    readonly expertId: string;
    readonly phase: string;
  };
  readonly status: string;
  readonly verdict: string;
  readonly result?: string;
  readonly error?: string;
}

const MIN_HIGH_CONFIDENCE = 0.7;

/**
 * Derive a weighted consensus from review verdicts. Unlike the old rule-based
 * `councilDecisionFromReview` (any FAIL → block), this weights each vote by a
 * confidence heuristic derived from the review text, so a bare FAIL without a
 * concrete cited gap is downweighted relative to a FAIL backed by evidence.
 */
export function consensusFromDiverseVotes(
  votes: readonly LensVote[],
): CouncilDecision {
  if (votes.length === 0) return 'interrupted';

  const weightOf = (vote: LensVote): number => {
    // Confidence is self-reported in [0,1]; fall back to a text-evidence heuristic.
    const base = Number.isFinite(vote.confidence) ? vote.confidence : 0.5;
    const hasConcreteEvidence = /\b(line|file|step|test|gap|missing|broken|fails?|incorrect)\b/i.test(
      vote.rationale,
    );
    return Math.max(0, Math.min(1, base)) * (hasConcreteEvidence ? 1 : 0.6);
  };

  let passWeight = 0;
  let blockWeight = 0;
  let reviseWeight = 0;
  let passCount = 0;
  let failCount = 0;
  let highConfidenceFail = false;

  for (const vote of votes) {
    const w = weightOf(vote);
    if (vote.verdict === 'PASS') {
      passWeight += w;
      passCount += 1;
    } else if (vote.verdict === 'FAIL') {
      blockWeight += w;
      failCount += 1;
      if (w >= MIN_HIGH_CONFIDENCE) highConfidenceFail = true;
    } else {
      reviseWeight += w;
    }
  }

  const total = passWeight + blockWeight + reviseWeight;
  if (total === 0) return 'revise';

  // A single high-confidence FAIL is a safety guard: force at least revise.
  if (highConfidenceFail && passWeight < blockWeight * 2) return 'revise';

  // Weighted majority.
  if (blockWeight > passWeight && blockWeight > reviseWeight) return 'block';
  if (reviseWeight > passWeight) return 'revise';

  // Strong-approve: unanimous PASS with meaningful confidence.
  if (failCount === 0 && passCount === votes.length && passWeight / total > 0.8) {
    return 'strong-approve';
  }
  return 'approve';
}

/**
 * Extract lens votes from rendered review results. Confidence is inferred from
 * the review text length and the presence of concrete evidence markers.
 */
export function extractLensVotes(
  results: readonly ReviewResultForVote[],
): readonly LensVote[] {
  return results
    .filter((result) => result.spec.phase === 'review' && result.status === 'completed')
    .map((result) => {
      const text = result.result ?? result.error ?? '';
      const verdict =
        result.verdict === 'PASS' || result.verdict === 'BLOCKED' || result.verdict === 'FAIL'
          ? result.verdict
          : 'PASS';
      const rationale = text.slice(0, 500);
      const hasEvidence = /\b(line|file|step|test|gap|missing|broken|fails?|incorrect)\b/i.test(text);
      const lengthFactor = Math.min(1, text.length / 400);
      const confidence = hasEvidence ? Math.max(0.6, lengthFactor) : lengthFactor * 0.5;
      return {
        expertId: result.spec.expertId,
        verdict,
        confidence,
        rationale,
      };
    });
}

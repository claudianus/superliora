/**
 * Staffing outcome prior (MVP): in-memory record of expert hire outcomes so
 * later search ranking can lightly boost experts that were accepted and
 * demote ones that wasted tokens or caused conflicts.
 *
 * Pure helpers + module-level store. Not durable across process restarts.
 */

export interface StaffingOutcomeInput {
  /** Hire was kept / accepted into the team. */
  readonly accepted: boolean;
  /** Approximate wasted tokens attributed to this expert (optional). */
  readonly wastedTokens?: number;
  /** Expert produced conflicting / discarded work. */
  readonly conflict?: boolean;
}

export interface StaffingOutcomeRecord {
  readonly expertId: string;
  readonly accepted: number;
  readonly rejected: number;
  readonly conflicts: number;
  readonly wastedTokens: number;
  readonly samples: number;
}

/** In-memory prior store keyed by expertId. */
const outcomeStore = new Map<string, StaffingOutcomeRecord>();

function emptyRecord(expertId: string): StaffingOutcomeRecord {
  return {
    expertId,
    accepted: 0,
    rejected: 0,
    conflicts: 0,
    wastedTokens: 0,
    samples: 0,
  };
}

/**
 * Record one staffing outcome for an expert. Mutates the in-memory store.
 */
export function recordOutcome(expertId: string, outcome: StaffingOutcomeInput): StaffingOutcomeRecord {
  const id = expertId.trim();
  if (id.length === 0) {
    throw new Error('recordOutcome: expertId must be non-empty');
  }
  const prev = outcomeStore.get(id) ?? emptyRecord(id);
  const next: StaffingOutcomeRecord = {
    expertId: id,
    accepted: prev.accepted + (outcome.accepted ? 1 : 0),
    rejected: prev.rejected + (outcome.accepted ? 0 : 1),
    conflicts: prev.conflicts + (outcome.conflict === true ? 1 : 0),
    wastedTokens: prev.wastedTokens + Math.max(0, outcome.wastedTokens ?? 0),
    samples: prev.samples + 1,
  };
  outcomeStore.set(id, next);
  return next;
}

/**
 * Multiplicative score boost for ranking (default 1.0 when no samples).
 *
 * - Accepted rate pulls toward [0.55, 1.55] (wider than the original 0.85–1.25
 *   band so repeated FAIL/PASS verdicts can actually reorder close candidates)
 * - Conflicts pull down harder as they accumulate
 * - Large wastedTokens pull down gently
 * - Confidence scales with sample count (1 sample ≈ half effect, 4+ ≈ full)
 */
export function scoreBoost(expertId: string): number {
  const record = outcomeStore.get(expertId.trim());
  if (record === undefined || record.samples === 0) return 1;

  const acceptRate = record.accepted / record.samples;
  // Map accept rate 0..1 → 0.55..1.55 (full effect before confidence shrink)
  const rawBoost = 0.55 + acceptRate * 1.0;

  let boost = rawBoost;

  if (record.conflicts > 0) {
    boost *= Math.max(0.55, 1 - record.conflicts * 0.12);
  }

  if (record.wastedTokens > 0) {
    // Soft penalty: every 10k wasted tokens ≈ -3%, floor 0.7
    const wastePenalty = Math.min(0.3, (record.wastedTokens / 10_000) * 0.03);
    boost *= 1 - wastePenalty;
  }

  // Shrink toward 1.0 when samples are sparse so one-off noise does not dominate.
  const confidence = Math.min(1, record.samples / 4);
  boost = 1 + (boost - 1) * confidence;

  // Clamp to a sane band so ranking stays stable but still movable.
  return Math.min(1.6, Math.max(0.5, boost));
}

/** Read current prior for tests / diagnostics. */
export function getOutcome(expertId: string): StaffingOutcomeRecord | undefined {
  return outcomeStore.get(expertId.trim());
}

/** Clear all priors (tests). */
export function clearStaffingOutcomes(): void {
  outcomeStore.clear();
}

/** Snapshot of all recorded experts (tests / debug). */
export function listStaffingOutcomes(): readonly StaffingOutcomeRecord[] {
  return [...outcomeStore.values()];
}

/**
 * Map UltraSwarm phase verdicts into staffing priors.
 * - PASS / PASS_WITH_ADVICE → accepted
 * - FAIL / BLOCKED → rejected + conflict
 * - ABORTED / SKIPPED / failed status → rejected with light waste signal
 */
export interface SwarmVerdictOutcomeInput {
  readonly expertId: string;
  readonly verdict: string;
  readonly status?: string;
  /** Optional approximate tokens; default waste when aborted/skipped/failed. */
  readonly wastedTokens?: number;
}

export function recordOutcomesFromSwarmResults(
  results: readonly SwarmVerdictOutcomeInput[],
): readonly StaffingOutcomeRecord[] {
  const out: StaffingOutcomeRecord[] = [];
  for (const result of results) {
    const verdict = result.verdict.toUpperCase();
    const accepted = verdict === 'PASS' || verdict === 'PASS_WITH_ADVICE';
    const conflict = verdict === 'FAIL' || verdict === 'BLOCKED';
    const wasteDefault =
      verdict === 'ABORTED' ||
      verdict === 'SKIPPED' ||
      result.status === 'failed' ||
      result.status === 'aborted'
        ? 1_000
        : 0;
    out.push(
      recordOutcome(result.expertId, {
        accepted,
        conflict,
        wastedTokens: result.wastedTokens ?? wasteDefault,
      }),
    );
  }
  return out;
}


/**
 * Staffing outcome prior: records of expert hire outcomes so later search
 * ranking can lightly boost experts that were accepted and demote ones that
 * wasted tokens or caused conflicts.
 *
 * In-memory store with optional durable JSON persistence (atomic write).
 * Default path: `$SUPERLIORA_HOME/staffing-outcomes.json` (or ~/.superliora/...).
 * Disable with SUPERLIORA_STAFFING_OUTCOMES_PERSIST=0.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'pathe';

import { resolveLioraHome } from '../config/path';
import { writeFileAtomic } from '#/mission';

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

/** On-disk schema (versioned). */
export interface StaffingOutcomeFileV1 {
  readonly schema: 1;
  readonly updatedAt: string;
  readonly records: readonly StaffingOutcomeRecord[];
}

const STAFFING_OUTCOMES_FILENAME = 'staffing-outcomes.json';
const MAX_PERSISTED_EXPERTS = 500;

/** In-memory prior store keyed by expertId. */
const outcomeStore = new Map<string, StaffingOutcomeRecord>();

/** Whether disk was loaded into memory at least once this process. */
let hydratedFromDisk = false;

/** Override path for tests; null = use default; undefined = not overridden. */
let persistPathOverride: string | null | undefined;

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
 * Resolve the durable staffing-outcomes JSON path.
 * - Explicit override (tests) wins
 * - SUPERLIORA_STAFFING_OUTCOMES_PATH env
 * - `$SUPERLIORA_HOME/staffing-outcomes.json`
 */
export function resolveStaffingOutcomesPath(homeDir?: string): string {
  if (persistPathOverride !== undefined && persistPathOverride !== null) {
    return persistPathOverride;
  }
  const fromEnv = process.env['SUPERLIORA_STAFFING_OUTCOMES_PATH']?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return join(resolveLioraHome(homeDir), STAFFING_OUTCOMES_FILENAME);
}

/**
 * Tests: force a custom persist path (or null to disable path override only).
 * Call {@link clearStaffingOutcomes} after to reset memory.
 */
export function setStaffingOutcomesPersistPathForTests(path: string | null): void {
  persistPathOverride = path;
  hydratedFromDisk = false;
}

function persistenceEnabled(): boolean {
  const flag = process.env['SUPERLIORA_STAFFING_OUTCOMES_PERSIST']?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
    return false;
  }
  // Explicit null override means "memory only" for this test process.
  if (persistPathOverride === null) {
    return false;
  }
  // Explicit string path override (tests) always enables when not disabled by env.
  if (typeof persistPathOverride === 'string' && persistPathOverride.length > 0) {
    return true;
  }
  // Vitest default: memory-only so unit tests do not pollute ~/.superliora.
  // Production / explicit SUPERLIORA_STAFFING_OUTCOMES_PERSIST=1 still persists.
  if (process.env['VITEST'] !== undefined && flag !== '1' && flag !== 'true' && flag !== 'on') {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is StaffingOutcomeRecord {
  if (value === null || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['expertId'] === 'string' &&
    typeof r['accepted'] === 'number' &&
    typeof r['rejected'] === 'number' &&
    typeof r['conflicts'] === 'number' &&
    typeof r['wastedTokens'] === 'number' &&
    typeof r['samples'] === 'number'
  );
}

/**
 * Load records from disk into memory (idempotent per process unless path reset).
 * Safe to call repeatedly; no-ops if already hydrated or persistence disabled.
 */
export function hydrateStaffingOutcomesFromDisk(): boolean {
  if (hydratedFromDisk) return false;
  hydratedFromDisk = true;
  if (!persistenceEnabled()) return false;

  const path = resolveStaffingOutcomesPath();
  try {
    if (!existsSync(path)) return false;
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as StaffingOutcomeFileV1;
    if (parsed.schema !== 1 || !Array.isArray(parsed.records)) return false;
    for (const rec of parsed.records) {
      if (!isRecord(rec)) continue;
      const id = rec.expertId.trim();
      if (id.length === 0) continue;
      // Disk is baseline; in-memory wins if already present (shouldn't happen on cold start).
      if (!outcomeStore.has(id)) {
        outcomeStore.set(id, {
          expertId: id,
          accepted: Math.max(0, Math.floor(rec.accepted)),
          rejected: Math.max(0, Math.floor(rec.rejected)),
          conflicts: Math.max(0, Math.floor(rec.conflicts)),
          wastedTokens: Math.max(0, Math.floor(rec.wastedTokens)),
          samples: Math.max(0, Math.floor(rec.samples)),
        });
      }
    }
    return true;
  } catch {
    // Corrupt / unreadable file — keep empty in-memory store; next persist rewrites.
    return false;
  }
}

/**
 * Persist current in-memory priors to disk (atomic). Best-effort; never throws.
 */
export function persistStaffingOutcomesToDisk(): boolean {
  if (!persistenceEnabled()) return false;
  ensureHydrated();
  try {
    const path = resolveStaffingOutcomesPath();
    // Cap size: keep highest-sample experts when over limit.
    const sorted = [...outcomeStore.values()].sort((a, b) => b.samples - a.samples);
    const records = sorted.slice(0, MAX_PERSISTED_EXPERTS);
    const payload: StaffingOutcomeFileV1 = {
      schema: 1,
      updatedAt: new Date().toISOString(),
      records,
    };
    writeFileAtomic(path, `${JSON.stringify(payload, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

function ensureHydrated(): void {
  if (!hydratedFromDisk) {
    hydrateStaffingOutcomesFromDisk();
  }
}

/**
 * Record one staffing outcome for an expert. Mutates the in-memory store
 * and best-effort persists to disk.
 */
export function recordOutcome(expertId: string, outcome: StaffingOutcomeInput): StaffingOutcomeRecord {
  ensureHydrated();
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
  persistStaffingOutcomesToDisk();
  return next;
}

/**
 * Multiplicative score boost for ranking (default 1.0 when no samples).
 *
 * - Accepted rate pulls toward [0.55, 1.55]
 * - Conflicts pull down harder as they accumulate
 * - Large wastedTokens pull down gently
 * - Confidence scales with sample count (1 sample ≈ half effect, 4+ ≈ full)
 */
export function scoreBoost(expertId: string): number {
  ensureHydrated();
  const record = outcomeStore.get(expertId.trim());
  if (record === undefined || record.samples === 0) return 1;

  const acceptRate = record.accepted / record.samples;
  const rawBoost = 0.55 + acceptRate * 1.0;

  let boost = rawBoost;

  if (record.conflicts > 0) {
    boost *= Math.max(0.55, 1 - record.conflicts * 0.12);
  }

  if (record.wastedTokens > 0) {
    const wastePenalty = Math.min(0.3, (record.wastedTokens / 10_000) * 0.03);
    boost *= 1 - wastePenalty;
  }

  const confidence = Math.min(1, record.samples / 4);
  boost = 1 + (boost - 1) * confidence;

  return Math.min(1.6, Math.max(0.5, boost));
}

/** Read current prior for tests / diagnostics. */
export function getOutcome(expertId: string): StaffingOutcomeRecord | undefined {
  ensureHydrated();
  return outcomeStore.get(expertId.trim());
}

/**
 * Clear all priors (tests). Also clears hydrated flag so the next read reloads disk
 * unless {@link setStaffingOutcomesPersistPathForTests} disabled persistence.
 * Does **not** delete the on-disk file.
 */
export function clearStaffingOutcomes(): void {
  outcomeStore.clear();
  hydratedFromDisk = false;
}

/**
 * Clear memory **and** delete the configured on-disk file (tests).
 */
export function resetStaffingOutcomesForTests(): void {
  outcomeStore.clear();
  hydratedFromDisk = false;
  if (!persistenceEnabled()) return;
  try {
    const path = resolveStaffingOutcomesPath();
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // ignore
  }
}

/** Snapshot of all recorded experts (tests / debug). */
export function listStaffingOutcomes(): readonly StaffingOutcomeRecord[] {
  ensureHydrated();
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

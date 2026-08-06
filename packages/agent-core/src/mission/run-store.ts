import { readFileSync } from 'node:fs';
import { join } from 'pathe';

import type { UltraworkRun } from '@superliora/protocol';

import { writeFileAtomicSync } from '../utils/fs';
import type { Agent } from '../agent';
import type { UltraworkActivation, UltraworkRunMirror, UltraworkPlanRecoveryContext } from './types';

const RUN_STATE_FILENAME = 'run-state.json';
const EVIDENCE_ROOT_SEGMENT = '.superliora/evidence/ultrawork-runs';
/** Mirror schema versions a reader accepts (its own and earlier). */
const ACCEPTED_MIRROR_SCHEMAS = new Set([1, 2]);

export function resolveUltraworkRunStatePath(workDir: string, runId: string): string {
  return join(workDir, EVIDENCE_ROOT_SEGMENT, runId, RUN_STATE_FILENAME);
}

export function readUltraworkMirrorFromDisk(
  workDir: string,
  runId: string,
): UltraworkRunMirror | null {
  try {
    const raw = readFileSync(resolveUltraworkRunStatePath(workDir, runId), 'utf8');
    const parsed = JSON.parse(raw) as UltraworkRunMirror;
    if (!ACCEPTED_MIRROR_SCHEMAS.has(parsed.schema) || parsed.run.id !== runId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function mirrorUltraworkRunToDisk(input: {
  readonly workDir: string;
  readonly run: UltraworkRun;
  readonly activation?: UltraworkActivation;
  readonly interruptReason?: string;
  readonly planCheckpoint?: UltraworkPlanRecoveryContext;
  readonly journalOffset?: number;
}): void {
  const targetPath = resolveUltraworkRunStatePath(input.workDir, input.run.id);
  const mirror: UltraworkRunMirror = {
    schema: 2,
    run: input.run,
    activation: input.activation,
    interruptReason: input.interruptReason,
    planCheckpoint: input.planCheckpoint,
    journalOffset: input.journalOffset,
    lastCheckpointAt: new Date().toISOString(),
  };
  writeFileAtomicSync(targetPath, `${JSON.stringify(mirror, null, 2)}\n`);
}

export function checkpointUltraworkRun(
  agent: Agent,
  run: UltraworkRun,
  input: {
    readonly activation?: UltraworkActivation;
    readonly interruptReason?: string;
    readonly workDir?: string;
    readonly flush?: boolean;
    readonly planCheckpoint?: UltraworkPlanRecoveryContext;
    readonly journalOffset?: number;
  } = {},
): void {
  agent.records.logRecord({
    type: 'ultrawork.run',
    run,
    activation: input.activation,
    interruptReason: input.interruptReason,
    time: Date.now(),
  });

  const workDir = input.workDir ?? input.activation?.workDir ?? agent.kaos.getcwd();
  try {
    mirrorUltraworkRunToDisk({
      workDir,
      run,
      activation: input.activation,
      interruptReason: input.interruptReason,
      planCheckpoint: input.planCheckpoint,
      journalOffset: input.journalOffset,
    });
  } catch (error) {
    agent.log.warn('ultrawork run mirror failed', { runId: run.id, error });
  }

  if (input.flush) {
    void agent.records.flush?.();
  }
}

/**
 * Checkpoint staleness threshold (ms). Checkpoints older than this may
 * indicate a stale recovery point that needs re-validation.
 */
const CHECKPOINT_STALE_THRESHOLD_MS = 30 * 60_000; // 30 minutes

export interface CheckpointValidationResult {
  readonly valid: boolean;
  readonly stale: boolean;
  readonly ageMs: number;
  readonly issues: readonly string[];
}

/**
 * Validate a checkpoint mirror for integrity and staleness.
 * Based on LangGraph-style checkpoint validation patterns (2026):
 * verify required fields, timestamp validity, and age threshold.
 */
export function validateCheckpointMirror(
  mirror: UltraworkRunMirror | null,
): CheckpointValidationResult {
  if (mirror === null) {
    return { valid: false, stale: false, ageMs: 0, issues: ['checkpoint is null'] };
  }

  const issues: string[] = [];

  // Validate required fields.
  if (mirror.run.id === undefined || mirror.run.id.length === 0) {
    issues.push('missing run.id');
  }
  if (mirror.run.stage === undefined) {
    issues.push('missing run.stage');
  }
  if (mirror.run.status === undefined) {
    issues.push('missing run.status');
  }
  if (mirror.lastCheckpointAt === undefined) {
    issues.push('missing lastCheckpointAt');
  }

  // Validate timestamp and compute age.
  const checkpointTime = Date.parse(mirror.lastCheckpointAt ?? '');
  const ageMs = Number.isFinite(checkpointTime) ? Date.now() - checkpointTime : 0;
  if (!Number.isFinite(checkpointTime)) {
    issues.push('invalid lastCheckpointAt timestamp');
  }

  // Check for staleness.
  const stale = ageMs > CHECKPOINT_STALE_THRESHOLD_MS;
  if (stale) {
    issues.push(`checkpoint is stale (age ${String(Math.round(ageMs / 60_000))}min > ${String(CHECKPOINT_STALE_THRESHOLD_MS / 60_000)}min threshold)`);
  }

  return {
    valid: issues.length === 0,
    stale,
    ageMs,
    issues,
  };
}

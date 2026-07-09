import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'pathe';

import type { UltraworkRun } from '@superliora/protocol';

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

/**
 * Synchronously write the mirror atomically and durably: stage a uniquely-
 * named temp file, fsync it, rename it into place, then fsync the parent
 * directory. A crash mid-write can no longer leave `run-state.json` truncated
 * (the previous `writeFileSync` to the target path could).
 */
function writeMirrorAtomic(targetPath: string, content: string): void {
  const directory = dirname(targetPath);
  mkdirSync(directory, { recursive: true });
  const hex = randomBytes(4).toString('hex');
  const tmpPath = `${targetPath}.tmp.${process.pid}.${hex}`;
  let renamed = false;
  try {
    const fd = openSync(tmpPath, 'w');
    try {
      writeFileSync(fd, content, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, targetPath);
    renamed = true;
    // Commit the directory entry so the rename survives a power loss.
    if (process.platform !== 'win32') {
      const dirFd = openSync(directory, 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } finally {
    if (!renamed) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore — temp may not exist if open itself failed
      }
    }
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
  writeMirrorAtomic(targetPath, `${JSON.stringify(mirror, null, 2)}\n`);
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

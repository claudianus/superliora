import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';

import type { UltraworkRun } from '@superliora/protocol';

import type { Agent } from '../agent';
import type { UltraworkActivation, UltraworkRunMirror } from './types';

const RUN_STATE_FILENAME = 'run-state.json';
const EVIDENCE_ROOT_SEGMENT = '.superliora/evidence/ultrawork-runs';

export function resolveUltraworkRunStatePath(workDir: string, runId: string): string {
  return join(workDir, EVIDENCE_ROOT_SEGMENT, runId, RUN_STATE_FILENAME);
}

export function mirrorUltraworkRunToDisk(input: {
  readonly workDir: string;
  readonly run: UltraworkRun;
  readonly activation?: UltraworkActivation;
  readonly interruptReason?: string;
}): void {
  const directory = join(input.workDir, EVIDENCE_ROOT_SEGMENT, input.run.id);
  mkdirSync(directory, { recursive: true });
  const mirror: UltraworkRunMirror = {
    schema: 1,
    run: input.run,
    activation: input.activation,
    interruptReason: input.interruptReason,
    lastCheckpointAt: new Date().toISOString(),
  };
  writeFileSync(join(directory, RUN_STATE_FILENAME), `${JSON.stringify(mirror, null, 2)}\n`, 'utf8');
}

export function checkpointUltraworkRun(
  agent: Agent,
  run: UltraworkRun,
  input: {
    readonly activation?: UltraworkActivation;
    readonly interruptReason?: string;
    readonly workDir?: string;
    readonly flush?: boolean;
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
    });
  } catch (error) {
    agent.log.warn('ultrawork run mirror failed', { runId: run.id, error });
  }

  if (input.flush) {
    void agent.records.flush?.();
  }
}

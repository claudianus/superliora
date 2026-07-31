/**
 * Mission resume grade — synthetic pause→resume→complete without LLM.
 * Grades run-store checkpoint contract + optional MISSION.md presence.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UltraworkRun, UltraworkStage } from '@superliora/protocol';

import {
  ULTRAWORK_STAGE_ORDER,
  UltraworkRunStateMachine,
} from './state';
import {
  mirrorUltraworkRunToDisk,
  readUltraworkMirrorFromDisk,
  resolveUltraworkRunStatePath,
  validateCheckpointMirror,
} from './run-store';

/** Default pause stage for the green-path smoke (post-plan execution). */
export const MISSION_RESUME_SMOKE_PAUSE_STAGE: UltraworkStage = 'goal';

export interface MissionResumeSmokeOptions {
  readonly workDir?: string;
  /** When true (default), seed MISSION.md under workDir. */
  readonly withMissionMd?: boolean;
  readonly pauseAtStage?: UltraworkStage;
}

export interface MissionResumeSmokeGradeResult {
  readonly ok: boolean;
  readonly pauseStage: string;
  readonly resumeStage: string;
  readonly finalStatus: string;
  readonly checkpointValid: boolean;
  readonly missionMdPresent: boolean;
  readonly detail: string;
}

function advanceToStage(
  machine: UltraworkRunStateMachine,
  targetStage: UltraworkStage,
  now: string,
): UltraworkRun {
  const targetIndex = ULTRAWORK_STAGE_ORDER.indexOf(targetStage);
  let run = machine.snapshot();
  for (let i = 1; i <= targetIndex; i++) {
    const stage = ULTRAWORK_STAGE_ORDER[i]!;
    run = machine.advance(stage, `synthetic advance to ${stage}`, now);
  }
  return run;
}

function advanceFromStageToDone(
  machine: UltraworkRunStateMachine,
  fromStage: UltraworkStage,
  now: string,
): UltraworkRun {
  const startIndex = ULTRAWORK_STAGE_ORDER.indexOf(fromStage);
  let run = machine.snapshot();
  for (let i = startIndex + 1; i < ULTRAWORK_STAGE_ORDER.length; i++) {
    const stage = ULTRAWORK_STAGE_ORDER[i]!;
    run = machine.advance(stage, `synthetic complete to ${stage}`, now);
  }
  return run;
}

function assertRunStateMirrorContract(workDir: string, runId: string): string | undefined {
  const statePath = resolveUltraworkRunStatePath(workDir, runId);
  if (!existsSync(statePath)) {
    return 'run-state.json missing';
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as {
      schema?: unknown;
      run?: { id?: string };
      interruptReason?: unknown;
    };
    if (parsed.schema !== 2) {
      return `run-state schema expected 2, got ${String(parsed.schema)}`;
    }
    if (parsed.run?.id !== runId) {
      return 'run-state run.id mismatch';
    }
    if (typeof parsed.interruptReason !== 'string' || parsed.interruptReason.length === 0) {
      return 'run-state interruptReason missing after pause';
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

/** Grade synthetic mission pause→checkpoint→resume→complete lifecycle. */
export function gradeMissionResumeSmoke(
  options?: MissionResumeSmokeOptions,
): MissionResumeSmokeGradeResult {
  const pauseAtStage = options?.pauseAtStage ?? MISSION_RESUME_SMOKE_PAUSE_STAGE;
  const withMissionMd = options?.withMissionMd !== false;
  const ownsWorkDir = options?.workDir === undefined;
  const workDir = options?.workDir ?? mkdtempSync(join(tmpdir(), 'mission-resume-smoke-'));

  try {
    const now = '2026-07-31T12:00:00.000Z';
    const runId = 'mission-resume-smoke-run';

    if (withMissionMd) {
      writeFileSync(
        join(workDir, 'MISSION.md'),
        '# Mission Resume Smoke\n\nObjective: verify pause→resume→complete.\n',
        'utf8',
      );
    }

    let machine = UltraworkRunStateMachine.create({
      id: runId,
      objective: 'Synthetic mission resume smoke',
      now,
    });
    const runAtPause = advanceToStage(machine, pauseAtStage, now);

    machine = new UltraworkRunStateMachine(runAtPause);
    const paused = machine.markBlocked('Synthetic pause for resume smoke');
    const pauseStage = paused.stage;

    mirrorUltraworkRunToDisk({
      workDir,
      run: paused,
      interruptReason: 'Synthetic pause for resume smoke',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: `.superliora/evidence/ultrawork-runs/${runId}`,
        workDir,
      },
    });

    const mirror = readUltraworkMirrorFromDisk(workDir, runId);
    const validation = validateCheckpointMirror(mirror);
    const missionMdPresent = existsSync(join(workDir, 'MISSION.md'));

    if (!validation.valid) {
      return {
        ok: false,
        pauseStage,
        resumeStage: '',
        finalStatus: paused.status,
        checkpointValid: false,
        missionMdPresent,
        detail: `checkpoint invalid: ${validation.issues.join(', ')}`,
      };
    }

    const contractIssue = assertRunStateMirrorContract(workDir, runId);
    if (contractIssue !== undefined) {
      return {
        ok: false,
        pauseStage,
        resumeStage: '',
        finalStatus: paused.status,
        checkpointValid: true,
        missionMdPresent,
        detail: contractIssue,
      };
    }

    machine = new UltraworkRunStateMachine(paused);
    const resumed = machine.resumeFromBlocked(now);
    const resumeStage = resumed.stage;

    machine = new UltraworkRunStateMachine(resumed);
    const finalRun = advanceFromStageToDone(machine, pauseAtStage, now);

    const meetsMissionMdContract = !withMissionMd || missionMdPresent;
    const ok =
      validation.valid &&
      finalRun.status === 'done' &&
      finalRun.stage === 'done' &&
      meetsMissionMdContract;

    const detail = ok
      ? `pause@${pauseStage} → resume@${resumeStage} → done · checkpoint valid · ${missionMdPresent ? 'MISSION.md ok' : 'no MISSION.md'} — smoke passed`
      : `incomplete lifecycle: status=${finalRun.status} stage=${finalRun.stage}`;

    return {
      ok,
      pauseStage,
      resumeStage,
      finalStatus: finalRun.status,
      checkpointValid: validation.valid,
      missionMdPresent,
      detail,
    };
  } finally {
    if (ownsWorkDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

/** Simulate the W5 green-path mission resume smoke (defaults: pause at goal, MISSION.md seeded). */
export function simulateMissionResumeSmoke(
  options?: MissionResumeSmokeOptions,
): MissionResumeSmokeGradeResult {
  return gradeMissionResumeSmoke(options);
}

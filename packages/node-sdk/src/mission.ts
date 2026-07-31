/**
 * Mission facade aliases — mirrors agent-core `#/mission` soft path (W5).
 * Canonical wire types remain `ultrawork.*` until hard rename.
 */
export {
  MissionRunStateMachine,
  buildMissionRecoveryPrompt,
  maybeAdvanceMissionStage,
  maybeFinishMissionRun,
  MISSION_STAGE_ORDER,
  dualEmitMissionUltraworkAlias,
  isMissionDualEmitEnabled,
  maybeEmitMissionUltraworkAliasLive,
  missionDualEmitStatusLine,
  MISSION_DUAL_EMIT_ENV,
  seedUltraworkWorkflowReport,
  MISSION_RESUME_SMOKE_PAUSE_STAGE,
  gradeMissionResumeSmoke,
  simulateMissionResumeSmoke,
} from '@superliora/agent-core/mission';
export type {
  MissionResumeSmokeGradeResult,
  MissionResumeSmokeOptions,
} from '@superliora/agent-core/mission';

export type { CreateMissionStateMachineInput } from '@superliora/agent-core/mission';

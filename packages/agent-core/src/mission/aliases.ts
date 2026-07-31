/**
 * Mission-named aliases for high-traffic ultrawork helpers.
 */
export { UltraworkRunStateMachine as MissionRunStateMachine } from './state';
export {
  buildUltraworkRecoveryPrompt as buildMissionRecoveryPrompt,
  maybeAdvanceUltraworkStage as maybeAdvanceMissionStage,
  maybeFinishUltraworkRun as maybeFinishMissionRun,
} from './recovery';

export { ULTRAWORK_STAGE_ORDER as MISSION_STAGE_ORDER } from './state';

export type { CreateUltraworkStateMachineInput as CreateMissionStateMachineInput } from './state';

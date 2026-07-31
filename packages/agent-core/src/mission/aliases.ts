/**
 * Mission-named aliases for high-traffic ultrawork helpers.
 * Implementation stays in ../ultrawork until hard rename (W5 soft path).
 */
export {
  UltraworkRunStateMachine as MissionRunStateMachine,
  buildUltraworkRecoveryPrompt as buildMissionRecoveryPrompt,
  maybeAdvanceUltraworkStage as maybeAdvanceMissionStage,
  maybeFinishUltraworkRun as maybeFinishMissionRun,
} from '../ultrawork/index.ts';

export { ULTRAWORK_STAGE_ORDER as MISSION_STAGE_ORDER } from '../ultrawork/state';

export type { CreateUltraworkStateMachineInput as CreateMissionStateMachineInput } from '../ultrawork/state';

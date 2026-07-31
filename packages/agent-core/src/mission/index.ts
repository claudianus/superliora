/**
 * Mission facade — ultrawork implementation lives in ../ultrawork until hard rename.
 *
 * Protocol soft path (2026-07): wire still emits canonical `ultrawork.*` events.
 * Consumers normalize `mission.*` / `fleet.*` aliases on read via
 * `normalizeMissionOrFleetUltraworkEventAlias` (protocol parse + TUI handler).
 * Optional live-only dual emit: `maybeEmitMissionUltraworkAliasLive` when
 * `SUPERLIORA_MISSION_DUAL_EMIT=1` or `SUPERLIORA_SOVEREIGN=1` — Agent wires this; journal stays canonical.
 */
export * from '../ultrawork/index.ts';
export { formatEvidenceHardGateNextActions } from '../ultrawork/recovery-prompt';
/** Work-graph store — light path; avoids ultrawork-graph tool + .md imports. */
export { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph-store-key';
export {
  cloneWorkGraph,
  todosFromWorkGraph,
} from '../tools/builtin/state/ultrawork-graph-helpers';
export * from './event-alias';
export * from './aliases';
export {
  MISSION_RESUME_SMOKE_PAUSE_STAGE,
  gradeMissionResumeSmoke,
  simulateMissionResumeSmoke,
} from '../ultrawork/mission-resume-grade';
export type {
  MissionResumeSmokeGradeResult,
  MissionResumeSmokeOptions,
} from '../ultrawork/mission-resume-grade';

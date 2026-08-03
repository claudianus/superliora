/**
 * Fleet facade — swarm/collaboration orchestration modules live in this directory.
 *
 * Canonical wire types remain `ultrawork.collaboration.*` / `ultrawork.swarm.*`.
 * Read-path soft aliases: `fleet.*` and `mission.*` normalize via
 * `normalizeMissionOrFleetUltraworkEventAlias` in `@superliora/protocol`.
 * Optional live-only dual emit: `maybeEmitFleetUltraworkAliasLive` when
 * `SUPERLIORA_FLEET_DUAL_EMIT=1` or `SUPERLIORA_SOVEREIGN=1` — Agent wires this; journal stays canonical.
 */
export * from './event-alias';
export {
  FLEET_EVENT_PREFIX,
  FLEET_ULTRAWORK_EVENT_SUFFIXES,
  fleetUltraworkEventAlias,
  isFleetUltraworkEventType,
  isUltraworkOrFleetEventType,
  normalizeFleetUltraworkEventAlias,
  normalizeMissionOrFleetUltraworkEventAlias,
  ultraworkFleetEventAlias,
  type FleetUltraworkEventSuffix,
} from '@superliora/protocol';

export * from './spawn-agents';
export * from './swarm-budget';
export * from './swarm-dag-scheduler';
export * from './swarm-evidence-gate';
export * from './swarm-file-lease';
export * from './swarm-humanize';
export * from './swarm-run-ledger';
export * from './fleet-worktree';
export * from './swarm-maker-checker';
export * from './swarm-cost-guard';
/** Swarm work-node store access — same light path as #/mission. */
export { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph-store-key';
export {
  cloneWorkGraph,
  todosFromWorkGraph,
} from '../tools/builtin/state/ultrawork-graph-helpers';

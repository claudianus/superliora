/**
 * Fleet facade — swarm/collaboration implementation lives in ../collaboration until hard rename.
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

export * from '../collaboration/spawn-agents';
export * from '../collaboration/swarm-budget';
export * from '../collaboration/swarm-bus-coordination';
export * from '../collaboration/swarm-dag-scheduler';
export * from '../collaboration/swarm-evidence-gate';
export * from '../collaboration/swarm-file-lease';
export * from '../collaboration/swarm-humanize';
export * from '../collaboration/swarm-run-ledger';
export * from '../collaboration/fleet-worktree';
export * from '../collaboration/swarm-maker-checker';
export * from '../collaboration/swarm-cost-guard';
/** Swarm work-node store access — same light path as #/mission. */
export { ULTRAWORK_GRAPH_STORE_KEY } from '../tools/builtin/state/ultrawork-graph-store-key';
export {
  cloneWorkGraph,
  todosFromWorkGraph,
} from '../tools/builtin/state/ultrawork-graph-helpers';

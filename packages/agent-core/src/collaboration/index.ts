/**
 * Compatibility shim — canonical modules live in ../fleet/.
 * `#/collaboration` and `@superliora/agent-core/collaboration` resolve via package.json to ../fleet/index.ts;
 * this barrel preserves deep-import paths under src/collaboration/.
 */
export * from '../fleet/spawn-agents';
export * from '../fleet/swarm-budget';
export * from '../fleet/swarm-bus-coordination';
export * from '../fleet/swarm-dag-scheduler';
export * from '../fleet/swarm-evidence-gate';
export * from '../fleet/swarm-file-lease';
export * from '../fleet/swarm-humanize';
export * from '../fleet/swarm-run-ledger';
export * from '../fleet/fleet-worktree';
export * from '../fleet/swarm-maker-checker';
export * from '../fleet/swarm-cost-guard';

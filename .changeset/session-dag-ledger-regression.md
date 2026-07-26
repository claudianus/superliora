---
'@superliora/agent-core': patch
---

test(agent-core): pin session/swarm-dag-scheduler.ts and swarm-run-ledger.ts regression cases

- `swarm-dag-scheduler.ts` — pins `SWARM_DAG_DONE_STATUSES` (`done`/`succeeded`) and `SWARM_DAG_TERMINAL_STATUSES` (incl. `needs_integration`); `readyNodeIds` (terminal + running skip, unknown-dep unsatisfied, input-order stability, queued deps block); `areDependenciesSatisfied` (no-deps short-circuit, missing/wrong-status failure); `partitionReadyWorkNodeIds` (ready/blocked split on queued deps); `preferReadyWorkNodeIds` (no-starvation fallback to bound list); `rebindPhaseWorkNodeIds` (empty-input passthrough, all-ready no-op, empty-spec assignment, prune-then-assign with leftover free ready nodes).
- `swarm-run-ledger.ts` — pins `isWastedWorker` (failed/aborted status, FAIL/ABORTED verdict, completed-no-evidence + SKIPPED/undefined, completed-with-evidence not wasted, REVISE-with-evidence not wasted); `createSwarmRunLedger` (derives phases/evidenceIds/wastedWorkerFlags, honors explicit overrides); `finalizeSwarmRunLedger` (auto `finishedAt`, patch overrides, evidence derivation when patch omits); `expertsFromSwarmResults` projection + wasted flag; `buildSwarmRunLedgerFromResults` fold (runId/startedAt/finishedAt/tokens/conflicts); `swarmRunLedgerRelativePath` (path sanitization, `SWARM_RUN_LEDGER_DIR` constant), `swarmRunLedgerAbsolutePath` join, and `serializeSwarmRunLedger` pretty JSON with trailing newline.

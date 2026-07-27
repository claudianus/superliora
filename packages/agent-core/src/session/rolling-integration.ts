import type { Kaos } from '@superliora/kaos';

import { checkPackageTypecheck } from './contract-check';
import type { ContractCheckOutcome } from './contract-check';

export type RollingIntegrationStatus = 'pending' | 'passed' | 'failed';

export interface RollingIntegrationState {
  /** Subagent completions recorded for this fan-out run. */
  completedCount: number;
  /** Total files changed across those completions. */
  changedFileCount: number;
  /** Package typechecks actually executed (skips not counted). */
  checkCount: number;
  lastStatus: RollingIntegrationStatus;
  lastOutcome: ContractCheckOutcome | undefined;
  /** True when a completion changed files after the last executed check. */
  changedSinceLastCheck: boolean;
  inflight: Promise<RollingIntegrationState> | undefined;
}

const WARNING_OUTPUT_PREVIEW_CHARS = 1_200;

const registry = new Map<string, RollingIntegrationState>();

function ensureState(runId: string): RollingIntegrationState {
  let state = registry.get(runId);
  if (state === undefined) {
    state = {
      completedCount: 0,
      changedFileCount: 0,
      checkCount: 0,
      lastStatus: 'pending',
      lastOutcome: undefined,
      changedSinceLastCheck: false,
      inflight: undefined,
    };
    registry.set(runId, state);
  }
  return state;
}

/**
 * Rolling parent integration check (harness reform T3-3d): every subagent
 * completion in a fan-out run is recorded here; when a completion changed
 * files, `maybeRunRollingCheck` re-typechecks the parent package so
 * cross-agent type leaks are caught incrementally, not at the final gate.
 */
export function recordChildCompletion(
  runId: string,
  filesChanged: readonly string[],
): void {
  const state = ensureState(runId);
  state.completedCount += 1;
  if (filesChanged.length > 0) {
    state.changedFileCount += filesChanged.length;
    state.changedSinceLastCheck = true;
  }
}

/**
 * Runs the parent package typecheck when changes accrued since the last
 * check. Concurrent callers share one in-flight check; a check that finds
 * no pending changes is a no-op. Infrastructure failures are treated as
 * passes so a broken checker never blocks completions.
 */
export function maybeRunRollingCheck(
  runId: string,
  kaos: Kaos,
  baseDir: string,
): Promise<RollingIntegrationState> | undefined {
  const state = registry.get(runId);
  if (state === undefined || !state.changedSinceLastCheck) return undefined;
  if (state.inflight !== undefined) return state.inflight;
  state.lastStatus = 'pending';
  const run = (async (): Promise<RollingIntegrationState> => {
    try {
      const outcome = await checkPackageTypecheck(kaos, baseDir);
      state.lastOutcome = outcome;
      state.lastStatus = outcome.ok ? 'passed' : 'failed';
      state.checkCount += 1;
      state.changedSinceLastCheck = false;
    } catch {
      state.lastStatus = 'passed';
      state.lastOutcome = undefined;
    } finally {
      state.inflight = undefined;
    }
    return state;
  })();
  state.inflight = run;
  return run;
}

export function getRollingIntegration(
  runId: string,
): RollingIntegrationState | undefined {
  return registry.get(runId);
}

export function clearRollingIntegration(runId: string): void {
  registry.delete(runId);
}

/**
 * Formats the final failed-check warning for the fan-out run's tool result
 * and clears the run state. Returns undefined when the run never failed a
 * check (or never ran one).
 */
export function takeRollingIntegrationWarning(runId: string): string | undefined {
  const state = registry.get(runId);
  if (state === undefined) return undefined;
  const outcome = state.lastOutcome;
  const failed =
    state.lastStatus === 'failed' && outcome !== undefined && outcome.ok === false;
  clearRollingIntegration(runId);
  if (!failed || outcome === undefined || outcome.ok) return undefined;
  const preview =
    outcome.output !== undefined && outcome.output.length > 0
      ? `\nFirst errors:\n${outcome.output.slice(0, WARNING_OUTPUT_PREVIEW_CHARS)}`
      : '';
  return (
    `rolling_integration: WARNING — the parent package typecheck failed after ` +
    `${String(state.completedCount)} subagent completion(s) ` +
    `(${outcome.kind}, ${String(state.checkCount)} check(s) run). Later completions ` +
    `may inherit this breakage; fix the integration surface before trusting ` +
    `remaining results.${preview}`
  );
}

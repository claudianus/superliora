/**
 * Budget governor (Phase 4 light): track rounds without high-signal progress
 * and suggest kill when wasted rounds exceed a threshold.
 *
 * Pure helpers — callers decide whether to actually abort the swarm.
 *
 * High-signal progress (not wasted):
 * - non-empty evidenceIds, OR
 * - non-empty artifactIds, OR
 * - fileChangeCount > 0, OR
 * - toolSuccessCount > 0
 *
 * `productive: true` alone is **not** enough (prevents gaming the governor).
 * Explicit `wasted: true` always counts as wasted.
 */

export const DEFAULT_WASTED_ROUNDS_KILL_THRESHOLD = 2;

export interface SwarmBudgetRoundInput {
  /** Optional phase / wave label for diagnostics. */
  readonly label?: string;
  /** Evidence ids produced in this round (empty = no evidence). */
  readonly evidenceIds?: readonly string[];
  /** Artifact ids / paths produced this round. */
  readonly artifactIds?: readonly string[];
  /** Number of file edits/writes attributed to this round. */
  readonly fileChangeCount?: number;
  /** Successful tool calls attributed to this round. */
  readonly toolSuccessCount?: number;
  /** Explicit wasted flag from ledger/worker result. */
  readonly wasted?: boolean;
  /**
   * Soft hint that the round was useful. Alone does **not** clear waste;
   * combine with evidence/artifact/file/tool signals.
   */
  readonly productive?: boolean;
}

export interface SwarmBudgetState {
  readonly rounds: number;
  readonly wastedRounds: number;
  /** Consecutive wasted rounds ending at the latest record. */
  readonly consecutiveWastedRounds: number;
  readonly evidenceCount: number;
  readonly killThreshold: number;
  readonly lastRoundLabel?: string;
  readonly history: readonly SwarmBudgetRoundRecord[];
}

export interface SwarmBudgetRoundRecord {
  readonly label?: string;
  readonly wasted: boolean;
  readonly evidenceCount: number;
  readonly artifactCount: number;
  readonly fileChangeCount: number;
  readonly toolSuccessCount: number;
}

export interface SwarmBudgetSuggestion {
  /** True when wastedRounds or consecutiveWastedRounds >= killThreshold. */
  readonly shouldKill: boolean;
  readonly wastedRounds: number;
  readonly consecutiveWastedRounds: number;
  readonly killThreshold: number;
  readonly reason: string;
}

export interface CreateSwarmBudgetStateOptions {
  readonly killThreshold?: number;
}

/**
 * Create an empty budget tracker.
 */
export function createSwarmBudgetState(
  options: CreateSwarmBudgetStateOptions = {},
): SwarmBudgetState {
  const killThreshold = options.killThreshold ?? DEFAULT_WASTED_ROUNDS_KILL_THRESHOLD;
  return {
    rounds: 0,
    wastedRounds: 0,
    consecutiveWastedRounds: 0,
    evidenceCount: 0,
    killThreshold: Math.max(1, killThreshold),
    history: [],
  };
}

function nonEmptyIds(ids: readonly string[] | undefined): readonly string[] {
  return (ids ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
}

/**
 * True when the round has a high-signal artifact of progress.
 */
export function hasHighSignalBudgetProgress(input: SwarmBudgetRoundInput): boolean {
  if (nonEmptyIds(input.evidenceIds).length > 0) return true;
  if (nonEmptyIds(input.artifactIds).length > 0) return true;
  if ((input.fileChangeCount ?? 0) > 0) return true;
  if ((input.toolSuccessCount ?? 0) > 0) return true;
  return false;
}

/**
 * Decide whether a single round is wasted.
 * - explicit wasted → true
 * - high-signal progress → false
 * - bare productive without signal → true (gaming blocked)
 * - empty progress → true
 */
export function isWastedBudgetRound(input: SwarmBudgetRoundInput): boolean {
  if (input.wasted === true) return true;
  if (hasHighSignalBudgetProgress(input)) return false;
  return true;
}

/**
 * Record one aggregation round and return the next immutable state.
 */
export function recordSwarmBudgetRound(
  state: SwarmBudgetState,
  input: SwarmBudgetRoundInput,
): SwarmBudgetState {
  const evidence = nonEmptyIds(input.evidenceIds);
  const artifacts = nonEmptyIds(input.artifactIds);
  const fileChangeCount = Math.max(0, input.fileChangeCount ?? 0);
  const toolSuccessCount = Math.max(0, input.toolSuccessCount ?? 0);
  const wasted = isWastedBudgetRound(input);
  const record: SwarmBudgetRoundRecord = {
    label: input.label,
    wasted,
    evidenceCount: evidence.length,
    artifactCount: artifacts.length,
    fileChangeCount,
    toolSuccessCount,
  };
  return {
    rounds: state.rounds + 1,
    wastedRounds: state.wastedRounds + (wasted ? 1 : 0),
    consecutiveWastedRounds: wasted ? state.consecutiveWastedRounds + 1 : 0,
    evidenceCount: state.evidenceCount + evidence.length,
    killThreshold: state.killThreshold,
    lastRoundLabel: input.label ?? state.lastRoundLabel,
    history: [...state.history, record],
  };
}

/**
 * Suggest killing the run when total or consecutive wasted rounds hit threshold.
 */
export function suggestSwarmBudgetKill(state: SwarmBudgetState): SwarmBudgetSuggestion {
  const byTotal = state.wastedRounds >= state.killThreshold;
  const byConsecutive = state.consecutiveWastedRounds >= state.killThreshold;
  const shouldKill = byTotal || byConsecutive;
  if (!shouldKill) {
    return {
      shouldKill: false,
      wastedRounds: state.wastedRounds,
      consecutiveWastedRounds: state.consecutiveWastedRounds,
      killThreshold: state.killThreshold,
      reason:
        `wasted rounds ${String(state.wastedRounds)}/${String(state.killThreshold)} ` +
        `(consecutive ${String(state.consecutiveWastedRounds)}) — continue`,
    };
  }
  const label = state.lastRoundLabel !== undefined ? ` (last: ${state.lastRoundLabel})` : '';
  const mode = byConsecutive
    ? `${String(state.consecutiveWastedRounds)} consecutive rounds without high-signal progress`
    : `${String(state.wastedRounds)} rounds without high-signal progress`;
  return {
    shouldKill: true,
    wastedRounds: state.wastedRounds,
    consecutiveWastedRounds: state.consecutiveWastedRounds,
    killThreshold: state.killThreshold,
    reason:
      `Budget governor: ${mode}` +
      `${label} >= threshold ${String(state.killThreshold)}. Suggest kill.`,
  };
}

/**
 * Convenience: fold many round inputs into a final suggestion.
 */
export function evaluateSwarmBudget(
  inputs: readonly SwarmBudgetRoundInput[],
  options: CreateSwarmBudgetStateOptions = {},
): { readonly state: SwarmBudgetState; readonly suggestion: SwarmBudgetSuggestion } {
  let state = createSwarmBudgetState(options);
  for (const input of inputs) {
    state = recordSwarmBudgetRound(state, input);
  }
  return { state, suggestion: suggestSwarmBudgetKill(state) };
}

/**
 * Budget governor (Phase 4 light): track rounds without evidence and suggest kill
 * when wasted rounds exceed a threshold.
 *
 * Pure helpers — callers decide whether to actually abort the swarm.
 */

export const DEFAULT_WASTED_ROUNDS_KILL_THRESHOLD = 2;

export interface SwarmBudgetRoundInput {
  /** Optional phase / wave label for diagnostics. */
  readonly label?: string;
  /** Evidence ids produced in this round (empty = no evidence). */
  readonly evidenceIds?: readonly string[];
  /** Explicit wasted flag from ledger/worker result. */
  readonly wasted?: boolean;
  /** When true, this round counts as productive even without evidence. */
  readonly productive?: boolean;
}

export interface SwarmBudgetState {
  readonly rounds: number;
  readonly wastedRounds: number;
  readonly evidenceCount: number;
  readonly killThreshold: number;
  readonly lastRoundLabel?: string;
  readonly history: readonly SwarmBudgetRoundRecord[];
}

export interface SwarmBudgetRoundRecord {
  readonly label?: string;
  readonly wasted: boolean;
  readonly evidenceCount: number;
}

export interface SwarmBudgetSuggestion {
  /** True when wastedRounds >= killThreshold. */
  readonly shouldKill: boolean;
  readonly wastedRounds: number;
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
    evidenceCount: 0,
    killThreshold: Math.max(1, killThreshold),
    history: [],
  };
}

/**
 * Decide whether a single round is wasted (no evidence and not marked productive).
 */
export function isWastedBudgetRound(input: SwarmBudgetRoundInput): boolean {
  if (input.productive === true) return false;
  if (input.wasted === true) return true;
  const evidence = (input.evidenceIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
  return evidence.length === 0;
}

/**
 * Record one aggregation round and return the next immutable state.
 */
export function recordSwarmBudgetRound(
  state: SwarmBudgetState,
  input: SwarmBudgetRoundInput,
): SwarmBudgetState {
  const evidence = (input.evidenceIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
  const wasted = isWastedBudgetRound(input);
  const record: SwarmBudgetRoundRecord = {
    label: input.label,
    wasted,
    evidenceCount: evidence.length,
  };
  return {
    rounds: state.rounds + 1,
    wastedRounds: state.wastedRounds + (wasted ? 1 : 0),
    evidenceCount: state.evidenceCount + evidence.length,
    killThreshold: state.killThreshold,
    lastRoundLabel: input.label ?? state.lastRoundLabel,
    history: [...state.history, record],
  };
}

/**
 * Suggest killing the run when consecutive/total wasted rounds hit the threshold.
 * Uses total wasted rounds (not only consecutive) for a simple first governor.
 */
export function suggestSwarmBudgetKill(state: SwarmBudgetState): SwarmBudgetSuggestion {
  const shouldKill = state.wastedRounds >= state.killThreshold;
  if (!shouldKill) {
    return {
      shouldKill: false,
      wastedRounds: state.wastedRounds,
      killThreshold: state.killThreshold,
      reason: `wasted rounds ${String(state.wastedRounds)}/${String(state.killThreshold)} — continue`,
    };
  }
  const label = state.lastRoundLabel !== undefined ? ` (last: ${state.lastRoundLabel})` : '';
  return {
    shouldKill: true,
    wastedRounds: state.wastedRounds,
    killThreshold: state.killThreshold,
    reason:
      `Budget governor: ${String(state.wastedRounds)} rounds without evidence` +
      `${label} >= threshold ${String(state.killThreshold)}. Suggest kill.`,
  };
}

/**
 * Convenience: fold many round inputs into a final suggestion.
 */
export function evaluateSwarmBudget(
  rounds: readonly SwarmBudgetRoundInput[],
  options: CreateSwarmBudgetStateOptions = {},
): { readonly state: SwarmBudgetState; readonly suggestion: SwarmBudgetSuggestion } {
  let state = createSwarmBudgetState(options);
  for (const round of rounds) {
    state = recordSwarmBudgetRound(state, round);
  }
  return { state, suggestion: suggestSwarmBudgetKill(state) };
}

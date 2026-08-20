/**
 * Tool-call guardrails: failure tracking, circuit breakers, idempotency,
 * repetition detection, and side-effect helpers.
 *
 * All mutable state lives on {@link ToolGuardState}, which the host owns and
 * threads through the loop. It must never be module-level: a single process
 * runs the main agent, its subagents, and (in the server) several sessions at
 * once, and they would otherwise share doom-loop counts, mutation idempotency,
 * and circuit state — one turn's reset wiping another's guards mid-flight.
 */

import { createHash } from 'node:crypto';

import type { Logger } from '#/logging/types';
import type { ToolArgsValidator } from '../tools/args-validator';
import { isUserCancellation } from '../utils/abort';
import type { ToolResourceAccess } from './tool-access';
import type { ExecutableTool } from './types';

/**
 * Consecutive tool failure threshold. When the same tool fails this many
 * times in a row within a single turn, log a warning. Addresses the
 * "hidden state" anti-pattern (S0): repeated failures of the same tool
 * are a signal that the tool or its inputs are systematically broken,
 * not a transient issue. Without tracking, the loop may retry indefinitely.
 */
const CONSECUTIVE_FAILURE_WARN_THRESHOLD = 3;

/**
 * Circuit breaker states. Based on the standard circuit breaker pattern
 * for preventing cascade failures in distributed systems (2026).
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration. Adaptive thresholds based on error rate
 * monitoring over a sliding window.
 */
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5; // failures to trip
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000; // 30s cooldown before half-open
const CIRCUIT_BREAKER_WINDOW_MS = 60_000; // 1min sliding window

interface CircuitBreakerEntry {
  state: CircuitBreakerState;
  failures: number[]; // timestamps of recent failures
  lastStateChange: number;
  cooldownUntil: number;
}

/**
 * Idempotency key for tool calls. Based on the pattern:
 * (run_id, step_index, action_type) to deduplicate write operations.
 * For our purposes, we use (toolName, argsHash) as the key.
 */
export interface IdempotencyEntry {
  readonly toolName: string;
  readonly argsHash: string;
  readonly executedAt: number;
  readonly result?: string;
}

/** Maximum entries before LRU eviction. */
const MAX_IDEMPOTENCY_ENTRIES = 100;

/** Soft warn once when identical (tool,args) hits this count within a turn. */
export const REPETITION_WARN_THRESHOLD = 4;
/** Intra-turn identical (tool,args) hard-stop (doom_loop), separate from circuit breaker. */
export const REPETITION_HARD_STOP_THRESHOLD = 8;

/** Prefix for model-visible soft tip (Loop24b; pairs with STEP_BUDGET: tips). */
export const DOOM_LOOP_WARN_PREFIX = 'DOOM_LOOP_WARN:' as const;

export function formatDoomLoopWarnTip(toolName: string, count: number): string {
  return (
    `${DOOM_LOOP_WARN_PREFIX} identical ${toolName} call repeated ${String(count)} times this turn ` +
    `(hard stop at ${String(REPETITION_HARD_STOP_THRESHOLD)}). ` +
    `Change approach or stop retrying the same args — do not burn remaining steps on this signature.`
  );
}

export type ToolCallPatternVerdict =
  | { readonly action: 'allow' }
  | { readonly action: 'warn'; readonly count: number }
  | { readonly action: 'hard_stop'; readonly count: number; readonly code: 'DOOM_LOOP_HARD_STOP' };

/**
 * Guard state for one agent. Failure / repetition / idempotency tracking is
 * turn-scoped ({@link resetForTurn}); circuit breakers deliberately outlive a
 * turn and clear at session boundaries ({@link resetCircuitBreakers}).
 */
export class ToolGuardState {
  /** Consecutive failures per tool within a turn. Reset on success. */
  private readonly consecutiveFailures = new Map<string, number>();
  /** Per-tool circuit breaker: error rate over a sliding window. */
  private readonly circuitBreakers = new Map<string, CircuitBreakerEntry>();
  /** Executed tool calls, keyed by `toolName:argsHash`, for replay dedupe. */
  private readonly executedToolCalls = new Map<string, IdempotencyEntry>();
  /** Call signatures seen this turn, for loop-stagnation detection. */
  private readonly recentToolCalls = new Map<string, number>();

  /** Clear the turn-scoped trackers. Circuit breakers survive on purpose. */
  resetForTurn(): void {
    this.consecutiveFailures.clear();
    this.recentToolCalls.clear();
    this.executedToolCalls.clear();
  }

  /** Clear circuit breaker state. Call at session boundaries. */
  resetCircuitBreakers(): void {
    this.circuitBreakers.clear();
  }

  trackToolFailure(toolName: string, log?: Logger): void {
    const count = (this.consecutiveFailures.get(toolName) ?? 0) + 1;
    this.consecutiveFailures.set(toolName, count);
    if (count === CONSECUTIVE_FAILURE_WARN_THRESHOLD) {
      log?.warn('tool failing repeatedly; possible systematic issue', {
        toolName,
        consecutiveFailures: count,
      });
    }
  }

  resetToolFailure(toolName: string): void {
    this.consecutiveFailures.delete(toolName);
  }

  /**
   * Record a tool failure and update circuit breaker state.
   * Returns true if the circuit is open (tool should be blocked).
   */
  recordToolFailureForCircuitBreaker(toolName: string): boolean {
    const now = Date.now();
    let entry = this.circuitBreakers.get(toolName);
    if (entry === undefined) {
      entry = { state: 'closed', failures: [], lastStateChange: now, cooldownUntil: 0 };
      this.circuitBreakers.set(toolName, entry);
    }

    // Handle state transitions based on cooldown.
    if (entry.state === 'open' && now >= entry.cooldownUntil) {
      entry.state = 'half-open';
      entry.lastStateChange = now;
    }

    // Add failure timestamp and prune old entries outside the window.
    entry.failures.push(now);
    entry.failures = entry.failures.filter((t) => now - t < CIRCUIT_BREAKER_WINDOW_MS);

    // Check if we should trip the breaker.
    if (entry.state === 'closed' && entry.failures.length >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      entry.state = 'open';
      entry.lastStateChange = now;
      entry.cooldownUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS;
      return true;
    }

    // In half-open state, any failure re-opens the circuit.
    if (entry.state === 'half-open') {
      entry.state = 'open';
      entry.lastStateChange = now;
      entry.cooldownUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS;
      return true;
    }

    return entry.state === 'open';
  }

  /**
   * Record a tool success. Resets the circuit breaker to closed state.
   * Returns the prior non-closed state when a recovery transition happened
   * (Loop29a: half-open/open → closed visibility).
   */
  recordToolSuccessForCircuitBreaker(toolName: string): CircuitBreakerState | undefined {
    const entry = this.circuitBreakers.get(toolName);
    if (entry !== undefined && entry.state !== 'closed') {
      const prior = entry.state;
      entry.state = 'closed';
      entry.failures = [];
      entry.lastStateChange = Date.now();
      return prior;
    }
    return undefined;
  }

  /** Check if a tool's circuit breaker is open (tool should be blocked). */
  isToolCircuitOpen(toolName: string): boolean {
    const entry = this.circuitBreakers.get(toolName);
    if (entry === undefined) return false;
    const now = Date.now();
    // Transition to half-open if cooldown has passed.
    if (entry.state === 'open' && now >= entry.cooldownUntil) {
      entry.state = 'half-open';
      entry.lastStateChange = now;
      return false; // Allow one test request in half-open state.
    }
    return entry.state === 'open';
  }

  getCircuitBreakerState(toolName: string): CircuitBreakerState {
    return this.circuitBreakers.get(toolName)?.state ?? 'closed';
  }

  /** Generate an idempotency key for a tool call. */
  toolCallIdempotencyKey(toolName: string, args: unknown): string {
    return `${toolName}:${hashToolArgs(args)}`;
  }

  /**
   * Check if a tool call has already been executed (idempotent duplicate).
   * Returns the cached result if available.
   */
  checkToolCallIdempotency(key: string): IdempotencyEntry | undefined {
    return this.executedToolCalls.get(key);
  }

  /** Record a tool call execution for idempotency tracking. */
  recordToolCallExecution(key: string, toolName: string, args: unknown, result?: string): void {
    // LRU eviction if at capacity.
    if (this.executedToolCalls.size >= MAX_IDEMPOTENCY_ENTRIES) {
      const firstKey = this.executedToolCalls.keys().next().value;
      if (firstKey !== undefined) this.executedToolCalls.delete(firstKey);
    }
    this.executedToolCalls.set(key, {
      toolName,
      argsHash: hashToolArgs(args),
      executedAt: Date.now(),
      result,
    });
  }

  /**
   * Record a tool call signature. Returns hard_stop when the same tool+args
   * repeats past the doom threshold within a turn (execution must be blocked).
   */
  trackToolCallPattern(toolName: string, args: unknown, log?: Logger): ToolCallPatternVerdict {
    const signature = `${toolName}:${hashToolArgs(args)}`;
    const count = (this.recentToolCalls.get(signature) ?? 0) + 1;
    this.recentToolCalls.set(signature, count);
    if (count >= REPETITION_HARD_STOP_THRESHOLD) {
      log?.warn('doom_loop hard stop: repetitive tool call pattern', {
        toolName,
        repetitionCount: count,
        code: 'DOOM_LOOP_HARD_STOP',
      });
      return { action: 'hard_stop', count, code: 'DOOM_LOOP_HARD_STOP' };
    }
    if (count === REPETITION_WARN_THRESHOLD) {
      log?.warn('repetitive tool call pattern detected; possible loop stagnation', {
        toolName,
        repetitionCount: count,
      });
      return { action: 'warn', count };
    }
    return { action: 'allow' };
  }

  getToolCallPatternCount(toolName: string, args: unknown): number {
    return this.recentToolCalls.get(`${toolName}:${hashToolArgs(args)}`) ?? 0;
  }
}

/**
 * Stable digest of a tool call's arguments.
 *
 * Hash the whole payload: truncating the JSON made two different Edit/Write
 * calls that shared a long prefix collide, and the second one was then skipped
 * as an already-executed duplicate.
 */
function hashToolArgs(args: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(args) ?? 'undefined';
  } catch {
    return '[unserializable]';
  }
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Tools whose side effects are not file-backed (and therefore not captured by
 * `writePathsFromAccesses`) but are still durable enough to warrant a
 * pre-execution intent log. The resume path treats these as "attempted,
 * completion unknown" since there is no idempotent content check available.
 */
const ALWAYS_SIDE_EFFECTING_TOOLS = new Set<string>(['Bash']);

export function isAlwaysSideEffectingTool(name: string): boolean {
  return ALWAYS_SIDE_EFFECTING_TOOLS.has(name);
}

/**
 * Extract the file paths a tool execution will write, from its declared
 * resource accesses. Returns `undefined` when the tool does not declare any
 * file write access (read-only tools, or side effects that are not file-backed).
 */
export function writePathsFromAccesses(
  accesses: readonly ToolResourceAccess[] | undefined,
): readonly string[] | undefined {
  if (accesses === undefined) return undefined;
  const paths: string[] = [];
  for (const access of accesses) {
    if (access.kind === 'file' && (access.operation === 'write' || access.operation === 'readwrite')) {
      paths.push(access.path);
    }
  }
  return paths.length > 0 ? paths : undefined;
}

export const validators = new WeakMap<ExecutableTool, ToolArgsValidator>();

/**
 * Output for an aborted tool call. When the abort carries a user-cancellation
 * reason (the user pressed stop), say so explicitly so the model treats it as a
 * deliberate interruption instead of a system fault to theorise about or retry.
 * Any other abort keeps the neutral wording.
 */
export function abortedToolOutput(toolName: string, signal: AbortSignal): string {
  if (isUserCancellation(signal.reason)) {
    return `The user manually interrupted "${toolName}" (and anything else running at the same time). This was a deliberate user action, not a system error, timeout, or capacity limit. Do not retry automatically or guess at the cause — wait for the user's next instruction.`;
  }
  // Host-supplied abort reasons (e.g. the conductor hard-budget force-stop)
  // are model-visible so the model knows why the call was cut short.
  const reason =
    typeof signal.reason === 'string' && signal.reason.trim().length > 0
      ? signal.reason.trim()
      : undefined;
  return reason === undefined
    ? `Tool "${toolName}" was aborted`
    : `Tool "${toolName}" was aborted: ${reason}`;
}

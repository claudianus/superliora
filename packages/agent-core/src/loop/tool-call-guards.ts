/**
 * Tool-call guardrails: failure tracking, circuit breakers, idempotency,
 * repetition detection, and side-effect helpers.
 *
 * Extracted from `tool-call.ts` to isolate stateful guard logic from the
 * tool-call execution lifecycle. All trackers are module-level singletons
 * scoped to a single turn/session and must be reset at boundaries.
 */

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
 * Tracks consecutive tool failures within a turn. Reset on success.
 * Module-level state is intentional: the tracker is scoped to a single
 * turn's tool-call batch sequence and does not leak across turns.
 */
const consecutiveFailures = new Map<string, number>();

export function trackToolFailure(toolName: string, log?: Logger): void {
  const count = (consecutiveFailures.get(toolName) ?? 0) + 1;
  consecutiveFailures.set(toolName, count);
  if (count === CONSECUTIVE_FAILURE_WARN_THRESHOLD) {
    log?.warn('tool failing repeatedly; possible systematic issue', {
      toolName,
      consecutiveFailures: count,
    });
  }
}

export function resetToolFailure(toolName: string): void {
  consecutiveFailures.delete(toolName);
}

/** Reset all failure tracking state. Call at turn boundaries. */
export function resetToolFailureTracker(): void {
  consecutiveFailures.clear();
  recentToolCalls.clear();
  executedToolCalls.clear();
}

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
 * Per-tool circuit breaker state. Tracks error rates over a sliding window
 * and implements closed → open → half-open state transitions.
 */
const circuitBreakers = new Map<string, CircuitBreakerEntry>();

/**
 * Record a tool failure and update circuit breaker state.
 * Returns true if the circuit is open (tool should be blocked).
 */
export function recordToolFailureForCircuitBreaker(toolName: string): boolean {
  const now = Date.now();
  let entry = circuitBreakers.get(toolName);
  if (entry === undefined) {
    entry = { state: 'closed', failures: [], lastStateChange: now, cooldownUntil: 0 };
    circuitBreakers.set(toolName, entry);
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
export function recordToolSuccessForCircuitBreaker(
  toolName: string,
): CircuitBreakerState | undefined {
  const entry = circuitBreakers.get(toolName);
  if (entry !== undefined && entry.state !== 'closed') {
    const prior = entry.state;
    entry.state = 'closed';
    entry.failures = [];
    entry.lastStateChange = Date.now();
    return prior;
  }
  return undefined;
}

/**
 * Check if a tool's circuit breaker is open (tool should be blocked).
 */
export function isToolCircuitOpen(toolName: string): boolean {
  const entry = circuitBreakers.get(toolName);
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

/**
 * Get the current circuit breaker state for a tool.
 */
export function getCircuitBreakerState(toolName: string): CircuitBreakerState {
  return circuitBreakers.get(toolName)?.state ?? 'closed';
}

/** Reset all circuit breaker state. Call at session boundaries. */
export function resetCircuitBreakers(): void {
  circuitBreakers.clear();
}

// ---------------------------------------------------------------------------
// Tool call idempotency tracking (duplicate side-effect prevention)
// ---------------------------------------------------------------------------

/**
 * Idempotency key for tool calls. Based on the pattern:
 * (run_id, step_index, action_type) to deduplicate write operations.
 * For our purposes, we use (toolName, argsHash) as the key.
 */
interface IdempotencyEntry {
  readonly toolName: string;
  readonly argsHash: string;
  readonly executedAt: number;
  readonly result?: string;
}

/**
 * Tracks executed tool calls to prevent duplicate side effects on retry.
 * Keyed by composite idempotency key (toolName:argsHash).
 */
const executedToolCalls = new Map<string, IdempotencyEntry>();

/** Maximum entries before LRU eviction. */
const MAX_IDEMPOTENCY_ENTRIES = 100;

/**
 * Generate an idempotency key for a tool call.
 */
export function toolCallIdempotencyKey(toolName: string, args: unknown): string {
  const argsHash = safeStringifyArgs(args);
  return `${toolName}:${argsHash}`;
}

/**
 * Check if a tool call has already been executed (idempotent duplicate).
 * Returns the cached result if available.
 */
export function checkToolCallIdempotency(key: string): IdempotencyEntry | undefined {
  return executedToolCalls.get(key);
}

/**
 * Record a tool call execution for idempotency tracking.
 */
export function recordToolCallExecution(
  key: string,
  toolName: string,
  args: unknown,
  result?: string,
): void {
  // LRU eviction if at capacity.
  if (executedToolCalls.size >= MAX_IDEMPOTENCY_ENTRIES) {
    const firstKey = executedToolCalls.keys().next().value;
    if (firstKey !== undefined) executedToolCalls.delete(firstKey);
  }
  executedToolCalls.set(key, {
    toolName,
    argsHash: safeStringifyArgs(args),
    executedAt: Date.now(),
    result,
  });
}

/** Reset idempotency tracking. Call at turn boundaries. */
export function resetIdempotencyTracker(): void {
  executedToolCalls.clear();
}

/**
 * Loop repetition detection threshold. When the same tool is called with
 * identical arguments this many times within a turn, log a warning about
 * potential loop stagnation. Based on the self-healing framework insight:
 * "failure detection identifies abnormal agent behavior based on execution
 * patterns and output consistency" (Jeong & Shin, 2026).
 */
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

/**
 * Tracks recent tool call signatures (name + args hash) within a turn.
 * Used to detect repetitive patterns that indicate the loop is stuck.
 */
const recentToolCalls = new Map<string, number>();

export type ToolCallPatternVerdict =
  | { readonly action: 'allow' }
  | { readonly action: 'warn'; readonly count: number }
  | { readonly action: 'hard_stop'; readonly count: number; readonly code: 'DOOM_LOOP_HARD_STOP' };

/**
 * Record a tool call signature. Returns hard_stop when the same tool+args
 * repeats past the doom threshold within a turn (execution must be blocked).
 */
export function trackToolCallPattern(
  toolName: string,
  args: unknown,
  log?: Logger,
): ToolCallPatternVerdict {
  const argsKey = safeStringifyArgs(args);
  const signature = `${toolName}:${argsKey}`;
  const count = (recentToolCalls.get(signature) ?? 0) + 1;
  recentToolCalls.set(signature, count);
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

export function getToolCallPatternCount(toolName: string, args: unknown): number {
  const signature = `${toolName}:${safeStringifyArgs(args)}`;
  return recentToolCalls.get(signature) ?? 0;
}

function safeStringifyArgs(args: unknown): string {
  try {
    const json = JSON.stringify(args);
    // Truncate long args to avoid memory issues.
    return json.length > 200 ? `${json.slice(0, 200)}...` : json;
  } catch {
    return '[unserializable]';
  }
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

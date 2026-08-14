/**
 * Subagent deadline / max-tokens errors and permanent provider-failure classifiers.
 *
 * Extracted from subagent-host so orchestration can import error types without
 * pulling the full SessionSubagentHost surface.
 */

import {
  isPermanentAuthError,
  isPermanentQuotaOrBillingError,
} from '@superliora/kosong';

import type { Agent } from '../../agent';

export const DEFAULT_SUBAGENT_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_SUBAGENT_TIMEOUT_DESCRIPTION = '30 minutes';

/**
 * Hard wall-clock deadline (ms) for a single subagent run. Unlike the soft
 * `timeoutMs` budget (which only steers finishing mode and telemetry),
 * exceeding this aborts the run so a wedged child cannot block the parent
 * forever. Defaults to 30 minutes; the `SUPERLIORA_SUBAGENT_DEADLINE_MS`
 * environment variable overrides every run (set it to `0` to disable the
 * deadline entirely).
 */
export const DEFAULT_SUBAGENT_DEADLINE_MS = DEFAULT_SUBAGENT_TIMEOUT_MS;
export const SUBAGENT_DEADLINE_ENV = 'SUPERLIORA_SUBAGENT_DEADLINE_MS';

/**
 * Plan Desk / mission jobs get a longer default wall-clock than implement so
 * Ultra interviews are not burned by the 30m coding budget. Override with
 * `SUPERLIORA_PLAN_DESK_DEADLINE_MS`, falling back to
 * {@link SUBAGENT_DEADLINE_ENV} when the plan-specific var is unset.
 * Implement/verify keep {@link DEFAULT_SUBAGENT_DEADLINE_MS} (30m).
 */
export const DEFAULT_PLAN_DESK_DEADLINE_MS = 45 * 60 * 1000;
export const PLAN_DESK_DEADLINE_ENV = 'SUPERLIORA_PLAN_DESK_DEADLINE_MS';

/**
 * Resolve the effective wall-clock deadline: the environment override wins
 * (operator-level kill switch); otherwise the per-run `timeoutMs` budget;
 * otherwise {@link DEFAULT_SUBAGENT_DEADLINE_MS}. Unparsable or negative
 * environment values fall back instead of disabling the deadline by accident.
 */
export function resolveSubagentDeadlineMs(explicitTimeoutMs?: number): number {
  const fromEnv = parseDeadlineEnv(process.env[SUBAGENT_DEADLINE_ENV]);
  if (fromEnv !== undefined) return fromEnv;
  return explicitTimeoutMs ?? DEFAULT_SUBAGENT_DEADLINE_MS;
}

/**
 * Wall-clock for Plan Desk / mission workers. Prefers
 * {@link PLAN_DESK_DEADLINE_ENV}, then {@link SUBAGENT_DEADLINE_ENV}, then
 * {@link DEFAULT_PLAN_DESK_DEADLINE_MS} (45 minutes). Does not change the
 * implement/verify default — callers must use this only for mission/plan.
 */
export function resolvePlanDeskDeadlineMs(): number {
  const planEnv = parseDeadlineEnv(process.env[PLAN_DESK_DEADLINE_ENV]);
  if (planEnv !== undefined) return planEnv;
  const subEnv = parseDeadlineEnv(process.env[SUBAGENT_DEADLINE_ENV]);
  if (subEnv !== undefined) return subEnv;
  return DEFAULT_PLAN_DESK_DEADLINE_MS;
}

/**
 * Job-worker soft+hard timeout: mission → plan-desk budget; every other kind
 * keeps the implement default (30m). Env kill switches are applied later by
 * {@link resolveSubagentDeadlineMs} for the hard abort path when the FanoutSpec
 * budget is re-resolved.
 */
export function resolveJobWorkerTimeoutMs(kind: string | undefined): number {
  if (kind === 'mission') return resolvePlanDeskDeadlineMs();
  return DEFAULT_SUBAGENT_TIMEOUT_MS;
}

/**
 * Resume budget inherit: subtract wall-clock already spent since the job's
 * first worker bind (`workerDeadlineStartedAt`). Fresh jobs (no start stamp)
 * get the full kind budget. Never returns negative — a fully spent budget
 * yields 0 so the hard deadline aborts immediately rather than resetting 30/45m.
 */
export function resolveJobWorkerRemainingTimeoutMs(
  kind: string | undefined,
  deadlineStartedAt: string | undefined,
  nowMs: number = Date.now(),
): number {
  const budget = resolveJobWorkerTimeoutMs(kind);
  if (deadlineStartedAt === undefined || deadlineStartedAt.trim().length === 0) {
    return budget;
  }
  const started = Date.parse(deadlineStartedAt);
  if (!Number.isFinite(started)) return budget;
  const spent = Math.max(0, nowMs - started);
  return Math.max(0, budget - spent);
}

function parseDeadlineEnv(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

/**
 * Typed error thrown when a subagent run exceeds its wall-clock deadline and
 * is aborted. Identified via `instanceof` or the `code` discriminant; the
 * message is human-readable ("subagent timed out after 30m — …").
 */
export class SubagentDeadlineError extends Error {
  readonly code = 'subagent_deadline' as const;
  readonly deadlineMs: number;

  constructor(deadlineMs: number) {
    super(
      `subagent timed out after ${describeDeadlineDuration(deadlineMs)} — ` +
        `aborted by the ${String(deadlineMs)}ms wall-clock deadline`,
    );
    this.name = 'SubagentDeadlineError';
    this.deadlineMs = deadlineMs;
  }
}

export function isSubagentDeadlineError(error: unknown): error is SubagentDeadlineError {
  return error instanceof SubagentDeadlineError;
}

function describeDeadlineDuration(ms: number): string {
  if (ms < 60_000) return `${String(Math.max(1, Math.round(ms / 1000)))}s`;
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${String(minutes)}m`;
  return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;
}

/** Stable prefix embedded in enriched permanent-failure messages. */
const PERMANENT_PROVIDER_FAILURE_MARKER = 'Permanent provider failure';

/**
 * Whether a subagent failure is a permanent auth/billing problem (401/403,
 * invalid credentials, expired subscription, …) that no retry can fix.
 * Delegates to kosong's classifiers, which also inspect copied `statusCode`
 * on flattened turn errors.
 */
export function isPermanentSubagentProviderFailure(error: unknown): boolean {
  return isPermanentAuthError(error) || isPermanentQuotaOrBillingError(error);
}

/**
 * Message-level variant for surfaces that only keep the flattened error
 * string (e.g. rendered swarm results): matches the enrichment marker plus
 * kosong's auth/billing message patterns.
 */
export function isPermanentProviderFailureMessage(message: string | null | undefined): boolean {
  if (message === undefined || message === null || message.length === 0) return false;
  if (message.startsWith(PERMANENT_PROVIDER_FAILURE_MARKER)) return true;
  const asError = new Error(message);
  return isPermanentAuthError(asError) || isPermanentQuotaOrBillingError(asError);
}

/**
 * Wrap a permanent auth/billing failure with provider/model context and
 * "check billing/credentials" guidance before it is emitted or rethrown.
 * The original message and `statusCode` are preserved so downstream
 * classifiers (swarm fail-fast) still recognize the failure as permanent.
 * Non-permanent errors pass through unchanged.
 */
export function enrichPermanentProviderFailure(error: unknown, child: Agent): unknown {
  if (!isPermanentSubagentProviderFailure(error)) return error;
  const base = error instanceof Error ? error.message : String(error);
  const modelAlias = child.config.modelAlias;
  const providerName =
    modelAlias === undefined
      ? undefined
      : (child.runtimeConfig ?? child.kimiConfig)?.models?.[modelAlias]?.provider;
  const enriched = new Error(
    `${PERMANENT_PROVIDER_FAILURE_MARKER} ` +
      `(provider=${providerName ?? 'unknown'}, model=${modelAlias ?? 'unknown'}): ${base}. ` +
      'Retrying cannot fix this — check billing/credentials for this provider.',
  );
  enriched.name = 'SubagentPermanentProviderError';
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === 'number') {
    (enriched as Error & { statusCode?: number }).statusCode = statusCode;
  }
  (enriched as Error & { cause?: unknown }).cause = error;
  return enriched;
}

/**
 * Typed error thrown when a subagent turn exhausts its output token budget
 * before producing the required final summary. Callers (subagent-batch,
 * recovery prompts) can identify this class with `instanceof` or the
 * `code` discriminant instead of substring-matching the human message.
 */
export const SUBAGENT_MAX_TOKENS_ERROR =
  'Subagent turn failed before completing its final summary: reason=max_tokens';

export class SubagentMaxTokensError extends Error {
  readonly code = 'subagent_max_tokens' as const;

  constructor(message: string = SUBAGENT_MAX_TOKENS_ERROR) {
    super(message);
    this.name = 'SubagentMaxTokensError';
  }
}

/** Type guard for {@link SubagentMaxTokensError} thrown by `runChildTurnToCompletion`. */
export function isSubagentMaxTokensError(error: unknown): error is SubagentMaxTokensError {
  return error instanceof SubagentMaxTokensError;
}

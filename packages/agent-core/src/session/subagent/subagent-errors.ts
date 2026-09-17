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
 * One-shot finishing grace for job workers: when the hard wall-clock deadline
 * fires, the deadline re-arms once for this long so a worker already in its
 * finishing phase can commit and summarize instead of being killed with all
 * work still uncommitted. The failure path also snapshots the worktree, but
 * the grace is what keeps a healthy finish from dying at the line.
 */
export const JOB_WORKER_DEADLINE_GRACE_MS = 5 * 60 * 1000;

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
 * Explore / research default wall-clock (shorter than implement 30m).
 * Empty 30m aborts on repo-wide explore were burning three Jobs per session;
 * 20m forces a 1-page handoff window (finishing mode starts at T-5m of budget).
 * Override is still available via {@link SUBAGENT_DEADLINE_ENV}.
 */
export const DEFAULT_EXPLORE_DEADLINE_MS = 20 * 60 * 1000;

/**
 * Job-worker soft+hard timeout:
 * - mission → plan-desk budget (45m)
 * - explore / research → {@link DEFAULT_EXPLORE_DEADLINE_MS} (20m)
 * - implement / verify / task / others → implement default (30m)
 *
 * Env kill switches are applied later by {@link resolveSubagentDeadlineMs} for
 * the hard abort path when the FanoutSpec budget is re-resolved.
 */
export function resolveJobWorkerTimeoutMs(kind: string | undefined): number {
  if (kind === 'mission') return resolvePlanDeskDeadlineMs();
  if (kind === 'explore' || kind === 'research') return DEFAULT_EXPLORE_DEADLINE_MS;
  return DEFAULT_SUBAGENT_TIMEOUT_MS;
}

/**
 * Resume budget inherit: subtract wall-clock already spent since the job's
 * first worker bind (`workerDeadlineStartedAt`). Fresh jobs (no start stamp)
 * get the full kind budget. Never returns negative.
 *
 * Exhausted remaining is {@link EXHAUSTED_JOB_WORKER_TIMEOUT_MS} (1ms), not 0:
 * `timeoutMs: 0` is the {@link SUBAGENT_DEADLINE_ENV} kill-switch (unlimited)
 * and must never be used to mean "budget already spent".
 */
export const EXHAUSTED_JOB_WORKER_TIMEOUT_MS = 1;

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
  const remaining = budget - spent;
  if (remaining <= 0) return EXHAUSTED_JOB_WORKER_TIMEOUT_MS;
  return remaining;
}

/**
 * Fanout / `runWithActiveChild` timeout for a job worker. A fully spent
 * resume re-grants the fresh kind budget: mapping it onto
 * {@link EXHAUSTED_JOB_WORKER_TIMEOUT_MS} here would abort the relaunched
 * worker before its first turn ("timed out after 1s — aborted by the 1ms
 * wall-clock deadline"). Partially spent wall-clock is still inherited
 * (no reset), and `timeoutMs: 0` remains exclusively the
 * {@link SUBAGENT_DEADLINE_ENV} kill-switch.
 */
export function resolveJobWorkerLaunchTimeoutMs(
  kind: string | undefined,
  deadlineStartedAt: string | undefined,
  nowMs: number = Date.now(),
): number {
  const remaining = resolveJobWorkerRemainingTimeoutMs(kind, deadlineStartedAt, nowMs);
  if (remaining === EXHAUSTED_JOB_WORKER_TIMEOUT_MS) {
    return resolveJobWorkerTimeoutMs(kind);
  }
  return remaining;
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

/**
 * Finite cap on the `finishing` phase (H8). The observed failure was a worker
 * that entered finishing, went silent for 3-7 minutes, and was then killed by
 * the 30m wall-clock with `reason: deadline` and no report — a bare abort that
 * carries no evidence of how far the work had come. This error is returned
 * instead of the plain deadline error when the finishing phase outlives its
 * cap, and it embeds the progress snapshot gathered at the breach so the run
 * ends with a result (interrupted reason + state), not silence.
 *
 * Extends {@link SubagentDeadlineError} on purpose: every existing deadline
 * consumer (job worker failure path, resume-handoff writer, worktree snapshot
 * backstop) keeps working unchanged, it just gets a richer payload.
 */
export interface SubagentFinishingProgress {
  readonly toolCount?: number;
  readonly lastTool?: string;
  readonly lastTarget?: string;
  readonly elapsedMs?: number;
}

export class SubagentFinishingCapError extends SubagentDeadlineError {
  readonly finishingCapMs: number;
  readonly finishingMs: number;
  readonly progress: SubagentFinishingProgress;

  constructor(input: {
    readonly finishingCapMs: number;
    readonly finishingMs: number;
    readonly deadlineMs: number;
    readonly progress?: SubagentFinishingProgress;
  }) {
    const progress = input.progress ?? {};
    const state = [
      progress.toolCount !== undefined ? `tools=${String(progress.toolCount)}` : undefined,
      progress.lastTool !== undefined
        ? `last_tool=${progress.lastTarget !== undefined ? `${progress.lastTool}:${progress.lastTarget}` : progress.lastTool}`
        : undefined,
      progress.elapsedMs !== undefined
        ? `elapsed=${String(Math.round(progress.elapsedMs / 1000))}s`
        : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' ');
    super(input.deadlineMs);
    this.name = 'SubagentFinishingCapError';
    this.finishingCapMs = input.finishingCapMs;
    this.finishingMs = input.finishingMs;
    this.progress = progress;
    // The message is what survives into the job's stored result summary, so it
    // must state the interrupted reason AND the progress at the breach.
    Object.defineProperty(this, 'message', {
      value:
        `subagent finishing cap exceeded: ${describeDeadlineDuration(input.finishingMs)} in the finishing phase ` +
        `(cap ${describeDeadlineDuration(input.finishingCapMs)}) — interrupted before the wall-clock deadline. ` +
        `Progress at interruption: ${state.length > 0 ? state : 'no tool activity recorded'}. ` +
        `Dirty work is snapshotted; resume from the handoff below.`,
      writable: true,
      configurable: true,
    });
  }
}

export function isSubagentFinishingCapError(error: unknown): error is SubagentFinishingCapError {
  return error instanceof SubagentFinishingCapError;
}

/**
 * Default finite cap for the finishing phase (H8). Finishing is steered at
 * T-5m of the soft budget (subagent-telemetry); 10m of finishing is well past
 * "commit and summarize", so exceeding it means the worker is wedged and must
 * return a diagnostic instead of eating the remaining wall-clock.
 */
export const DEFAULT_SUBAGENT_FINISHING_CAP_MS = 10 * 60 * 1000;

/**
 * Job-worker finishing cap (H8): a job worker that announces finishing mode
 * and then makes no tool progress for this long is treated as wedged. Kept at
 * the shared {@link DEFAULT_SUBAGENT_FINISHING_CAP_MS} value so job behaviour
 * and the generic subagent default cannot drift apart.
 */
export const JOB_WORKER_FINISHING_CAP_MS = DEFAULT_SUBAGENT_FINISHING_CAP_MS;

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

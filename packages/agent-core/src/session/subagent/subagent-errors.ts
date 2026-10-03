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

/** Execution ended, but physical resources still prevent ownership release. */
export class SubagentCleanupError extends Error {
  readonly code = 'subagent_cleanup_failed' as const;

  constructor(readonly agentId: string, cause: unknown, private readonly getResourcesSettled: () => boolean) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Worker ${agentId} cleanup failed: ${detail}`, { cause });
    this.name = 'SubagentCleanupError';
  }

  get resourcesSettled(): boolean {
    return this.getResourcesSettled();
  }
}

export const SUBAGENT_DEADLINE_ENV = 'SUPERLIORA_SUBAGENT_DEADLINE_MS';

/** Only operator-selected deadlines constrain the worker's wall clock. */
export function resolveSubagentDeadlineMs(explicitTimeoutMs?: number): number {
  const fromEnv = parseDeadlineEnv(process.env[SUBAGENT_DEADLINE_ENV]);
  return fromEnv ?? explicitTimeoutMs ?? 0;
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

/** The provider stopped before the child turn completed. */
export const SUBAGENT_MAX_TOKENS_ERROR = 'Subagent turn stopped: reason=max_tokens';

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

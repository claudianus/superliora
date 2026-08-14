/**
 * Subagent run / prompt-turn lifecycle helpers: active-child deadline wrap,
 * child-turn completion, model-fallback classifiers, and expert profile build.
 *
 * Extracted from subagent-host so orchestration can share these without
 * growing the SessionSubagentHost class body. Callers that own active-child
 * state pass the map into {@link runWithActiveChild}.
 */

import {
  APIProviderRateLimitError,
  APIStatusError,
  isRetryableGenerateError,
} from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';

import type { Agent } from '../../agent';
import {
  isRetryableProviderFailure,
} from '../../agent/provider-failover';
import {
  DEFAULT_MODEL_UNAVAILABLE_COOLDOWN_MS,
  sharedModelRouteHealthStore,
} from '../../agent/routing/model-route-health';
import { classifyProviderRouteFailure } from '../../agent/turn/provider-route-classify';
import { ErrorCodes, toKimiErrorPayload, type LioraErrorPayload } from '../../errors';
import { isAbortError } from '../../loop/errors';
import { renderExpertSystemPrompt, resolveExpertWhenToUse } from '../../expert-agents/expert-persona';
import type { ExpertCatalogEntry } from '../../expert-agents/types';
import type { ResolvedAgentProfile } from '../../profile';
import {
  linkAbortSignal,
} from '../../utils/abort';
import {
  SUBAGENT_MAX_TOKENS_ERROR,
  SubagentDeadlineError,
  SubagentMaxTokensError,
  resolveSubagentDeadlineMs,
} from './subagent-errors';

export type ActiveChildEntry = {
  readonly controller: AbortController;
  runInBackground: boolean;
  /** Pause/resume the wall-clock deadline (interview / needs_user stalls). */
  pauseDeadline?: () => void;
  resumeDeadline?: () => void;
};

/** Minimal options shape required by {@link runWithActiveChild}. */
export type RunWithActiveChildOptions = {
  readonly signal: AbortSignal;
  readonly runInBackground: boolean;
  readonly timeoutMs?: number;
};

/**
 * Module-level deadline handles so Job / AskUserQuestion paths can pause a
 * live child's wall-clock without holding the parent host instance.
 */
const deadlineControlsByChildId = new Map<
  string,
  { readonly pause: () => void; readonly resume: () => void }
>();

/** Pause the hard wall-clock deadline for an active child (needs_user interview). */
export function pauseActiveChildDeadline(childId: string): boolean {
  const control = deadlineControlsByChildId.get(childId);
  if (control === undefined) return false;
  control.pause();
  return true;
}

/** Resume a previously paused deadline with the remaining budget. */
export function resumeActiveChildDeadline(childId: string): boolean {
  const control = deadlineControlsByChildId.get(childId);
  if (control === undefined) return false;
  control.resume();
  return true;
}

export function isModelAliasHealthy(
  alias: string | undefined,
  models: Record<string, { provider?: string }> | undefined,
): boolean {
  if (alias === undefined || models === undefined) return true;
  if (!sharedModelRouteHealthStore.isAvailable(alias)) return false;
  const entry = models[alias];
  if (entry === undefined) return true;
  const provider = entry.provider;
  if (provider === undefined || provider.length === 0) return true;
  return sharedCredentialHealthStore.isAvailable(provider);
}

/**
 * Poison an alias's provider credential after a permanent auth refusal
 * (HTTP 401/403 — e.g. an exploration model this subscription is not
 * entitled to). The mark lands in the same shared health store that
 * {@link isModelAliasHealthy} reads, so every later spawn/resume/retry
 * resolution (`resolveSubagentModelAlias`) skips the alias instead of
 * re-routing into a guaranteed 403 (V7-2 incident).
 *
 * Returns false when there is nothing to mark (no alias, alias missing from
 * the models record, or a provider-less entry).
 */
export function markModelAliasAuthRejected(
  alias: string | undefined,
  models: Record<string, { model?: string; provider?: string }> | undefined,
  error?: unknown,
): boolean {
  if (alias === undefined || models === undefined) return false;
  const provider = models[alias]?.provider;
  if (provider === undefined || provider.length === 0) return false;
  const failureReason =
    error instanceof Error && error.message.length > 0
      ? error.message
      : 'provider rejected credentials (HTTP 401/403)';
  sharedCredentialHealthStore.markAuthRejected(provider, { failureReason });
  sharedModelRouteHealthStore.markUnavailable(alias, {
    kind: 'route_fail',
    failureReason,
  });
  return true;
}

/**
 * Mark a single model alias unavailable (retired ID / 404) without poisoning
 * the whole provider credential. Sibling aliases on the same provider stay eligible.
 */
export function markModelAliasUnavailable(
  alias: string | undefined,
  error?: unknown,
): boolean {
  if (alias === undefined || alias.trim().length === 0) return false;
  const failure = classifyProviderRouteFailure(error, undefined);
  const failureReason =
    error instanceof Error && error.message.length > 0
      ? error.message
      : 'model unavailable';
  sharedModelRouteHealthStore.markUnavailable(alias, {
    kind: 'model_unavailable',
    failureReason,
    cooldownMs: failure?.cooldownMs ?? DEFAULT_MODEL_UNAVAILABLE_COOLDOWN_MS,
  });
  return true;
}

/**
 * Register a child in the active map, link abort + wall-clock deadline, run
 * the work, then tear down. The soft `timeoutMs` budget only steers finishing
 * mode; the hard deadline aborts a wedged child.
 */
export function runWithActiveChild<TResult, TOptions extends RunWithActiveChildOptions>(
  activeChildren: Map<string, ActiveChildEntry>,
  childId: string,
  options: TOptions,
  run: (options: TOptions) => Promise<TResult>,
): Promise<TResult> {
  const controller = new AbortController();
  const unlinkAbortSignal = linkAbortSignal(options.signal, controller);

  // Hard wall-clock deadline: the soft `timeoutMs` budget only steers
  // finishing mode, so a wedged child (stuck network, unresponsive
  // gateway) must still be killed. The timer aborts the child controller;
  // the human-readable deadline error then replaces the downstream abort
  // noise in the failure path.
  //
  // Interview / needs_user: pause clears the timer and freezes remaining
  // budget so AskUserQuestion wait does not burn the 30m/45m window.
  const deadlineMs = resolveSubagentDeadlineMs(options.timeoutMs);
  let deadlineError: SubagentDeadlineError | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let deadlineRemainingMs = deadlineMs;
  let deadlineStartedAt = Date.now();
  let deadlinePaused = false;

  const clearDeadlineTimer = (): void => {
    if (deadlineTimer !== undefined) {
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
    }
  };

  const armDeadlineTimer = (ms: number): void => {
    clearDeadlineTimer();
    if (ms <= 0 || deadlinePaused) return;
    deadlineStartedAt = Date.now();
    deadlineRemainingMs = ms;
    deadlineTimer = setTimeout(() => {
      deadlineError = new SubagentDeadlineError(deadlineMs);
      controller.abort(deadlineError);
    }, ms);
    deadlineTimer.unref?.();
  };

  const pauseDeadline = (): void => {
    if (deadlineMs <= 0 || deadlinePaused) return;
    if (deadlineTimer !== undefined) {
      const elapsed = Date.now() - deadlineStartedAt;
      deadlineRemainingMs = Math.max(0, deadlineRemainingMs - elapsed);
      clearDeadlineTimer();
    }
    deadlinePaused = true;
  };

  const resumeDeadline = (): void => {
    if (deadlineMs <= 0 || !deadlinePaused) return;
    deadlinePaused = false;
    if (deadlineRemainingMs > 0 && !controller.signal.aborted) {
      armDeadlineTimer(deadlineRemainingMs);
    }
  };

  const entry: ActiveChildEntry = {
    controller,
    runInBackground: options.runInBackground,
    pauseDeadline,
    resumeDeadline,
  };
  activeChildren.set(childId, entry);
  deadlineControlsByChildId.set(childId, { pause: pauseDeadline, resume: resumeDeadline });

  if (deadlineMs > 0) {
    armDeadlineTimer(deadlineMs);
  }

  return run({ ...options, signal: controller.signal })
    .catch((error: unknown) => {
      if (deadlineError !== undefined) throw deadlineError;
      throw error;
    })
    .finally(() => {
      clearDeadlineTimer();
      deadlineControlsByChildId.delete(childId);
      unlinkAbortSignal();
      activeChildren.delete(childId);
    });
}

export async function runChildTurnToCompletion(child: Agent, signal: AbortSignal): Promise<void> {
  const completion = await child.turn.waitForCurrentTurn(signal);
  const turnEnded = completion.event;
  if (turnEnded.reason !== 'completed') {
    if (turnEnded.reason === 'filtered') {
      throw new Error('Subagent turn blocked by provider safety policy');
    }
    if (turnEnded.error?.code === ErrorCodes.PROVIDER_RATE_LIMIT) {
      throw providerRateLimitErrorFromPayload(turnEnded.error);
    }
    const failure = new Error(
      turnEnded.error === undefined
        ? `Subagent turn ${turnEnded.reason}`
        : `[${turnEnded.error.code}] ${turnEnded.error.message}`,
    );
    // Preserve the provider HTTP status so downstream classifiers can tell
    // transient 5xx failures apart from permanent 4xx after payload flattening.
    const failureStatusCode = turnEnded.error?.details?.['statusCode'];
    if (typeof failureStatusCode === 'number') {
      (failure as Error & { statusCode?: number }).statusCode = failureStatusCode;
    }
    throw failure;
  }
  if (completion.stopReason === 'max_tokens') {
    throw new SubagentMaxTokensError(`${SUBAGENT_MAX_TOKENS_ERROR}.`);
  }
}

function providerRateLimitErrorFromPayload(error: LioraErrorPayload): APIProviderRateLimitError {
  const requestId =
    typeof error.details?.['requestId'] === 'string' ? error.details['requestId'] : null;
  return new APIProviderRateLimitError(error.message, requestId);
}

/**
 * Test-only export. Exposed so the request-id propagation path can be
 * pinned without spinning up a full subagent-host mock. Production callers
 * reach this through `runChildTurnToCompletion`.
 */
export const __testing__ = { providerRateLimitErrorFromPayload };

/**
 * Whether a subagent turn failure deserves a model-fallback hop. Direct
 * provider errors (rate limit, status errors thrown before flattening) are
 * judged through their wire payload. Flattened turn failures arrive as plain
 * `Error`s with the provider HTTP status copied on, so rebuild a status error
 * and let kosong's classifier judge transient cases (e.g. body-less 400
 * gateway glitches) exactly the same way.
 */
export function isRetryableSubagentProviderFailure(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (isRetryableProviderFailure(toKimiErrorPayload(error))) return true;
  if (!(error instanceof Error)) return false;
  const statusCode = (error as Error & { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== 'number') return false;
  return isRetryableGenerateError(new APIStatusError(statusCode, error.message));
}

export function createExpertSubagentProfile(
  expert: ExpertCatalogEntry,
  baseProfile: ResolvedAgentProfile,
): ResolvedAgentProfile {
  return {
    ...baseProfile,
    name: expert.id,
    description: expert.description,
    whenToUse: resolveExpertWhenToUse(expert),
    systemPrompt: (context) =>
      renderExpertSystemPrompt(baseProfile.systemPrompt(context), expert, baseProfile.name),
    tools: [...baseProfile.tools],
    subagents: baseProfile.subagents,
  };
}

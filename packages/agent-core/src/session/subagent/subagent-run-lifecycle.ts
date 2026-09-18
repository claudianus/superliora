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
  SubagentFinishingCapError,
  SubagentDeadlineError,
  SubagentMaxTokensError,
  resolveSubagentDeadlineMs,
  type SubagentFinishingProgress,
} from './subagent-errors';

export type ActiveChildEntry = {
  readonly controller: AbortController;
  runInBackground: boolean;
  /** Pause/resume the wall-clock deadline (interview / needs_user stalls). */
  pauseDeadline?: () => void;
  resumeDeadline?: () => void;
  /**
   * Replace remaining wall-clock (session steer resets the 30m budget).
   * No-op without new child tool progress since the last reset — a wedged
   * child must not extend its deadline by merely being steered again.
   */
  resetDeadline?: (ms: number) => void;
  /**
   * Record that the child made observable progress (a tool call started).
   * Wired by callers that own the child agent; deadline resets consult it.
   */
  markToolProgress?: () => void;
  /** H8: announce the finishing phase — arms the finite finishing cap. */
  markFinishing?: () => void;
};

/** Minimal options shape required by {@link runWithActiveChild}. */
export type RunWithActiveChildOptions = {
  readonly signal: AbortSignal;
  readonly runInBackground: boolean;
  readonly timeoutMs?: number;
  /** One-shot finishing grace when the hard deadline fires (job workers). */
  readonly deadlineGraceOnceMs?: number;
  /** Called once when the finishing grace is granted. */
  readonly notifyDeadlineGrace?: () => void;
  /**
   * Finite cap on the finishing phase (H8). When the child announces it has
   * entered finishing (`notifyFinishingStart`), the run gets at most this long
   * to land commits and a summary; past it the run ends with a
   * {@link SubagentFinishingCapError} carrying the progress snapshot instead of
   * silently consuming wall-clock until the deadline. `0`/undefined disables it.
   */
  readonly finishingCapMs?: number;
  /** Called once when the child enters the finishing phase (starts the cap). */
  readonly notifyFinishingStart?: () => void;
  /**
   * Progress snapshot read when the finishing cap is breached, so the returned
   * error states how far the run had come (last tool/target, tool count).
   */
  readonly readFinishingProgress?: () => SubagentFinishingProgress | undefined;
};

/**
 * Module-level deadline handles so Job / AskUserQuestion paths can pause a
 * live child's wall-clock without holding the parent host instance.
 */
const deadlineControlsByChildId = new Map<
  string,
  {
    readonly pause: () => void;
    readonly resume: () => void;
    readonly reset: (ms: number) => boolean;
    readonly markToolProgress: () => void;
    readonly markFinishing: () => void;
  }
>();

/**
 * H8: progress snapshot per live child, recorded by the finishing-phase
 * telemetry. The finishing cap embeds this in the returned error so an
 * interrupted run reports how far it got instead of dying empty.
 */
const finishingProgressByChildId = new Map<string, SubagentFinishingProgress>();

/**
 * Record the finishing-phase progress snapshot for a live child (H8). Called
 * by the telemetry reporter; the snapshot rides the finishing-cap error.
 */
export function recordActiveChildFinishingProgress(
  childId: string,
  progress: SubagentFinishingProgress,
): boolean {
  if (!deadlineControlsByChildId.has(childId)) return false;
  finishingProgressByChildId.set(childId, progress);
  return true;
}

/** Record observable tool progress for a live child (deadline-reset gate). */
export function markActiveChildToolProgress(childId: string): boolean {
  const control = deadlineControlsByChildId.get(childId);
  if (control === undefined) return false;
  control.markToolProgress();
  return true;
}

/**
 * Announce that a live child entered its finishing phase (H8) — arms the
 * finite finishing cap. Returns false when the child is not registered as a
 * live child; a child without a configured cap still returns true (the
 * announcement is then a no-op).
 */
export function markActiveChildFinishing(childId: string): boolean {
  const control = deadlineControlsByChildId.get(childId);
  if (control === undefined) return false;
  control.markFinishing();
  return true;
}

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

/**
 * Replace remaining wall-clock for a live child (session steer budget reset).
 * Refused (false) when the child has made no tool progress since the last
 * reset — a wedged child must not extend its deadline by being steered again.
 */
export function resetActiveChildDeadline(childId: string, ms: number): boolean {
  const control = deadlineControlsByChildId.get(childId);
  if (control === undefined) return false;
  return control.reset(ms);
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

  // H8: finite cap on the finishing phase. The wall-clock deadline stays the
  // outer bound; this inner gate ends a finishing phase that stops making
  // progress, so the run returns a diagnostic (interrupted reason + progress
  // snapshot + resume handoff) instead of dying silently at the deadline with
  // an empty report. Unref'd like the deadline timer — telemetry never keeps
  // the event loop alive.
  const finishingCapMs = options.finishingCapMs ?? 0;
  let finishingIdleTimer: ReturnType<typeof setTimeout> | undefined;
  let finishingStartedAt: number | undefined;
  const clearFinishingIdleTimer = (): void => {
    if (finishingIdleTimer !== undefined) {
      clearTimeout(finishingIdleTimer);
      finishingIdleTimer = undefined;
    }
  };
  const finishWithFinishingCap = (): void => {
    if (deadlineError !== undefined) return;
    const progress = options.readFinishingProgress?.() ?? finishingProgressByChildId.get(childId);
    deadlineError = new SubagentFinishingCapError({
      finishingCapMs,
      finishingMs: Date.now() - (finishingStartedAt ?? Date.now()),
      deadlineMs,
      ...(progress !== undefined ? { progress } : {}),
    });
    controller.abort(deadlineError);
  };
  /**
   * Arm the finishing cap. The cap is an *idle* bound inside the finishing
   * phase, matching the observed failure exactly: the worker entered
   * finishing, tool activity stopped for 3-7 minutes, and the run was then
   * guillotined at the deadline with no report. A finishing run that keeps
   * producing tool progress is still bounded by the wall-clock deadline, so
   * resetting on progress never makes the run unbounded.
   */
  const armFinishingIdleTimer = (): void => {
    clearFinishingIdleTimer();
    finishingIdleTimer = setTimeout(() => {
      finishWithFinishingCap();
    }, finishingCapMs);
    finishingIdleTimer.unref?.();
  };
  const enterFinishing = (): void => {
    if (finishingCapMs <= 0 || finishingStartedAt !== undefined) return;
    finishingStartedAt = Date.now();
    try {
      options.notifyFinishingStart?.();
    } catch {
      // Notice is best-effort; the cap itself is already armed below.
    }
    armFinishingIdleTimer();
  };
  /** Finishing + tool progress: re-arm the idle bound. */
  const noteProgressDuringFinishing = (): void => {
    if (finishingStartedAt === undefined || deadlineError !== undefined) return;
    armFinishingIdleTimer();
  };

  const clearDeadlineTimer = (): void => {
    if (deadlineTimer !== undefined) {
      clearTimeout(deadlineTimer);
      deadlineTimer = undefined;
    }
  };

  let deadlineGraceUsed = false;
  const fireDeadline = (): void => {
    if (deadlineError !== undefined) return;
    // One-shot finishing grace: a job worker hit by the deadline mid-finish
    // gets a single re-arm so it can land commits and a summary. Without it
    // the guillotine kills healthy runs at the finish line.
    const graceMs = options.deadlineGraceOnceMs;
    if (!deadlineGraceUsed && graceMs !== undefined && graceMs > 0) {
      deadlineGraceUsed = true;
      armDeadlineTimer(graceMs);
      try {
        options.notifyDeadlineGrace?.();
      } catch {
        // The notice is best-effort; the grace itself is already armed.
      }
      return;
    }
    deadlineError = new SubagentDeadlineError(deadlineMs);
    controller.abort(deadlineError);
  };

  const armDeadlineTimer = (ms: number): void => {
    clearDeadlineTimer();
    if (ms <= 0 || deadlinePaused) return;
    deadlineStartedAt = Date.now();
    deadlineRemainingMs = ms;
    deadlineTimer = setTimeout(() => {
      fireDeadline();
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

  const resetDeadline = (ms: number): void => {
    const next = Math.max(1, ms);
    deadlinePaused = false;
    deadlineRemainingMs = next;
    if (!controller.signal.aborted) {
      armDeadlineTimer(next);
    }
  };

  // Deadline resets (session steer / JobSteer) must not let a wedged child
  // live forever: a stall-detection loop that keeps steering a child whose
  // LLM request is hung re-arms the full budget on every steer, so the hard
  // deadline never fires (observed: 30m budget overrun with zombie heartbeats
  // for hours). A reset only extends the run when the child has produced
  // new tool progress since the last reset.
  let lastResetProgressMark = 0;
  let toolProgressMark = 0;
  const resetDeadlineWithProgress = (ms: number): boolean => {
    if (toolProgressMark <= lastResetProgressMark) return false;
    lastResetProgressMark = toolProgressMark;
    resetDeadline(ms);
    return true;
  };

  const entry: ActiveChildEntry = {
    controller,
    runInBackground: options.runInBackground,
    pauseDeadline,
    resumeDeadline,
    resetDeadline: (ms: number) => {
      resetDeadlineWithProgress(ms);
    },
    markToolProgress: () => {
      toolProgressMark += 1;
      noteProgressDuringFinishing();
    },
    // H8: the child announced it reached its finishing phase — start the
    // finite cap so a silent finishing phase ends with a diagnostic result.
    markFinishing: enterFinishing,
  };
  activeChildren.set(childId, entry);
  deadlineControlsByChildId.set(childId, {
    pause: pauseDeadline,
    resume: resumeDeadline,
    reset: resetDeadlineWithProgress,
    markToolProgress: () => {
      toolProgressMark += 1;
      noteProgressDuringFinishing();
    },
    markFinishing: enterFinishing,
  });

  if (deadlineMs > 0) {
    armDeadlineTimer(deadlineMs);
  }

  // Abort must settle `handle.completion`: if `run` ignores AbortSignal
  // (wedged approval, hung generate), the deadline still rejects the
  // wrapper so callers do not hang until the test/process timeout.
  const deadlineAbort = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      if (deadlineError !== undefined) reject(deadlineError);
    };
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });

  return Promise.race([run({ ...options, signal: controller.signal }), deadlineAbort])
    .catch((error: unknown) => {
      if (deadlineError !== undefined) throw deadlineError;
      throw error;
    })
    .finally(() => {
      clearDeadlineTimer();
      clearFinishingIdleTimer();
      finishingProgressByChildId.delete(childId);
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

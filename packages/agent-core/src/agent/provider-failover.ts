import type { Agent } from '.';
import { ErrorCodes, type LioraErrorPayload } from '../errors';
import { isAbortError } from '../loop/errors';
import { retryBackoffDelays, sleepForRetry } from '../loop/retry';
import { normalizeQuestionAnswers } from '../rpc/question-result';
import type { QuestionOption, QuestionResult } from '../rpc/sdk-api';

/** Auto-retries for ordinary transient provider failures (5xx, empty, etc.). */
export const GOAL_PROVIDER_AUTO_RETRIES = 3;
/**
 * Rate-limit / quota bursts need more patience — providers often recover after
 * a short window, and Ultrawork runs should wait instead of pausing the goal.
 */
export const GOAL_PROVIDER_RATE_LIMIT_AUTO_RETRIES = 5;
/** Cap how long we honor a provider Retry-After before falling back. */
const MAX_PROVIDER_RETRY_AFTER_MS = 120_000;
const MIN_PROVIDER_RETRY_AFTER_MS = 500;
/** Default wait for rate-limit / quota when no Retry-After is present. */
const DEFAULT_RATE_LIMIT_RETRY_MS = 15_000;

export type ProviderRecoveryOutcome =
  | { readonly type: 'auto_retry' }
  | { readonly type: 'user_retry' }
  | { readonly type: 'switch'; readonly modelAlias: string }
  | { readonly type: 'pause' };

export interface ProviderRecoveryState {
  autoRetryCount: number;
  userPrompted: boolean;
}

export interface FailoverModelOption {
  readonly alias: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly displayName?: string;
}

const FAILOVER_QUESTION =
  'The model provider returned a temporary error. How should we continue?';

export function isRetryableProviderFailure(error: LioraErrorPayload | undefined): boolean {
  if (error === undefined) return false;
  if (error.retryable === true) return true;
  return (
    error.code === ErrorCodes.PROVIDER_RATE_LIMIT ||
    error.code === ErrorCodes.PROVIDER_CONNECTION_ERROR ||
    error.code === ErrorCodes.PROVIDER_API_ERROR
  );
}

export function isRateLimitOrQuotaFailure(error: LioraErrorPayload | undefined): boolean {
  if (error === undefined) return false;
  if (error.code === ErrorCodes.PROVIDER_RATE_LIMIT) return true;
  return isQuotaMessage(error.message);
}

export function listSwitchableFailoverModels(agent: Agent): readonly FailoverModelOption[] {
  const currentAlias = agent.config.modelAlias;
  if (currentAlias === undefined) return [];
  const config = agent.kimiConfig;
  if (config?.models === undefined) return [];

  const fallbacks = config.models[currentAlias]?.fallbackModels ?? [];
  const options: FailoverModelOption[] = [];
  const seen = new Set<string>([currentAlias]);

  for (const alias of fallbacks) {
    if (seen.has(alias)) continue;
    const modelConfig = config.models[alias];
    if (modelConfig === undefined) continue;
    seen.add(alias);
    options.push({
      alias,
      providerName: modelConfig.provider,
      modelId: modelConfig.model,
      displayName: modelConfig.displayName,
    });
  }
  return options;
}

export async function resolveProviderRecovery(
  agent: Agent,
  input: {
    readonly error: LioraErrorPayload;
    readonly turnId: number;
    readonly signal: AbortSignal;
    readonly state: ProviderRecoveryState;
  },
): Promise<ProviderRecoveryOutcome> {
  const rateLimited = isRateLimitOrQuotaFailure(input.error);
  const maxAutoRetries = rateLimited
    ? GOAL_PROVIDER_RATE_LIMIT_AUTO_RETRIES
    : GOAL_PROVIDER_AUTO_RETRIES;

  if (input.state.autoRetryCount < maxAutoRetries) {
    const delayMs = resolveProviderRetryDelayMs(input.error, input.state.autoRetryCount, rateLimited);
    await sleepForRetry(delayMs, input.signal);
    return { type: 'auto_retry' };
  }

  if (input.state.userPrompted) {
    return { type: 'pause' };
  }

  const fallbacks = listSwitchableFailoverModels(agent);
  // Prefer silent model switch after auto-retries so Ultrawork/goal runs keep
  // moving without blocking on a human when a fallback is configured.
  if (fallbacks.length > 0) {
    return { type: 'switch', modelAlias: fallbacks[0]!.alias };
  }

  if (agent.rpc?.requestQuestion === undefined) {
    // No interactive prompt available. Keep retrying rate-limits a bit longer;
    // the auto-retry budget above already handled the primary wait window.
    return { type: 'pause' };
  }

  return requestProviderFailoverChoice(agent, {
    error: input.error,
    turnId: input.turnId,
    signal: input.signal,
    currentAlias: agent.config.modelAlias ?? 'current',
    fallbacks,
  });
}

/**
 * Prefer the provider's Retry-After / retryAfterMs, then exponential backoff.
 * Rate-limit failures use a longer default so Ultrawork does not thrash.
 */
export function resolveProviderRetryDelayMs(
  error: LioraErrorPayload,
  autoRetryCount: number,
  rateLimited: boolean,
): number {
  const retryAfter = extractRetryAfterMs(error);
  if (retryAfter !== undefined) {
    return clampRetryDelayMs(retryAfter);
  }

  if (rateLimited) {
    // 15s, 30s, 60s, 90s, 120s …
    const scaled = DEFAULT_RATE_LIMIT_RETRY_MS * Math.pow(2, Math.min(autoRetryCount, 3));
    return clampRetryDelayMs(scaled);
  }

  const delays = retryBackoffDelays(GOAL_PROVIDER_AUTO_RETRIES + 1);
  return delays[autoRetryCount] ?? delays.at(-1) ?? 1000;
}

export function extractRetryAfterMs(error: LioraErrorPayload): number | undefined {
  const details = error.details;
  if (details === undefined) return undefined;

  const direct = details['retryAfterMs'];
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const retryAt = details['retryAt'];
  if (typeof retryAt === 'number' && Number.isFinite(retryAt)) {
    const remaining = retryAt - Date.now();
    if (remaining > 0) return remaining;
  }

  const retryAfter = details['retryAfter'];
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
    // Providers sometimes report seconds.
    return retryAfter < 1_000 ? retryAfter * 1000 : retryAfter;
  }
  if (typeof retryAfter === 'string' && retryAfter.trim().length > 0) {
    const asNumber = Number(retryAfter);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber < 1_000 ? asNumber * 1000 : asNumber;
    }
  }

  return undefined;
}

function clampRetryDelayMs(delayMs: number): number {
  return Math.min(Math.max(Math.ceil(delayMs), MIN_PROVIDER_RETRY_AFTER_MS), MAX_PROVIDER_RETRY_AFTER_MS);
}

const QUOTA_MESSAGE_PATTERNS = [
  /insufficient[_\s-]?quota/i,
  /quota\s+exceed/i,
  /exceed(?:ed|s|ing)?\s+(?:your\s+)?(?:current\s+)?quota/i,
  /credit[_\s-]?balance[_\s-]?too[_\s-]?low/i,
  /credit balance is too low/i,
  /insufficient.*(?:credit|balance|funds|quota)/i,
  /(?:credit|credits).*(?:exhausted|depleted|expired|limit|spent)/i,
  /(?:no|zero)\s+(?:credit|credits)\s+(?:remaining|left|available)/i,
  /usage.*limit.*(?:reached|exceed)/i,
  /spend.*limit.*(?:reached|exceed)/i,
  /billing.*(?:limit|quota|credit|payment)/i,
  /monthly.*(?:budget|spend).*limit/i,
  /hard[_\s-]?limit/i,
  /rate[_\s-]?limit/i,
  /too many requests/i,
] as const;

function isQuotaMessage(message: string | undefined): boolean {
  if (message === undefined || message.length === 0) return false;
  return QUOTA_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

async function requestProviderFailoverChoice(
  agent: Agent,
  input: {
    readonly error: LioraErrorPayload;
    readonly turnId: number;
    readonly signal: AbortSignal;
    readonly currentAlias: string;
    readonly fallbacks: readonly FailoverModelOption[];
  },
): Promise<ProviderRecoveryOutcome> {
  const choiceByLabel = new Map<string, ProviderRecoveryOutcome>();
  const options: QuestionOption[] = [];

  for (const [index, fallback] of input.fallbacks.entries()) {
    const label = failoverOptionLabel(fallback, index === 0);
    choiceByLabel.set(label, { type: 'switch', modelAlias: fallback.alias });
    options.push({
      label,
      description: `${fallback.providerName} · ${fallback.modelId}`,
    });
  }

  const retryLabel = 'Retry current model';
  choiceByLabel.set(retryLabel, { type: 'user_retry' });
  options.push({
    label: retryLabel,
    description: 'Try the same model one more time.',
  });

  const pauseLabel = 'Pause work for now';
  choiceByLabel.set(pauseLabel, { type: 'pause' });
  options.push({
    label: pauseLabel,
    description: 'Stop the goal and wait for manual resume.',
  });

  try {
    const result = await agent.rpc!.requestQuestion!(
      {
        turnId: input.turnId,
        questions: [
          {
            question: FAILOVER_QUESTION,
            header: 'Provider',
            body: formatFailoverQuestionBody(input.error, input.currentAlias),
            options,
          },
        ],
      },
      { signal: input.signal },
    );
    return parseFailoverAnswer(result, choiceByLabel);
  } catch (error) {
    if (isAbortError(error) || input.signal.aborted) throw error;
    return { type: 'pause' };
  }
}

function failoverOptionLabel(fallback: FailoverModelOption, recommended: boolean): string {
  const name = fallback.displayName ?? fallback.alias;
  return recommended ? `Switch to ${name} (Recommended)` : `Switch to ${name}`;
}

function formatFailoverQuestionBody(error: LioraErrorPayload, currentAlias: string): string {
  const message = error.message?.trim();
  const detail = message === undefined || message.length === 0 ? error.code : message;
  return `Current model: ${currentAlias}\nError: ${detail}`;
}

function parseFailoverAnswer(
  result: QuestionResult,
  choiceByLabel: Map<string, ProviderRecoveryOutcome>,
): ProviderRecoveryOutcome {
  const answers = normalizeQuestionAnswers(result);
  if (answers === undefined) return { type: 'pause' };
  const selected = Object.values(answers)[0];
  if (typeof selected !== 'string') return { type: 'pause' };
  return choiceByLabel.get(selected) ?? { type: 'pause' };
}


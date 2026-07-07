import type { Agent } from '.';
import { ErrorCodes, type LioraErrorPayload } from '../errors';
import { isAbortError } from '../loop/errors';
import { retryBackoffDelays, sleepForRetry } from '../loop/retry';
import type { QuestionOption, QuestionResult } from '../rpc';

export const GOAL_PROVIDER_AUTO_RETRIES = 2;

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
  if (input.state.autoRetryCount < GOAL_PROVIDER_AUTO_RETRIES) {
    const delays = retryBackoffDelays(GOAL_PROVIDER_AUTO_RETRIES + 1);
    const delayMs = delays[input.state.autoRetryCount] ?? delays.at(-1) ?? 1000;
    await sleepForRetry(delayMs, input.signal);
    return { type: 'auto_retry' };
  }

  if (input.state.userPrompted) {
    return { type: 'pause' };
  }

  const fallbacks = listSwitchableFailoverModels(agent);
  if (fallbacks.length === 0 || agent.rpc?.requestQuestion === undefined) {
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

function normalizeQuestionAnswers(
  result: QuestionResult,
): Record<string, string | true> | undefined {
  if (result === null) return undefined;
  if (typeof result === 'object' && Object.hasOwn(result, 'answers')) {
    return (result as { readonly answers: Record<string, string | true> }).answers;
  }
  return result;
}

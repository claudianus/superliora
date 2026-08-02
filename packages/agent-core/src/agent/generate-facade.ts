/**
 * Generate proxy with shared failover + LLM route building.
 * Extracted from Agent class to reduce God Class size.
 */
import { generate, type GenerateCallbacks, type StreamedMessagePart } from '@superliora/kosong';
import { resolveCompletionBudget } from '../utils/completion-budget';
import { runSideGenerateWithSharedFailover } from './side-generate-failover';
import { attachLlmProviderCircuitBreakers } from './llm-provider-circuit-breaker';
import { splitGenerateOptions } from './llm-request-logger';
import type { KosongLLMRoute, KosongLLMRouteCandidate } from './turn/kosong-llm';
import type { Agent } from './index';

export function createGenerateProxy(agent: Agent): typeof generate {
  return async (provider, systemPrompt, tools, history, callbacks, options) => {
    const { requestLogFields, runtimeModelAlias, runtimeCredentialLabel, generateOptions } =
      splitGenerateOptions(options);
    const modelAlias = runtimeModelAlias ?? agent.config.modelAlias;
    const run = (
      requestProvider: typeof provider,
      requestModelAlias: string | undefined,
      requestOptions: Parameters<typeof generate>[5],
    ) =>
      runLoggedGenerate(agent, {
        provider: requestProvider,
        modelAlias: requestModelAlias,
        systemPrompt,
        tools,
        history,
        callbacks,
        requestOptions,
        requestLogFields,
      });

    // Explicit auth: caller owns credential selection (including KosongLLM
    // after it already picked a candidate). Do not open a second failover loop.
    if (generateOptions?.auth !== undefined || runtimeCredentialLabel !== undefined) {
      if (generateOptions?.auth !== undefined) {
        return run(provider, modelAlias, generateOptions);
      }
      const withAuth =
        modelAlias === undefined
          ? undefined
          : agent.modelProvider?.resolveAuth?.(modelAlias, {
              log: agent.log,
              credentialLabel: runtimeCredentialLabel,
            });
      if (withAuth === undefined) {
        return run(provider, modelAlias, generateOptions);
      }
      return withAuth((auth) => run(provider, modelAlias, { ...generateOptions, auth }));
    }

    // Side LLM path (Ultra Plan Seed Spec, ambiguity, classifiers, dream…):
    // share the main-turn candidate order + routeState so a quota-exhausted
    // primary account fails over to the next healthy credential.
    const route = buildLLMRoute(agent, agent.kimiConfig?.loopControl?.reservedContextSize);
    if (route === undefined || route.candidates.length <= 1) {
      const withAuth =
        modelAlias === undefined
          ? undefined
          : agent.modelProvider?.resolveAuth?.(modelAlias, {
              log: agent.log,
            });
      if (withAuth === undefined) {
        return run(provider, modelAlias, generateOptions);
      }
      return withAuth((auth) => run(provider, modelAlias, { ...generateOptions, auth }));
    }

    return generateWithSharedFailover(agent, {
      route,
      fallbackProvider: provider,
      fallbackModelAlias: modelAlias,
      systemPrompt,
      tools,
      history,
      callbacks,
      generateOptions,
      requestLogFields,
      signal: generateOptions?.signal,
    });
  };
}

export function generateWithSharedFailover(agent: Agent, params: {
  readonly route: KosongLLMRoute;
  readonly fallbackProvider: Parameters<typeof generate>[0];
  readonly fallbackModelAlias: string | undefined;
  readonly systemPrompt: string;
  readonly tools: Parameters<typeof generate>[2];
  readonly history: Parameters<typeof generate>[3];
  readonly callbacks: Parameters<typeof generate>[4];
  readonly generateOptions: Parameters<typeof generate>[5];
  readonly requestLogFields: ReturnType<typeof splitGenerateOptions>['requestLogFields'];
  readonly signal?: AbortSignal;
}): Promise<Awaited<ReturnType<typeof generate>>> {
  const attempts = params.route.candidates.map((candidate) => {
    const candidateAlias = candidate.modelAlias ?? params.fallbackModelAlias;
    return {
      candidate,
      run: async () => {
        const withAuth =
          candidateAlias === undefined
            ? undefined
            : agent.modelProvider?.resolveAuth?.(candidateAlias, {
                log: agent.log,
                credentialLabel: candidate.credentialLabel,
              });

        const runOnce = (requestOptions: Parameters<typeof generate>[5]) =>
          runLoggedGenerate(agent, {
            provider: candidate.provider,
            modelAlias: candidateAlias,
            systemPrompt: params.systemPrompt,
            tools: params.tools,
            history: params.history,
            callbacks: params.callbacks,
            requestOptions,
            requestLogFields: params.requestLogFields,
          });

        if (withAuth === undefined) {
          return runOnce(params.generateOptions);
        }
        return withAuth((auth) => runOnce({ ...params.generateOptions, auth }));
      },
    };
  });

  return runSideGenerateWithSharedFailover({
    route: params.route,
    routeState: agent.providerRouteState,
    attempts,
    signal: params.signal,
    onRouteStatusChanged: () => {
      agent.emitStatusUpdated();
    },
    circuitObserver: attachLlmProviderCircuitBreakers(agent, () => {
      agent.emitStatusUpdated();
    }),
    onCandidateFailed: ({ candidate, failure, hasNext }) => {
      if (!hasNext) return;
      agent.log.warn('side generate credential failed; trying next candidate', {
        failedCredential: candidate.credentialLabel,
        failedModel: candidate.modelAlias,
        kind: failure.kind,
      });
    },
  });
}

/**
 * One generate call with lifecycle logs:
 * `llm request` → `llm open` → `llm first_token` → (`llm response` elsewhere) / `llm request failed`.
 */
async function runLoggedGenerate(
  agent: Agent,
  input: {
    readonly provider: Parameters<typeof generate>[0];
    readonly modelAlias: string | undefined;
    readonly systemPrompt: string;
    readonly tools: Parameters<typeof generate>[2];
    readonly history: Parameters<typeof generate>[3];
    readonly callbacks: Parameters<typeof generate>[4];
    readonly requestOptions: Parameters<typeof generate>[5];
    readonly requestLogFields: ReturnType<typeof splitGenerateOptions>['requestLogFields'];
  },
): Promise<Awaited<ReturnType<typeof generate>>> {
  const requestId = agent.llmRequestLogger.logRequest({
    provider: input.provider,
    modelAlias: input.modelAlias,
    systemPrompt: input.systemPrompt,
    tools: input.tools,
    messages: input.history,
    fields: input.requestLogFields,
  });
  const startedAt = Date.now();
  let sawFirstToken = false;
  let opened = false;
  const fields = input.requestLogFields;

  const wrappedCallbacks = wrapLifecycleCallbacks(input.callbacks, () => {
    if (sawFirstToken) return;
    sawFirstToken = true;
    agent.llmRequestLogger.logFirstToken(requestId, {
      ...(fields ?? { turnStep: 'side' }),
      ttftMs: Date.now() - startedAt,
    });
  });

  const prevStart = input.requestOptions?.onRequestStart;
  const prevSent = input.requestOptions?.onRequestSent;
  const prevEnd = input.requestOptions?.onStreamEnd;
  const wrappedOptions: Parameters<typeof generate>[5] = {
    ...input.requestOptions,
    onRequestStart: () => {
      prevStart?.();
    },
    onRequestSent: () => {
      opened = true;
      agent.llmRequestLogger.logOpen(requestId, fields);
      prevSent?.();
    },
    onStreamEnd: (stats) => {
      prevEnd?.(stats);
    },
  };

  try {
    return await agent.rawGenerate(
      input.provider,
      input.systemPrompt,
      input.tools,
      input.history,
      wrappedCallbacks,
      wrappedOptions,
    );
  } catch (error: unknown) {
    const name = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    const phase =
      sawFirstToken ? 'stream' : opened ? 'first_token_wait' : 'open';
    // User cancel stays quiet — recovery already surfaces interruption.
    const aborted =
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError') ||
      input.requestOptions?.signal?.aborted === true;
    if (!aborted) {
      agent.llmRequestLogger.logFailure(requestId, {
        ...(fields ?? {}),
        errorName: name,
        errorMessage: message.slice(0, 300),
        elapsedMs: Date.now() - startedAt,
        phase,
      });
    }
    throw error;
  }
}

function wrapLifecycleCallbacks(
  callbacks: GenerateCallbacks | undefined,
  onFirstPart: () => void,
): GenerateCallbacks | undefined {
  if (callbacks === undefined) {
    return {
      onMessagePart: () => {
        onFirstPart();
      },
    };
  }
  const prev = callbacks.onMessagePart;
  return {
    ...callbacks,
    onMessagePart: async (part: StreamedMessagePart) => {
      onFirstPart();
      await prev?.(part);
    },
  };
}

export function buildLLMRoute(agent: Agent, reservedContextSize: number | undefined): KosongLLMRoute | undefined {
  const route = agent.config.providerRoute;
  if (route === undefined || route.candidates.length === 0) return undefined;
  return {
    key: route.modelAlias,
    strategy: route.strategy,
    cooldownMs: route.cooldownMs,
    sessionAffinity: route.sessionAffinity,
    preferredCredential: route.preferredCredential,
    candidates: route.candidates.map((candidate): KosongLLMRouteCandidate => {
      return {
        modelAlias: candidate.modelAlias,
        providerName: candidate.providerName,
        credentialLabel: candidate.credentialLabel,
        weight: candidate.weight,
        localLimits: candidate.localLimits,
        provider: agent.config.createRuntimeProvider(candidate),
        capability: candidate.modelCapabilities,
        completionBudgetConfig: resolveCompletionBudget({
          maxOutputSize: candidate.maxOutputSize,
          reservedContextSize,
        }),
      };
    }),
  };
}

/**
 * Generate proxy with shared failover + LLM route building.
 * Extracted from Agent class to reduce God Class size.
 */
import { generate } from '@superliora/kosong';
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
    ) => {
      agent.llmRequestLogger.logRequest({
        provider: requestProvider,
        modelAlias: requestModelAlias,
        systemPrompt,
        tools,
        messages: history,
        fields: requestLogFields,
      });
      return agent.rawGenerate(
        requestProvider,
        systemPrompt,
        tools,
        history,
        callbacks,
        requestOptions,
      );
    };

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

        const runOnce = (requestOptions: Parameters<typeof generate>[5]) => {
          agent.llmRequestLogger.logRequest({
            provider: candidate.provider,
            modelAlias: candidateAlias,
            systemPrompt: params.systemPrompt,
            tools: params.tools,
            messages: params.history,
            fields: params.requestLogFields,
          });
          return agent.rawGenerate(
            candidate.provider,
            params.systemPrompt,
            params.tools,
            params.history,
            params.callbacks,
            requestOptions,
          );
        };

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
    onRouteStatusChanged: () =>{  agent.emitStatusUpdated(); },
    circuitObserver: attachLlmProviderCircuitBreakers(agent, () =>{  agent.emitStatusUpdated(); }),
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

/**
 * Compaction summarizer provider — extracted from FullCompaction.
 *
 * Builds a logic-only ChatProvider (no tools, thinking off, cost-aware model).
 */

import {
  createProvider,
  type ChatProvider,
  type ModelCapability,
} from '@superliora/kosong';

import type { Agent } from '../..';
import type { ResolvedRuntimeProvider } from '../../../session/provider/provider-manager';
import {
  applyCompletionBudget,
  computeCompletionBudgetCap,
  resolveCompletionBudget,
} from '../../../utils/completion-budget';
import { resolveSmartRoute } from '../../routing';

const DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS = 128 * 1024;
export const COMPACTION_MIN_OUTPUT_TOKENS = 8_192;

export interface FullCompactionProviderHost {
  readonly agent: Agent;
  compactionModelAlias: string | undefined;
}

/**
 * Compaction is a logic-only summarizer slice (not a Subagent): no tools,
 * thinking off, cost-aware model when configured.
 */
export function createCompactionProvider(
  host: FullCompactionProviderHost,
  usedContextTokens: number,
): ChatProvider {
  const runtimeConfig = host.agent.runtimeConfig ?? host.agent.kimiConfig;
  // Dedicated compactionModel wins; otherwise smart auto (same scorer as
  // Settings → Model routing). Resolve through ModelProvider so auth stays consistent.
  const configuredCompactionModel = runtimeConfig?.loopControl?.compactionModel;
  const route =
    runtimeConfig !== undefined
      ? resolveSmartRoute({
          role: 'compaction',
          config: runtimeConfig,
          parentAlias: host.agent.config.modelAlias,
          minContextTokens: usedContextTokens > 0 ? usedContextTokens : undefined,
        })
      : undefined;
  const compactionModelAlias = route?.alias;
  host.compactionModelAlias =
    compactionModelAlias !== undefined && compactionModelAlias.length > 0
      ? compactionModelAlias
      : host.agent.config.modelAlias;
  let resolvedCompaction: ResolvedRuntimeProvider | undefined;
  if (compactionModelAlias !== undefined) {
    try {
      resolvedCompaction = host.agent.modelProvider?.resolveProviderConfig(compactionModelAlias);
    } catch (error) {
      // A misconfigured explicit compactionModel keeps surfacing; a merely
      // inferred alias falls back to the main model instead of failing
      // compaction.
      if (configuredCompactionModel !== undefined) throw error;
      host.agent.log.warn('inferred cheap compaction model did not resolve', error);
      resolvedCompaction = undefined;
      host.compactionModelAlias = host.agent.config.modelAlias;
    }
  }
  const capability: ModelCapability = resolvedCompaction?.modelCapabilities
    ?? host.agent.config.modelCapabilities;
  const maxContextTokens = capability.max_context_tokens;
  const defaultCompactionCap =
    maxContextTokens > 0
      ? Math.min(maxContextTokens, DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS)
      : undefined;
  const budget = resolveCompletionBudget({
    maxOutputSize: host.agent.config.maxOutputSize ?? defaultCompactionCap,
    reservedContextSize: runtimeConfig?.loopControl?.reservedContextSize,
  });
  // Compaction must emit visible summary text. Thinking models can spend the
  // entire output budget on reasoning alone, which kosong surfaces as
  // APIEmptyResponseError — the root cause of compaction.failed in production.
  const baseProvider =
    resolvedCompaction !== undefined
      ? createProvider(resolvedCompaction.provider)
      : host.agent.config.provider;
  const withoutThinking = baseProvider.withThinking('off');
  let provider = applyCompletionBudget({
    provider: withoutThinking,
    budget,
    capability,
    usedContextTokens,
  });
  if (provider.withMaxCompletionTokens !== undefined) {
    const configuredCap = computeCompletionBudgetCap({
      budget: budget ?? { fallback: COMPACTION_MIN_OUTPUT_TOKENS },
      capability,
    });
    provider = provider.withMaxCompletionTokens(
      Math.max(COMPACTION_MIN_OUTPUT_TOKENS, configuredCap),
      {
        usedContextTokens,
        maxContextTokens,
      },
    );
  }
  return provider;
}

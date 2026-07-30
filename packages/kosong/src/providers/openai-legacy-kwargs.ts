import type { OpenAILegacyGenerationKwargs } from './openai-legacy-types';

export function usesMaxCompletionTokens(model: string): boolean {
  const normalized = model.toLowerCase();
  return /^o\d(?:$|[-.])/.test(normalized) || /^gpt-5(?:$|[-.])/.test(normalized);
}

export function completionTokenKwargs(
  model: string,
  maxCompletionTokens: number,
): OpenAILegacyGenerationKwargs {
  return usesMaxCompletionTokens(model)
    ? { max_completion_tokens: maxCompletionTokens }
    : { max_tokens: maxCompletionTokens };
}

export function normalizeGenerationKwargs(
  model: string,
  source: OpenAILegacyGenerationKwargs,
): OpenAILegacyGenerationKwargs {
  const kwargs = { ...source };
  if (usesMaxCompletionTokens(model)) {
    if (kwargs.max_completion_tokens === undefined && kwargs.max_tokens !== undefined) {
      kwargs.max_completion_tokens = kwargs.max_tokens;
    }
    delete kwargs.max_tokens;
  }
  return kwargs;
}

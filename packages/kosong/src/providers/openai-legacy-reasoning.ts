import { KNOWN_REASONING_KEYS } from './openai-legacy-types';

export function extractReasoningContent(
  source: unknown,
  explicitKey: string | undefined,
): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const record = source as Record<string, unknown>;
  const keys: readonly string[] = explicitKey !== undefined ? [explicitKey] : KNOWN_REASONING_KEYS;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Models / gateways that reject OpenAI-style `reasoning_effort` (and camelCase
 * `reasoningEffort`) on chat.completions. xAI Grok Build (`grok-build-*` via
 * cli-chat-proxy) returns 400 if the param is present.
 */
export function modelRejectsReasoningEffortParam(model: string): boolean {
  const normalized = model.toLowerCase().trim();
  if (normalized.length === 0) return false;
  // grok-build-0.1, grok-build-*, aliases containing grok-build
  if (normalized.includes('grok-build')) return true;
  // bare grok-build surface ids sometimes omit hyphenated suffix patterns
  if (/^grok-build(?:$|[-_.])/.test(normalized)) return true;
  return false;
}

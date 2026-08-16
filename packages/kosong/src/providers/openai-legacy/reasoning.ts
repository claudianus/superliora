import { KNOWN_REASONING_KEYS } from './types';

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
  const id = normalized.includes('/') ? (normalized.split('/').pop() ?? normalized) : normalized;
  // grok-build-0.1, grok-build-*, aliases containing grok-build
  if (normalized.includes('grok-build') || id.includes('grok-build')) return true;
  // bare grok-build surface ids sometimes omit hyphenated suffix patterns
  if (/^grok-build(?:$|[-_.])/.test(id)) return true;
  // Dated grok-4.20 chat SKUs 400 on OpenAI-style reasoningEffort
  // ("does not support parameter reasoningEffort"). Keep grok-4.5 / grok-4.6
  // on the existing withThinking path — those still accept the param.
  if (/^grok-4\.20(?:$|[-_.])/.test(id)) return true;
  return false;
}

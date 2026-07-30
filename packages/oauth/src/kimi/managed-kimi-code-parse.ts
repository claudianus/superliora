import { isRecord } from '../utils';
import type {
  ManagedKimiCodeModelInfo,
  ManagedKimiCodeProtocol,
  SupportsThinkingType,
} from './managed-kimi-code-types';

export function parseModelProtocol(value: unknown): ManagedKimiCodeProtocol | undefined {
  return value === 'anthropic' ? value : undefined;
}

export function parseStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
  return out.length > 0 ? out : undefined;
}

function parseNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Unknown or missing values resolve to undefined so callers fall back to the
// legacy supports_reasoning boolean instead of guessing.
export function parseSupportsThinkingType(value: unknown): SupportsThinkingType | undefined {
  return value === 'only' || value === 'no' || value === 'both' ? value : undefined;
}

export function parseThinkEfforts(value: unknown): {
  supportEfforts: readonly string[] | undefined;
  defaultEffort: string | undefined;
} {
  if (!isRecord(value) || value['support'] !== true) {
    return { supportEfforts: undefined, defaultEffort: undefined };
  }
  return {
    supportEfforts: parseStringArray(value['valid_efforts']),
    defaultEffort: parseNonEmptyString(value['default_effort']),
  };
}

export function toModelInfo(item: unknown): ManagedKimiCodeModelInfo | undefined {
  if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'].length === 0) {
    return undefined;
  }
  const contextLength = Number(item['context_length']);
  if (!Number.isInteger(contextLength) || contextLength <= 0) {
    throw new Error(`SuperLiora model "${item['id']}" must include a positive context_length.`);
  }
  const displayName = item['display_name'];
  const normalizedDisplayName =
    typeof displayName === 'string' && displayName.length > 0 ? displayName : undefined;
  const supportsToolUse = Object.hasOwn(item, 'supports_tool_use')
    ? Boolean(item['supports_tool_use'])
    : true;
  const thinkEfforts = parseThinkEfforts(item['think_efforts']);
  return {
    id: item['id'],
    contextLength,
    supportsReasoning: Boolean(item['supports_reasoning']),
    supportsImageIn: Boolean(item['supports_image_in']),
    supportsVideoIn: Boolean(item['supports_video_in']),
    supportsToolUse,
    supportsThinkingType: parseSupportsThinkingType(item['supports_thinking_type']),
    supportEfforts: thinkEfforts.supportEfforts ?? parseStringArray(item['support_efforts']),
    defaultEffort:
      thinkEfforts.defaultEffort ?? parseNonEmptyString(item['default_effort']),
    displayName: normalizedDisplayName,
    protocol: parseModelProtocol(item['protocol']),
  };
}

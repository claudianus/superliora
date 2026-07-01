import type { ThinkingEffort } from '@moonshot-ai/kosong';

import type { ThinkingConfig } from '../../config/schema';

export type { ThinkingEffort };

const DEFAULT_THINKING_EFFORT: ThinkingEffort = 'high';

const THINKING_EFFORTS = new Set<ThinkingEffort>(['low', 'medium', 'high', 'xhigh', 'max']);

export interface ThinkingModelDefaults {
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
}

export interface ResolveThinkingLevelOptions {
  readonly defaultThinking?: boolean | undefined;
  readonly thinking?: ThinkingConfig | undefined;
  readonly model?: ThinkingModelDefaults;
}

export function resolveThinkingLevel(
  requestedThinking: string | undefined,
  options: ResolveThinkingLevelOptions,
): ThinkingEffort {
  const resolvedRequest =
    requestedThinking !== undefined && requestedThinking.trim().length > 0
      ? requestedThinking
      : options.defaultThinking === false
        ? 'off'
        : undefined;

  return resolveThinkingEffort(resolvedRequest, options.thinking, options.model);
}

export function resolveThinkingEffort(
  requested: string | undefined,
  defaults: ThinkingConfig | undefined,
  model?: ThinkingModelDefaults,
): ThinkingEffort {
  const configEffort =
    parseEffort(defaults?.effort) ?? defaultThinkingEffortFor(model);
  const normalized = requested?.trim().toLowerCase();
  if (!normalized) {
    if (defaults?.mode === 'off') return 'off';
    return configEffort;
  }
  if (normalized === 'off') return 'off';
  if (normalized === 'on') return configEffort;
  return parseEffort(normalized) ?? configEffort;
}

export function defaultThinkingEffortFor(
  model: ThinkingModelDefaults | undefined,
): ThinkingEffort {
  const modelDefault = parseEffort(model?.defaultEffort);
  if (modelDefault !== undefined) return modelDefault;

  const supportEfforts = model?.supportEfforts
    ?.map((effort) => parseEffort(effort))
    .filter((effort): effort is ThinkingEffort => effort !== undefined);
  if (supportEfforts !== undefined && supportEfforts.length > 0) {
    return supportEfforts[Math.floor(supportEfforts.length / 2)] ?? DEFAULT_THINKING_EFFORT;
  }

  return DEFAULT_THINKING_EFFORT;
}

function parseEffort(value: string | undefined): ThinkingEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized !== undefined && THINKING_EFFORTS.has(normalized as ThinkingEffort)
    ? (normalized as ThinkingEffort)
    : undefined;
}

import type { ThinkingEffort } from '@superliora/kosong';

import type { ThinkingConfig } from '../../config/schema';

export type { ThinkingEffort };

const DEFAULT_THINKING_EFFORT: ThinkingEffort = 'high';

const THINKING_EFFORT_ORDER: readonly ThinkingEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

const THINKING_EFFORTS = new Set<ThinkingEffort>(THINKING_EFFORT_ORDER);

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
    return clampEffortToModelSupport(configEffort, model);
  }
  if (normalized === 'off') return 'off';
  if (normalized === 'on') return clampEffortToModelSupport(configEffort, model);
  const parsed = parseEffort(normalized);
  if (parsed === undefined) return clampEffortToModelSupport(configEffort, model);
  return clampEffortToModelSupport(parsed, model);
}

export function defaultThinkingEffortFor(
  model: ThinkingModelDefaults | undefined,
): ThinkingEffort {
  const modelDefault = parseEffort(model?.defaultEffort);
  if (modelDefault !== undefined) {
    return clampEffortToModelSupport(modelDefault, model);
  }

  const supportEfforts = supportedEffortsFor(model);
  if (supportEfforts !== undefined && supportEfforts.length > 0) {
    return supportEfforts[Math.floor(supportEfforts.length / 2)] ?? DEFAULT_THINKING_EFFORT;
  }

  return DEFAULT_THINKING_EFFORT;
}

/**
 * When a model declares `supportEfforts`, snap unsupported levels onto the
 * nearest supported rung (prefer lower, then higher). Without a declaration
 * the effort is returned unchanged.
 */
export function clampEffortToModelSupport(
  effort: ThinkingEffort,
  model: ThinkingModelDefaults | undefined,
): ThinkingEffort {
  if (effort === 'off') return 'off';
  const support = supportedEffortsFor(model);
  if (support === undefined || support.length === 0) return effort;
  if (support.includes(effort)) return effort;

  const idx = THINKING_EFFORT_ORDER.indexOf(effort);
  if (idx < 0) return support.at(-1) ?? DEFAULT_THINKING_EFFORT;
  for (let i = idx; i >= 0; i--) {
    const candidate = THINKING_EFFORT_ORDER[i]!;
    if (support.includes(candidate)) return candidate;
  }
  for (let i = idx + 1; i < THINKING_EFFORT_ORDER.length; i++) {
    const candidate = THINKING_EFFORT_ORDER[i]!;
    if (support.includes(candidate)) return candidate;
  }
  return support.at(-1) ?? DEFAULT_THINKING_EFFORT;
}

function supportedEffortsFor(
  model: ThinkingModelDefaults | undefined,
): ThinkingEffort[] | undefined {
  const supportEfforts = model?.supportEfforts
    ?.map((effort) => parseEffort(effort))
    .filter((effort): effort is ThinkingEffort => effort !== undefined);
  if (supportEfforts === undefined || supportEfforts.length === 0) return undefined;
  return supportEfforts;
}

function parseEffort(value: string | undefined): ThinkingEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized !== undefined && THINKING_EFFORTS.has(normalized as ThinkingEffort)
    ? (normalized as ThinkingEffort)
    : undefined;
}

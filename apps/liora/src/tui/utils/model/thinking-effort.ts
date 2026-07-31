/**
 * Thinking-effort helpers shared by the model picker, footer, and welcome UI.
 *
 * Goals:
 * - Prefer each model's declared `supportEfforts` when present.
 * - When absent, offer a provider-aware list (not the full abstract ladder).
 * - Surface clamp/mapping transparently: `max→high`, `max→xhigh`, etc.
 */

import type { ModelAlias } from '@superliora/sdk';

/** Full abstract ladder used for nearest-neighbour clamping. */
export const THINKING_EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingEffortName = (typeof THINKING_EFFORT_ORDER)[number];

const EFFORT_SET = new Set<string>(THINKING_EFFORT_ORDER);

export type ProviderThinkingFamily = 'kimi' | 'openai' | 'anthropic' | 'gemini' | 'unknown';

/** Conservative defaults when a model does not declare `supportEfforts`. */
const DEFAULT_EFFORTS_BY_FAMILY: Record<ProviderThinkingFamily, readonly ThinkingEffortName[]> = {
  // Kimi wire maps xhigh/max → high, so offering them is misleading.
  kimi: ['low', 'medium', 'high'],
  // OpenAI maps max → xhigh; expose the wire name, not a duplicate max.
  openai: ['low', 'medium', 'high', 'xhigh'],
  // Anthropic support is model-specific; keep the full ladder when unknown.
  anthropic: ['low', 'medium', 'high', 'xhigh', 'max'],
  // Gemini clamps above high to high.
  gemini: ['low', 'medium', 'high'],
  // OpenAI-compatible custom endpoints often only accept low/medium/high.
  unknown: ['low', 'medium', 'high'],
};

export function parseThinkingEffort(value: string | undefined): ThinkingEffortName | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) return undefined;
  return EFFORT_SET.has(normalized) ? (normalized as ThinkingEffortName) : undefined;
}

export function providerThinkingFamily(provider: string | undefined): ProviderThinkingFamily {
  const id = (provider ?? '').trim().toLowerCase();
  if (id.length === 0) return 'unknown';
  if (
    id.includes('kimi') ||
    id.startsWith('managed:kimi') ||
    id.includes('moonshot')
  ) {
    return 'kimi';
  }
  if (id.includes('anthropic') || id.includes('claude')) return 'anthropic';
  if (id.includes('gemini') || id.includes('google')) return 'gemini';
  if (
    id.includes('openai') ||
    id.includes('azure') ||
    id.includes('openrouter') ||
    id.includes('groq') ||
    id.includes('together') ||
    id.includes('deepseek') ||
    id.includes('xai') ||
    id.includes('fireworks')
  ) {
    return 'openai';
  }
  return 'unknown';
}

/**
 * Effort choices for a model: declared supportEfforts when present, otherwise
 * a provider-family default that matches what the adapter can actually send.
 */
export function effortsForModel(model: ModelAlias | undefined): readonly ThinkingEffortName[] {
  const declared = model?.supportEfforts
    ?.map((effort) => parseThinkingEffort(effort))
    .filter((effort): effort is ThinkingEffortName => effort !== undefined);
  if (declared !== undefined && declared.length > 0) {
    // Keep declared order, drop unknowns already filtered.
    return declared;
  }
  return DEFAULT_EFFORTS_BY_FAMILY[providerThinkingFamily(model?.provider)];
}

export function defaultEffortForModel(model: ModelAlias | undefined): ThinkingEffortName {
  const declared = parseThinkingEffort(model?.defaultEffort);
  const supported = effortsForModel(model);
  if (declared !== undefined && supported.includes(declared)) return declared;
  if (supported.includes('high')) return 'high';
  return supported[Math.floor(supported.length / 2)] ?? 'high';
}

/**
 * Snap an effort onto the model's supported list (nearest lower, else nearest higher).
 */
export function clampEffortToModel(
  effort: string | undefined,
  model: ModelAlias | undefined,
): ThinkingEffortName | 'off' {
  const normalized = effort?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return defaultEffortForModel(model);
  }
  if (normalized === 'off') return 'off';
  if (normalized === 'on') return defaultEffortForModel(model);

  const parsed = parseThinkingEffort(normalized);
  const supported = effortsForModel(model);
  if (parsed === undefined) return defaultEffortForModel(model);
  if (supported.includes(parsed)) return parsed;

  const idx = THINKING_EFFORT_ORDER.indexOf(parsed);
  for (let i = idx; i >= 0; i--) {
    const candidate = THINKING_EFFORT_ORDER[i]!;
    if (supported.includes(candidate)) return candidate;
  }
  for (let i = idx + 1; i < THINKING_EFFORT_ORDER.length; i++) {
    const candidate = THINKING_EFFORT_ORDER[i]!;
    if (supported.includes(candidate)) return candidate;
  }
  return supported.at(-1) ?? 'high';
}

/**
 * What the transport adapter typically sends for this effort on this provider.
 * Matches kosong provider clamps (Kimi/Gemini high ceiling, OpenAI max→xhigh).
 */
export function wireEffortForModel(
  effort: string | undefined,
  model: ModelAlias | undefined,
): string {
  const clamped = clampEffortToModel(effort, model);
  if (clamped === 'off') return 'off';

  const family = providerThinkingFamily(model?.provider);
  switch (family) {
    case 'kimi':
    case 'gemini':
      if (clamped === 'xhigh' || clamped === 'max') return 'high';
      return clamped;
    case 'openai':
      if (clamped === 'max') return 'xhigh';
      return clamped;
    case 'anthropic':
    case 'unknown':
    default:
      return clamped;
  }
}

export interface ThinkingDisplay {
  /** Session / requested level after model clamp (`off` when disabled). */
  readonly requested: string;
  /** Typical wire-level value the provider adapter will send. */
  readonly effective: string;
  /**
   * Compact UI token:
   * - `off` when disabled
   * - `high` when request and wire match
   * - `max→high` when clamped/mapped
   */
  readonly label: string;
}

/**
 * Build a transparent thinking label for chrome (footer / welcome / status).
 */
export function resolveThinkingDisplay(
  level: string | undefined,
  options: {
    readonly thinking?: boolean;
    readonly model?: ModelAlias;
  } = {},
): ThinkingDisplay {
  const raw =
    level !== undefined && level.trim().length > 0
      ? level.trim().toLowerCase()
      : options.thinking === true
        ? 'on'
        : 'off';

  if (raw === 'off' || (raw !== 'on' && options.thinking === false && level === undefined)) {
    if (raw === 'off' || options.thinking === false) {
      return { requested: 'off', effective: 'off', label: 'off' };
    }
  }

  if (raw === 'off') {
    return { requested: 'off', effective: 'off', label: 'off' };
  }

  const requested = clampEffortToModel(raw, options.model);
  if (requested === 'off') {
    return { requested: 'off', effective: 'off', label: 'off' };
  }
  const effective = wireEffortForModel(requested, options.model);
  const label = requested === effective ? requested : `${requested}→${effective}`;
  return { requested, effective, label };
}

/** Footer-style suffix: ` high` / ` max→high` / `` when off. */
export function formatThinkingLevelSuffix(
  level: string | undefined,
  options: {
    readonly thinking?: boolean;
    readonly model?: ModelAlias;
  } = {},
): string {
  const display = resolveThinkingDisplay(level, options);
  if (display.label === 'off') {
    // Keep footer quiet when thinking is off (previous UX showed nothing).
    return options.thinking === true ? ' on' : '';
  }
  return ` ${display.label}`;
}

/** Welcome / status style: `Kimi K2 · max→high`. */
export function formatModelWithThinking(
  modelName: string,
  level: string | undefined,
  options: {
    readonly thinking?: boolean;
    readonly model?: ModelAlias;
  } = {},
): string {
  const display = resolveThinkingDisplay(level, options);
  if (display.label === 'off') {
    return options.thinking === true ? `${modelName} · on` : modelName;
  }
  return `${modelName} · ${display.label}`;
}

/**
 * Resolve the concrete level to send via `setThinking` from a picker choice.
 * Returns `off` when thinking is disabled; otherwise a concrete effort name.
 */
export function resolveThinkingLevelForApply(
  thinking: boolean,
  effort: string | undefined,
  model: ModelAlias | undefined,
): string {
  if (!thinking) return 'off';
  const source = effort !== undefined && effort.trim().length > 0 ? effort : 'on';
  const resolved = clampEffortToModel(source, model);
  return resolved === 'off' ? defaultEffortForModel(model) : resolved;
}

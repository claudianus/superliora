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

/** Cursor embeds the reasoning variant in the model id instead of accepting a
 * separate thinking-effort request field. */
export function modelUsesEmbeddedThinkingEffort(
  model:
    | {
        readonly provider?: string;
        readonly capabilities?: readonly string[];
        readonly adaptiveThinking?: boolean;
      }
    | undefined,
): boolean {
  const provider = model?.provider?.trim().toLowerCase();
  if (provider !== 'cursor-oauth' && provider !== 'cursor') return false;
  const capabilities = model?.capabilities;
  if (capabilities === undefined) return true;
  return (
    capabilities.some((capability) => capability.trim().toLowerCase() === 'thinking') ||
    capabilities.some((capability) => capability.trim().toLowerCase() === 'always_thinking') ||
    model?.adaptiveThinking === true
  );
}

/** Conservative defaults when a model does not declare `supportEfforts`. */
const DEFAULT_EFFORTS_BY_FAMILY: Record<ProviderThinkingFamily, readonly ThinkingEffortName[]> = {
  // Kimi wire maps xhigh/max → high, so offering them is misleading.
  kimi: ['low', 'medium', 'high'],
  // OpenAI maps max → xhigh; expose the wire name, not a duplicate max.
  openai: ['low', 'medium', 'high', 'xhigh'],
  // Anthropic support is model-specific; only catalog-declared models expose
  // xhigh/max so an unavailable catalog does not advertise false controls.
  anthropic: ['low', 'medium', 'high'],
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
  if (modelUsesEmbeddedThinkingEffort(model)) return [];
  const declared = model?.supportEfforts
    ?.map((effort) => parseThinkingEffort(effort))
    .filter((effort): effort is ThinkingEffortName => effort !== undefined);
  if (declared !== undefined) {
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

  // A Kimi alias can route through Anthropic's adaptive protocol; use the
  // effective wire protocol instead of the provider label in that case.
  const family = model?.protocol === 'anthropic'
    ? 'anthropic'
    : providerThinkingFamily(model?.provider);
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
  if (modelUsesEmbeddedThinkingEffort(options.model) && options.thinking !== false) {
    return { requested: 'on', effective: 'on', label: 'on' };
  }

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
  if (modelUsesEmbeddedThinkingEffort(options.model)) return '';
  const display = resolveThinkingDisplay(level, options);
  if (display.label === 'off') {
    // Keep footer quiet when thinking is off (previous UX showed nothing).
    return options.thinking === true ? ' on' : '';
  }
  return ` ${display.label}`;
}

/**
 * Short human chip for chrome (header / status). Avoids raw model-id fragments
 * like `non-reasoning`. Korean when locale starts with `ko`.
 */
export function formatThinkingLevelChip(
  level: string | undefined,
  options: {
    readonly thinking?: boolean;
    readonly model?: ModelAlias;
    readonly locale?: string;
  } = {},
): string | undefined {
  if (modelUsesEmbeddedThinkingEffort(options.model)) {
    // Cursor embeds reasoning in the model id; still show a human chip when on.
    if (options.thinking === false) {
      return (options.locale ?? '').toLowerCase().startsWith('ko') ? '비추론' : 'non-reasoning';
    }
    return (options.locale ?? '').toLowerCase().startsWith('ko') ? '추론' : 'reasoning';
  }
  const display = resolveThinkingDisplay(level, options);
  const ko = (options.locale ?? '').toLowerCase().startsWith('ko');
  if (display.label === 'off') {
    if (options.thinking === true) return ko ? '추론' : 'reasoning';
    // Quiet footer historically hid off; header always wants a chip when model is set.
    return ko ? '비추론' : 'non-reasoning';
  }
  if (display.effective === 'on') return ko ? '추론' : 'reasoning';
  if (ko) {
    switch (display.effective) {
      case 'low':
        return '추론·낮음';
      case 'medium':
        return '추론·중간';
      case 'high':
        return '추론·높음';
      case 'xhigh':
        return '추론·최고';
      case 'max':
        return '추론·최대';
      default:
        return `추론·${display.label}`;
    }
  }
  return display.label;
}

/** Welcome / status / header style: `Kimi K2 · 추론·높음`. */
export function formatModelWithThinking(
  modelName: string,
  level: string | undefined,
  options: {
    readonly thinking?: boolean;
    readonly model?: ModelAlias;
    readonly locale?: string;
    /** When true, always append a chip (including non-reasoning). Header uses this. */
    readonly alwaysShowLevel?: boolean;
  } = {},
): string {
  if (modelUsesEmbeddedThinkingEffort(options.model) && options.alwaysShowLevel !== true) {
    return modelName;
  }
  const chip = formatThinkingLevelChip(level, options);
  if (chip === undefined) return modelName;
  if (options.alwaysShowLevel !== true) {
    const display = resolveThinkingDisplay(level, options);
    if (display.label === 'off' && options.thinking !== true) return modelName;
  }
  return `${modelName} · ${chip}`;
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

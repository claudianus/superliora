import { annotateModelsWithCredentialHealth, type CredentialHealthStore } from '@superliora/oauth';

/**
 * Role-based model presets: automatically assign the best model for each task
 * role based on cost, speed, intelligence, and capability data from models.dev.
 *
 * Data sources:
 *   1. models.dev API — real pricing, context window, reasoning/tool/vision support
 *   2. Name-based heuristic fallback — when models.dev data is unavailable
 *
 * Auto-mapping: models.dev provides cost.input, cost.output, context_window,
 * and capability flags (reasoning, tools, vision). We classify models into
 * tiers using actual data instead of just name patterns, then assign the best
 * model for each role.
 *
 * Thinking level auto-config: planning/debugging roles get high reasoning,
 * coding gets moderate, compaction/exploration get minimal.
 */

/** Task roles that can have model assignments. */
export type ModelRole =
  | 'compaction'
  | 'completion'
  | 'exploration'
  | 'coding'
  | 'planning'
  | 'debugging';

export type ModelTier = 'ultra-cheap' | 'cheap' | 'balanced' | 'high' | 'ultra-high';

/** Thinking/reasoning level per role. */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'max';

/** Full model metadata from models.dev + local availability check. */
export interface ModelMetadata {
  readonly id: string;
  readonly alias?: string;
  readonly provider: string;
  readonly tier: ModelTier;
  readonly contextWindow?: number;
  readonly available: boolean;
  readonly failureReason?: string;
  /** Price per million input tokens (USD). */
  readonly inputCostPerM?: number;
  /** Price per million output tokens (USD). */
  readonly outputCostPerM?: number;
  /** Whether the model supports extended reasoning/thinking. */
  readonly supportsReasoning?: boolean;
  /** Whether the model supports tool/function calling. */
  readonly supportsTools?: boolean;
  /** Whether the model supports vision/image input. */
  readonly supportsVision?: boolean;
}

export interface RolePreset {
  readonly role: ModelRole;
  readonly preferredTier: ModelTier;
  readonly fallbackTier: ModelTier;
  readonly thinkingLevel: ThinkingLevel;
  readonly description: string;
}

export interface RoleModelAssignment {
  readonly role: ModelRole;
  readonly modelId: string;
  readonly modelAlias?: string;
  readonly tier: ModelTier;
  readonly thinkingLevel: ThinkingLevel;
  readonly isFallback: boolean;
  readonly reason: string;
}

// ── models.dev API integration ────────────────────────────────────────

const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const FETCH_TIMEOUT_MS = 8_000;

interface ModelsDevModel {
  id?: string;
  name?: string;
  context_window?: number;
  cost?: {
    input?: number;
    output?: number;
  };
  reasoning?: boolean;
  tools?: boolean;
  vision?: boolean;
}

interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}

interface ModelsDevResponse {
  [provider: string]: ModelsDevProvider;
}

let modelsDevCache: Promise<ModelsDevApiData> | undefined;

interface ModelsDevApiData {
  /** model-id (lowercase) → full pricing+capability record */
  readonly models: ReadonlyMap<string, ModelsDevModelEntry>;
}

interface ModelsDevModelEntry {
  readonly inputCostPerM?: number;
  readonly outputCostPerM?: number;
  readonly contextWindow?: number;
  readonly supportsReasoning?: boolean;
  readonly supportsTools?: boolean;
  readonly supportsVision?: boolean;
}

async function fetchModelsDevData(): Promise<ModelsDevApiData> {
  const models = new Map<string, ModelsDevModelEntry>();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(MODELS_DEV_API_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { models };
    const data = (await res.json()) as ModelsDevResponse;
    for (const provider of Object.values(data)) {
      if (provider.models === undefined) continue;
      for (const model of Object.values(provider.models)) {
        if (model.id === undefined) continue;
        models.set(model.id.toLowerCase(), {
          inputCostPerM: model.cost?.input,
          outputCostPerM: model.cost?.output,
          contextWindow: model.context_window,
          supportsReasoning: model.reasoning === true,
          supportsTools: model.tools === true,
          supportsVision: model.vision === true,
        });
      }
    }
  } catch {
    // Network failure — fall back to name heuristics.
  }
  return { models };
}

/**
 * Get models.dev data (cached, lazy).
 */
export function getModelsDevData(): Promise<ModelsDevApiData> {
  modelsDevCache ??= fetchModelsDevData();
  return modelsDevCache;
}

// ── Tier classification ──────────────────────────────────────────────

/**
 * Well-known model tiers based on name fragments.
 * Lower tier = cheaper / faster.
 */
const TIER_PATTERNS: readonly { readonly tier: ModelTier; readonly patterns: readonly RegExp[] }[] = [
  {
    tier: 'ultra-cheap',
    patterns: [/haiku/i, /mini/i, /nano/i, /flash/i, /lite/i, /small/i, /tiny/i, /8B/i, /7B/i],
  },
  {
    tier: 'cheap',
    patterns: [/sonnet/i, /4o-mini/i, /gpt-4[._-]mini/i, /mini[-.]pro/i, /instant/i, /turbo/i, /air/i],
  },
  {
    tier: 'balanced',
    patterns: [/gpt-4o(?![-.]mini)/i, /gpt-4[-.]1(?!mini)/i, /claude-3\.5/i, /sonnet-4/i, /qwen-?max/i, /deepseek/i, /yi-/i],
  },
  {
    tier: 'high',
    patterns: [/opus/i, /gpt-5/i, /o1(?!-mini)/i, /o3(?!-mini)/i, /o4/i, /claude-4/i, /sonnet-4\.5/i, /pro/i],
  },
  {
    tier: 'ultra-high',
    patterns: [/opus-4/i, /o1-?preview/i, /o3-?preview/i, /thinking/i, /reasoning/i, /ultra/i, /max/i],
  },
];

/**
 * Price thresholds (USD per million input tokens) for data-driven tiering.
 * Used when models.dev pricing is available.
 */
const PRICE_TIER_THRESHOLDS = {
  ultraCheap: 0.5,   // < $0.50/M input → ultra-cheap
  cheap: 2.0,        // < $2.00/M → cheap
  balanced: 8.0,     // < $8.00/M → balanced
  high: 20.0,        // < $20.00/M → high
  // >= $20.00/M → ultra-high
} as const;

/**
 * Classify a model into a tier using models.dev data (price-primary),
 * falling back to name patterns.
 */
export function classifyModelTier(modelName: string, pricingData?: ModelsDevModelEntry): ModelTier {
  // 1. Try data-driven classification from models.dev pricing
  if (pricingData?.inputCostPerM !== undefined) {
    const cost = pricingData.inputCostPerM;
    if (cost < PRICE_TIER_THRESHOLDS.ultraCheap) return 'ultra-cheap';
    if (cost < PRICE_TIER_THRESHOLDS.cheap) return 'cheap';
    if (cost < PRICE_TIER_THRESHOLDS.balanced) return 'balanced';
    if (cost < PRICE_TIER_THRESHOLDS.high) return 'high';
    return 'ultra-high';
  }

  // 2. Fallback to name patterns
  for (const { tier, patterns } of TIER_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(modelName))) {
      return tier;
    }
  }
  return 'balanced';
}

/**
 * Classify using models.dev cached data (async, fetches if needed).
 */
export async function classifyModelTierWithData(modelName: string): Promise<ModelTier> {
  const data = await getModelsDevData();
  const entry = data.models.get(modelName.toLowerCase());
  return classifyModelTier(modelName, entry);
}

// ── Role presets with thinking levels ────────────────────────────────

/**
 * Recommended presets for each role.
 * Thinking level: planning/debugging get max reasoning, coding gets high,
 * completion gets medium, compaction/exploration get minimal.
 */
export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    role: 'compaction',
    preferredTier: 'ultra-cheap',
    fallbackTier: 'cheap',
    thinkingLevel: 'minimal',
    description: 'Compaction: cheap/fast model with minimal reasoning to summarize context efficiently',
  },
  {
    role: 'exploration',
    preferredTier: 'ultra-cheap',
    fallbackTier: 'cheap',
    thinkingLevel: 'low',
    description: 'Exploration: cheap/fast model for read-only codebase navigation',
  },
  {
    role: 'completion',
    preferredTier: 'balanced',
    fallbackTier: 'cheap',
    thinkingLevel: 'medium',
    description: 'Completion: balanced model for general tool calls',
  },
  {
    role: 'coding',
    preferredTier: 'high',
    fallbackTier: 'balanced',
    thinkingLevel: 'high',
    description: 'Coding: high-quality model with strong reasoning for implementation',
  },
  {
    role: 'planning',
    preferredTier: 'ultra-high',
    fallbackTier: 'high',
    thinkingLevel: 'max',
    description: 'Planning: highest intelligence with max reasoning for architecture and design',
  },
  {
    role: 'debugging',
    preferredTier: 'ultra-high',
    fallbackTier: 'high',
    thinkingLevel: 'max',
    description: 'Debugging: highest intelligence with max reasoning for root-cause analysis',
  },
];

// ── Auto-assignment ──────────────────────────────────────────────────

/**
 * Enrich a list of available models with models.dev data (pricing, capabilities).
 * Returns enriched ModelMetadata with proper tier classification.
 */
export async function enrichModelMetadata(
  models: readonly { id: string; alias?: string; provider: string; available: boolean; failureReason?: string }[],
): Promise<readonly ModelMetadata[]> {
  const data = await getModelsDevData();
  return models.map((model) => {
    const devData = data.models.get(model.id.toLowerCase());
    const tier = classifyModelTier(model.id, devData);
    return {
      ...model,
      tier,
      contextWindow: devData?.contextWindow,
      inputCostPerM: devData?.inputCostPerM,
      outputCostPerM: devData?.outputCostPerM,
      supportsReasoning: devData?.supportsReasoning,
      supportsTools: devData?.supportsTools,
      supportsVision: devData?.supportsVision,
    };
  });
}

/**
 * Auto-assign models to roles based on available models, models.dev data, and presets.
 * Uses enriched metadata for data-driven tier classification.
 * User overrides take precedence.
 */
export async function autoAssignRoleModelsWithData(
  availableModels: readonly { id: string; alias?: string; provider: string; available: boolean; failureReason?: string }[],
  userOverrides?: Partial<Record<ModelRole, string>>,
): Promise<Record<ModelRole, RoleModelAssignment | undefined>> {
  const enriched = await enrichModelMetadata(availableModels);
  return autoAssignRoleModels(enriched, userOverrides);
}

/**
 * Auto-assign models to roles based on available models and presets.
 * Picks the best available model for each role's preferred tier, falling back
 * to the fallback tier, then to any available model.
 * Also assigns the preset's thinking level.
 */
export function autoAssignRoleModels(
  availableModels: readonly ModelMetadata[],
  userOverrides?: Partial<Record<ModelRole, string>>,
): Record<ModelRole, RoleModelAssignment | undefined> {
  const byTier = new Map<ModelTier, ModelMetadata[]>();
  for (const model of availableModels) {
    if (!model.available) continue;
    const tier = model.tier || classifyModelTier(model.id);
    const list = byTier.get(tier) ?? [];
    list.push(model);
    byTier.set(tier, list);
  }

  const allAvailable = availableModels.filter((m) => m.available);
  const result: Partial<Record<ModelRole, RoleModelAssignment>> = {};

  for (const preset of ROLE_PRESETS) {
    // User override takes precedence
    if (userOverrides && userOverrides[preset.role]) {
      const overrideId = userOverrides[preset.role]!;
      const model = allAvailable.find((m) => m.id === overrideId || m.alias === overrideId);
      if (model) {
        result[preset.role] = {
          role: preset.role,
          modelId: model.id,
          modelAlias: model.alias,
          tier: model.tier,
          thinkingLevel: resolveThinkingLevel(preset, model),
          isFallback: false,
          reason: 'User override',
        };
        continue;
      }
    }

    const preferred = byTier.get(preset.preferredTier);
    const fallback = byTier.get(preset.fallbackTier);

    if (preferred && preferred.length > 0) {
      const model = preferred[0]!;
      result[preset.role] = {
        role: preset.role,
        modelId: model.id,
        modelAlias: model.alias,
        tier: model.tier,
        thinkingLevel: resolveThinkingLevel(preset, model),
        isFallback: false,
        reason: `Preferred ${preset.preferredTier} tier${model.inputCostPerM !== undefined ? ` ($${model.inputCostPerM.toFixed(2)}/M input)` : ''}`,
      };
    } else if (fallback && fallback.length > 0) {
      const model = fallback[0]!;
      result[preset.role] = {
        role: preset.role,
        modelId: model.id,
        modelAlias: model.alias,
        tier: model.tier,
        thinkingLevel: resolveThinkingLevel(preset, model),
        isFallback: true,
        reason: `Fallback ${preset.fallbackTier} tier (preferred unavailable)`,
      };
    } else if (allAvailable.length > 0) {
      const model = allAvailable[0]!;
      result[preset.role] = {
        role: preset.role,
        modelId: model.id,
        modelAlias: model.alias,
        tier: model.tier,
        thinkingLevel: resolveThinkingLevel(preset, model),
        isFallback: true,
        reason: 'Fallback: no preferred or fallback tier available, using first available',
      };
    }
    // If no available models at all, role stays undefined
  }

  return result as Record<ModelRole, RoleModelAssignment | undefined>;
}

/**
 * Resolve the thinking level for a role+model combination.
 * If the model doesn't support reasoning, downgrade to 'minimal'.
 */
function resolveThinkingLevel(preset: RolePreset, model: ModelMetadata): ThinkingLevel {
  if (preset.thinkingLevel === 'minimal' || preset.thinkingLevel === 'low') {
    return preset.thinkingLevel;
  }
  // If model doesn't support reasoning, downgrade
  if (model.supportsReasoning === false) {
    return 'low';
  }
  return preset.thinkingLevel;
}

// ── Fallback chain ──────────────────────────────────────────────────

/**
 * Build a fallback chain for a role: primary → fallback tier → any available.
 */
export function buildFallbackChain(
  role: ModelRole,
  availableModels: readonly ModelMetadata[],
): readonly ModelMetadata[] {
  const preset = ROLE_PRESETS.find((p) => p.role === role);
  if (!preset) return [];

  const preferred = availableModels.filter(
    (m) => m.available && (m.tier || classifyModelTier(m.id)) === preset.preferredTier,
  );
  const fallback = availableModels.filter(
    (m) => m.available && (m.tier || classifyModelTier(m.id)) === preset.fallbackTier,
  );
  const others = availableModels.filter(
    (m) => m.available &&
      (m.tier || classifyModelTier(m.id)) !== preset.preferredTier &&
      (m.tier || classifyModelTier(m.id)) !== preset.fallbackTier,
  );

  return [...preferred, ...fallback, ...others];
}

/**
 * Detect if a model failure is due to auth/credit issues (should trigger fallback).
 */
export function isAuthOrCreditFailure(error: string): boolean {
  const patterns = [
    /401/i,
    /403/i,
    /payment/i,
    /credit/i,
    /billing/i,
    /quota/i,
    /insufficient/i,
    /expired/i,
    /invalid.*key/i,
    /no.*payment.*method/i,
    /credentials were rejected/i,
    /send \/login/i,
    /auth_rejected/i,
    /oauth.*reject/i,
  ];
  return patterns.some((p) => p.test(error));
}

/**
 * Apply credential-health annotations then run role assignment.
 * Prefer this when callers know provider credentials but not `available` flags.
 */
export function autoAssignRoleModelsWithHealth(
  models: readonly {
    readonly id: string;
    readonly alias?: string;
    readonly provider: string;
    readonly tier?: ModelTier;
  }[],
  options: {
    readonly hasCredential: (providerId: string) => boolean;
    readonly credentialKey?: (providerId: string) => string | undefined;
    readonly userOverrides?: Partial<Record<ModelRole, string>>;
    readonly store?: CredentialHealthStore;
  },
): Record<ModelRole, RoleModelAssignment | undefined> {
  const annotated = annotateModelsWithCredentialHealth(
    models.map((m) => ({
      id: m.id,
      alias: m.alias,
      provider: m.provider,
    })),
    {
      hasCredential: (providerId) => options.hasCredential(providerId),
      credentialKey: options.credentialKey
        ? (providerId) => options.credentialKey!(providerId)
        : undefined,
      store: options.store,
    },
  );
  const withTier: ModelMetadata[] = annotated.map((m, index) => ({
    id: m.id,
    alias: m.alias,
    provider: m.provider,
    available: m.available,
    failureReason: m.failureReason,
    tier: models[index]?.tier,
  })) as ModelMetadata[];
  return autoAssignRoleModels(withTier, options.userOverrides);
}


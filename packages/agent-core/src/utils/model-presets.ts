import { annotateModelsWithCredentialHealth, type CredentialHealthStore } from '@superliora/oauth';

/**
 * Role-based model presets: assign the best model for each task role using
 * models.dev cost + real benchmark scores (not price alone).
 *
 * Data sources (official models.dev APIs):
 *   - https://models.dev/api.json — provider endpoints, cost, tool_call, limit
 *   - https://models.dev/models.json — provider-agnostic metadata + benchmarks[]
 *
 * Quality prefers coding-relevant benches (SWE-Bench, Terminal-Bench, Aider,
 * Artificial Analysis Coding/Intelligence Index) when present; otherwise falls
 * back to family/capability heuristics. Value = quality / input cost.
 * Coding/planning/debugging enforce a quality floor; compaction/exploration
 * prefer value while still requiring tools + enough context.
 * Auto-routing uses credential health + scores only (no provider denylist).
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
  /** models.dev family string when known (e.g. claude-sonnet, gpt-4.1). */
  readonly family?: string;
  /** Knowledge cutoff date string from models.dev (YYYY-MM-DD). */
  readonly knowledgeCutoff?: string;
  /**
   * Quality score in ~0–100 (higher = stronger coding/planning proxy).
   * Prefer models.dev benchmarks when present; else family/capability heuristic.
   */
  readonly qualityScore?: number;
  /**
   * Value score = quality / effective cost (higher = better quality per dollar).
   * Used to rank within a tier / for cost-sensitive roles.
   */
  readonly valueScore?: number;
  /** Weighted coding-bench index from models.dev/models.json when available. */
  readonly benchmarkScore?: number;
  /** Number of coding-relevant benchmarks that contributed to benchmarkScore. */
  readonly benchmarkCount?: number;
}

export interface RolePreset {
  readonly role: ModelRole;
  readonly preferredTier: ModelTier;
  readonly fallbackTier: ModelTier;
  readonly thinkingLevel: ThinkingLevel;
  readonly description: string;
  /**
   * Minimum quality score required when any scored candidate exists.
   * Compaction/exploration keep this low; coding/planning/debugging higher.
   */
  readonly minQualityScore?: number;
  /** Prefer value ranking over pure quality when true. */
  readonly preferValue?: boolean;
  /** Require tool calling when capability data is known. */
  readonly requireTools?: boolean;
  /** Minimum context window when known (tokens). */
  readonly minContextWindow?: number;
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

/** Provider endpoints + pricing (no benchmarks). */
const MODELS_DEV_API_URL = 'https://models.dev/api.json';
/** Provider-agnostic model metadata including benchmarks[].score. */
const MODELS_DEV_MODELS_URL = 'https://models.dev/models.json';
const FETCH_TIMEOUT_MS = 8_000;

interface ModelsDevBenchmark {
  name?: string;
  score?: number | string;
  metric?: string;
  harness?: string;
  source?: string;
  date?: string;
}

interface ModelsDevModel {
  id?: string;
  name?: string;
  family?: string;
  /** Legacy / alternate field some dumps still use. */
  context_window?: number;
  cost?: {
    input?: number;
    output?: number;
  };
  reasoning?: boolean;
  /** Actual models.dev field (not `tools`). */
  tool_call?: boolean;
  /** Legacy alias if present. */
  tools?: boolean;
  vision?: boolean;
  knowledge?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  modalities?: {
    input?: readonly string[];
    output?: readonly string[];
  };
  /** Present on models.json / catalog model metadata. */
  benchmarks?: readonly ModelsDevBenchmark[];
}

interface ModelsDevProvider {
  models?: Record<string, ModelsDevModel>;
}

interface ModelsDevResponse {
  [provider: string]: ModelsDevProvider;
}

let modelsDevCache: Promise<ModelsDevApiData> | undefined;
let modelsDevResolved: ModelsDevApiData | undefined;

export interface ModelsDevApiData {
  /** model-id (lowercase) → full pricing+capability+bench record */
  readonly models: ReadonlyMap<string, ModelsDevModelEntry>;
}

export interface ModelsDevModelEntry {
  readonly inputCostPerM?: number;
  readonly outputCostPerM?: number;
  readonly contextWindow?: number;
  readonly supportsReasoning?: boolean;
  readonly supportsTools?: boolean;
  readonly supportsVision?: boolean;
  readonly family?: string;
  readonly knowledgeCutoff?: string;
  /** Weighted 0–100 coding-bench index from models.dev benchmarks. */
  readonly benchmarkScore?: number;
  readonly benchmarkCount?: number;
  /** Raw coding-relevant benches kept for debugging / richer ranking. */
  readonly benchmarks?: readonly {
    readonly name: string;
    readonly score: number;
  }[];
}

/**
 * Coding-agent-relevant benchmarks from models.dev/models.json.
 * Weights favour agent/coding harnesses over pure knowledge exams.
 * `lo`/`hi` are empirical ranges from the 2026 models.dev dump for
 * min-max normalization into 0–100.
 */
const CODING_BENCH_WEIGHTS: readonly {
  readonly match: RegExp;
  readonly weight: number;
  readonly lo: number;
  readonly hi: number;
}[] = [
  { match: /^SWE-Bench Verified$/i, weight: 1.3, lo: 50, hi: 95 },
  { match: /^SWE-Bench Pro$/i, weight: 1.4, lo: 5, hi: 85 },
  { match: /^SWE Bench Pro$/i, weight: 1.4, lo: 5, hi: 85 },
  { match: /^Terminal-Bench(?: Hard| 2\.1)?$/i, weight: 1.2, lo: 20, hi: 90 },
  { match: /^Terminal Bench 2\.1$/i, weight: 1.2, lo: 20, hi: 90 },
  { match: /^Aider Polyglot$/i, weight: 1.0, lo: 0, hi: 90 },
  { match: /^Artificial Analysis Coding Agent Index$/i, weight: 1.35, lo: 40, hi: 85 },
  { match: /^Artificial Analysis Coding Index$/i, weight: 1.15, lo: 5, hi: 45 },
  { match: /^Artificial Analysis Intelligence Index$/i, weight: 1.0, lo: 20, hi: 70 },
  { match: /^LiveCodeBench(?: Pro)?$/i, weight: 0.9, lo: 70, hi: 100 },
  { match: /^GPQA Diamond$/i, weight: 0.55, lo: 80, hi: 100 },
  { match: /^SWE-Atlas/i, weight: 0.85, lo: 10, hi: 80 },
  { match: /^Toolathlon$/i, weight: 0.8, lo: 0, hi: 100 },
  { match: /^MCP Atlas$/i, weight: 0.75, lo: 0, hi: 100 },
];

function parseNumericScore(score: number | string | undefined): number | undefined {
  if (typeof score === 'number' && Number.isFinite(score)) return score;
  if (typeof score === 'string') {
    const n = Number(score.replace(/%/g, '').trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function normalizeBenchScore(raw: number, lo: number, hi: number): number {
  if (hi <= lo) return Math.max(0, Math.min(100, raw));
  const t = (raw - lo) / (hi - lo);
  return Math.max(0, Math.min(100, t * 100));
}

/**
 * Collapse models.dev benchmarks[] into a single 0–100 coding quality index.
 * Returns undefined when no coding-relevant benches are present.
 */
export function scoreFromBenchmarks(
  benchmarks: readonly ModelsDevBenchmark[] | undefined,
): { readonly score: number; readonly count: number; readonly used: readonly { name: string; score: number }[] } | undefined {
  if (benchmarks === undefined || benchmarks.length === 0) return undefined;
  let weighted = 0;
  let weightSum = 0;
  const used: { name: string; score: number }[] = [];
  for (const bench of benchmarks) {
    const name = bench.name?.trim();
    if (name === undefined || name.length === 0) continue;
    const raw = parseNumericScore(bench.score);
    if (raw === undefined) continue;
    const rule = CODING_BENCH_WEIGHTS.find((r) => r.match.test(name));
    if (rule === undefined) continue;
    const norm = normalizeBenchScore(raw, rule.lo, rule.hi);
    weighted += norm * rule.weight;
    weightSum += rule.weight;
    used.push({ name, score: raw });
  }
  if (weightSum <= 0) return undefined;
  return {
    score: Math.round(weighted / weightSum),
    count: used.length,
    used,
  };
}

function indexModelEntry(
  models: Map<string, ModelsDevModelEntry>,
  id: string,
  entry: ModelsDevModelEntry,
  preferIncoming = false,
): void {
  const key = id.toLowerCase();
  const existing = models.get(key);
  if (existing === undefined) {
    models.set(key, entry);
  } else {
    models.set(key, preferIncoming ? mergeModelEntries(existing, entry) : mergeModelEntries(entry, existing));
  }
  const slash = id.lastIndexOf('/');
  if (slash >= 0) {
    const bare = id.slice(slash + 1).toLowerCase();
    if (bare.length > 0) {
      const bareExisting = models.get(bare);
      if (bareExisting === undefined) models.set(bare, entry);
      else models.set(bare, mergeModelEntries(bareExisting, entry));
    }
  }
}

function mergeModelEntries(a: ModelsDevModelEntry, b: ModelsDevModelEntry): ModelsDevModelEntry {
  // Prefer b for benchmarks when present; prefer a for cost when present.
  // Capability flags: true from any provider row wins (a false row must not
  // shadow another provider's image/tool/reasoning support for the same id).
  return {
    inputCostPerM: a.inputCostPerM ?? b.inputCostPerM,
    outputCostPerM: a.outputCostPerM ?? b.outputCostPerM,
    contextWindow: a.contextWindow ?? b.contextWindow,
    supportsReasoning: mergeCapabilityFlag(a.supportsReasoning, b.supportsReasoning),
    supportsTools: mergeCapabilityFlag(a.supportsTools, b.supportsTools),
    supportsVision: mergeCapabilityFlag(a.supportsVision, b.supportsVision),
    family: a.family ?? b.family,
    knowledgeCutoff: a.knowledgeCutoff ?? b.knowledgeCutoff,
    benchmarkScore: b.benchmarkScore ?? a.benchmarkScore,
    benchmarkCount: b.benchmarkCount ?? a.benchmarkCount,
    benchmarks: b.benchmarks ?? a.benchmarks,
  };
}

/** True wins; otherwise keep a defined false/undefined over the other. */
function mergeCapabilityFlag(
  a: boolean | undefined,
  b: boolean | undefined,
): boolean | undefined {
  if (a === true || b === true) return true;
  if (a === false || b === false) return false;
  return undefined;
}

/**
 * Look up a models.dev row for a wire/catalog model id.
 * Tries exact id, provider/model bare name, and common Cursor effort suffixes.
 */
export function lookupModelsDevModel(modelId: string): ModelsDevModelEntry | undefined {
  const peek = peekModelsDevData();
  if (peek === undefined) return undefined;
  for (const key of modelsDevLookupKeys(modelId)) {
    const hit = peek.models.get(key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** @internal exported for tests */
export function modelsDevLookupKeys(modelId: string): readonly string[] {
  const raw = modelId.trim().toLowerCase();
  if (raw.length === 0) return [];
  const keys: string[] = [raw];
  const slash = raw.lastIndexOf('/');
  if (slash >= 0) {
    const afterSlash = raw.slice(slash + 1);
    if (afterSlash.length > 0) keys.push(afterSlash);
  }
  const seeds = keys.slice();
  for (const base of seeds) {
    const unprefixed = base.startsWith('cursor-') ? base.slice('cursor-'.length) : base;
    if (unprefixed !== base) keys.push(unprefixed);
    // Cursor/OpenRouter effort·speed suffixes on top of the catalog id.
    const stripped = unprefixed
      .replace(/-fast-(none|low|medium|high|xhigh|max)$/i, '')
      .replace(/-(none|low|medium|high|xhigh|max)-fast$/i, '')
      .replace(/-(none|low|medium|high|xhigh|max)$/i, '')
      .replace(/-fast$/i, '');
    if (stripped !== unprefixed && stripped.length > 0) keys.push(stripped);
  }
  return [...new Set(keys)];
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

async function fetchModelsDevData(): Promise<ModelsDevApiData> {
  const models = new Map<string, ModelsDevModelEntry>();
  const [apiRaw, metaRaw] = await Promise.all([
    fetchJson(MODELS_DEV_API_URL),
    fetchJson(MODELS_DEV_MODELS_URL),
  ]);

  // 1) Provider catalog: cost + tool_call + limit
  if (apiRaw !== undefined && typeof apiRaw === 'object' && apiRaw !== null) {
    const data = apiRaw as ModelsDevResponse;
    for (const provider of Object.values(data)) {
      if (provider?.models === undefined) continue;
      for (const model of Object.values(provider.models)) {
        if (model.id === undefined) continue;
        indexModelEntry(models, model.id, parseModelsDevModel(model));
      }
    }
  }

  // 2) Provider-agnostic metadata: benchmarks[] (and fill gaps)
  if (metaRaw !== undefined && typeof metaRaw === 'object' && metaRaw !== null) {
    for (const [id, model] of Object.entries(metaRaw as Record<string, ModelsDevModel>)) {
      const entry = parseModelsDevModel({ ...model, id: model.id ?? id });
      indexModelEntry(models, model.id ?? id, entry, true);
    }
  }

  return { models };
}

function parseModelsDevModel(model: ModelsDevModel): ModelsDevModelEntry {
  const contextWindow = model.limit?.context ?? model.context_window;
  const supportsTools = model.tool_call === true || model.tools === true;
  const supportsVision =
    model.vision === true ||
    (model.modalities?.input?.some((m) => m === 'image' || m === 'pdf') ?? false);
  const bench = scoreFromBenchmarks(model.benchmarks);
  return {
    inputCostPerM: model.cost?.input,
    outputCostPerM: model.cost?.output,
    contextWindow,
    supportsReasoning: model.reasoning === true,
    supportsTools,
    supportsVision,
    family: model.family,
    knowledgeCutoff: model.knowledge,
    ...(bench !== undefined
      ? {
          benchmarkScore: bench.score,
          benchmarkCount: bench.count,
          benchmarks: bench.used,
        }
      : {}),
  };
}

/**
 * Get models.dev data (cached, lazy). Merges api.json + models.json.
 */
export function getModelsDevData(): Promise<ModelsDevApiData> {
  modelsDevCache ??= fetchModelsDevData().then((data) => {
    modelsDevResolved = data;
    return data;
  });
  return modelsDevCache;
}

/** Sync peek of a warm models.dev cache (undefined until first fetch resolves). */
export function peekModelsDevData(): ModelsDevApiData | undefined {
  return modelsDevResolved;
}

/** Fire-and-forget / awaitable warm of the models.dev cache. */
export async function warmModelsDevData(): Promise<void> {
  await getModelsDevData();
}

/** @internal test helper — clear models.dev cache between tests. */
export function clearModelsDevCacheForTests(): void {
  modelsDevCache = undefined;
  modelsDevResolved = undefined;
}

/** @internal test helper — seed resolved peek without network. */
export function setModelsDevDataForTests(data: ModelsDevApiData): void {
  modelsDevResolved = data;
  modelsDevCache = Promise.resolve(data);
}

// ── Tier classification ──────────────────────────────────────────────

/**
 * Well-known model tiers based on name fragments.
 * Lower tier = cheaper / faster.
 */
const TIER_PATTERNS: readonly { readonly tier: ModelTier; readonly patterns: readonly RegExp[] }[] =
  [
    {
      tier: 'ultra-cheap',
      patterns: [/haiku/i, /mini/i, /nano/i, /flash/i, /lite/i, /small/i, /tiny/i, /8B/i, /7B/i],
    },
    {
      tier: 'cheap',
      patterns: [
        /4o-mini/i,
        /gpt-4[._-]mini/i,
        /mini[-.]pro/i,
        /instant/i,
        /turbo/i,
        /air/i,
        /kimi[-_]?k2\.5\b/i,
      ],
    },
    {
      tier: 'balanced',
      patterns: [
        /sonnet/i,
        /gpt-4o(?!-mini)/i,
        /gemini.*pro/i,
        /mistral[-_]?large/i,
        /command[-_]?r/i,
        /qwen3\.7[-_]?plus/i,
        /glm[-_]?4/i,
      ],
    },
    {
      tier: 'high',
      patterns: [
        /opus/i,
        /gpt-4\.1(?![-_]?mini|[-_]?nano)/i,
        /o3(?!-mini)/i,
        /o1(?!-mini)/i,
        /qwen3\.[78][-_]?max/i,
        /glm[-_]?5/i,
        /deepseek[-_]?v4[-_]?pro/i,
        /kimi[-_]?k2\.[67]/i,
        /kimi[-_]?k3\b/i,
      ],
    },
    {
      tier: 'ultra-high',
      patterns: [/opus[-_]?4/i, /gpt-5/i, /o3[-_]?pro/i, /ultra/i],
    },
  ];

/**
 * Price thresholds (USD per million input tokens) for data-driven tiering.
 * Used when models.dev pricing is available — then quality can promote/demote.
 */
const PRICE_TIER_THRESHOLDS = {
  ultraCheap: 0.5, // < $0.50/M input → ultra-cheap
  cheap: 2.0, // < $2.00/M → cheap
  balanced: 8.0, // < $8.00/M → balanced
  high: 20.0, // < $20.00/M → high
  // >= $20.00/M → ultra-high
} as const;

const TIER_RANK: Record<ModelTier, number> = {
  'ultra-cheap': 0,
  cheap: 1,
  balanced: 2,
  high: 3,
  'ultra-high': 4,
};

const TIER_BY_RANK: readonly ModelTier[] = [
  'ultra-cheap',
  'cheap',
  'balanced',
  'high',
  'ultra-high',
];

/**
 * Family quality priors — used only when models.dev benchmarks are missing.
 * Higher = better coding/planning proxy.
 */
const FAMILY_QUALITY: readonly { readonly pattern: RegExp; readonly score: number }[] = [
  // Allow claude-3-opus / claude-opus-4 / bare "opus" test ids.
  { pattern: /claude[-_\d.]*opus|\bopus[-_]?4\b|\bopus\b/i, score: 96 },
  { pattern: /claude[-_\d.]*sonnet|\bsonnet\b/i, score: 88 },
  { pattern: /claude[-_\d.]*haiku|\bhaiku\b/i, score: 62 },
  { pattern: /gpt[-_]?5|o3[-_]?pro/i, score: 95 },
  { pattern: /\bo3\b|o1[-_]?pro/i, score: 92 },
  { pattern: /gpt[-_]?4\.1(?![-_]?mini|[-_]?nano)/i, score: 86 },
  { pattern: /gpt[-_]?4o(?![-_]?mini)/i, score: 80 },
  { pattern: /gpt[-_]?4o?[-_]?mini|4\.1[-_]?mini|4\.1[-_]?nano/i, score: 58 },
  { pattern: /gemini[-_]?2\.5[-_]?pro|gemini[-_]?pro/i, score: 84 },
  { pattern: /gemini.*flash/i, score: 64 },
  { pattern: /grok[-_]?3|grok[-_]?4|grok/i, score: 78 },
  { pattern: /mistral[-_]?large|codestral/i, score: 72 },
  { pattern: /qwen3\.8|qwen.*coder|qwen.*max/i, score: 82 },
  { pattern: /qwen3\.7/i, score: 76 },
  { pattern: /glm[-_]?5/i, score: 80 },
  { pattern: /deepseek[-_]?v4[-_]?pro|deepseek[-_]?thinking/i, score: 84 },
  { pattern: /deepseek[-_]?v4[-_]?flash|deepseek[-_]?flash/i, score: 68 },
  { pattern: /kimi[-_]?k3\b/i, score: 86 },
  { pattern: /kimi[-_]?k2\.[67]/i, score: 80 },
  { pattern: /kimi[-_]?k2\.5\b/i, score: 52 },
  { pattern: /llama[-_]?4|llama[-_]?3\.3/i, score: 68 },
];

/** Soft demotions for clearly older SKUs — still eligible, just lose quality races. */
const STALE_MODEL_DEMOTIONS: readonly { readonly pattern: RegExp; readonly penalty: number }[] = [
  { pattern: /\bkimi[-_]?k2\.5\b/i, penalty: 22 },
  { pattern: /\bkimi[-_]?k2(?![.\d]|[-_]?k)/i, penalty: 16 },
  { pattern: /\bgpt-4o(?![-_]?mini)\b/i, penalty: 10 },
  { pattern: /\bclaude-3\b/i, penalty: 14 },
  { pattern: /\b(turbo|instant)\b/i, penalty: 12 },
];

/** Hard-excluded from coding/planning/debugging preferred pools (value roles may still use). */
const HARD_EXCLUDE_QUALITY_ROLES: readonly RegExp[] = [
  /\bkimi[-_]?k2\.5\b/i,
  /\bkimi[-_]?k2(?![.\d]|[-_]?k)/i,
];

function isQualityStrictRole(role: ModelRole): boolean {
  return role === 'coding' || role === 'planning' || role === 'debugging';
}

export function isHardExcludedForRole(role: ModelRole, modelId: string): boolean {
  if (!isQualityStrictRole(role)) return false;
  return HARD_EXCLUDE_QUALITY_ROLES.some((pattern) => pattern.test(modelId));
}

function catalogHasNewerPeer(modelId: string, catalogIds: readonly string[]): boolean {
  if (/\bkimi[-_]?k2\.5\b/i.test(modelId) || /\bkimi[-_]?k2(?![.\d]|[-_]?k)/i.test(modelId)) {
    return catalogIds.some((id) => /\bkimi[-_]?k2\.[6-9]\b|\bkimi[-_]?k3\b/i.test(id));
  }
  if (/\bgpt-4o(?![-_]?mini)\b/i.test(modelId)) {
    return catalogIds.some((id) => /\bgpt-4\.1\b|\bgpt-5\b/i.test(id));
  }
  if (/\bclaude-3\b/i.test(modelId)) {
    return catalogIds.some((id) => /\bclaude[-_]?4\b|\bsonnet[-_]?4\b|\bopus[-_]?4\b/i.test(id));
  }
  return false;
}

type QualityInput = ModelsDevModelEntry | Pick<
  ModelMetadata,
  | 'supportsReasoning'
  | 'supportsTools'
  | 'supportsVision'
  | 'contextWindow'
  | 'family'
  | 'knowledgeCutoff'
  | 'benchmarkScore'
  | 'benchmarkCount'
>;

/**
 * Quality proxy (0–100).
 * 1) models.dev coding benchmarks when present (primary)
 * 2) family/capability heuristic when benches are missing
 */
export function scoreModelQuality(modelName: string, data?: QualityInput): number {
  const bench =
    data !== undefined && 'benchmarkScore' in data && typeof data.benchmarkScore === 'number'
      ? data.benchmarkScore
      : undefined;
  const benchCount =
    data !== undefined && 'benchmarkCount' in data && typeof data.benchmarkCount === 'number'
      ? data.benchmarkCount
      : 0;

  // Primary: real benchmarks from models.dev/models.json
  if (bench !== undefined) {
    let score = bench;
    // Mild capability polish on top of the bench index.
    if (data?.supportsTools === false) score -= 12;
    else if (data?.supportsTools === true) score += 2;
    if (data?.supportsReasoning === true) score += 2;
    score -= staleModelPenalty(modelName);
    // Single-bench scores are slightly less trusted.
    if (benchCount === 1) score = Math.round(score * 0.97);
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // Fallback: family + capability heuristic
  let score = 48;
  const family = data?.family ?? '';
  const haystack = `${family} ${modelName}`;

  for (const { pattern, score: familyScore } of FAMILY_QUALITY) {
    if (pattern.test(haystack)) {
      score = familyScore;
      break;
    }
  }

  if (data?.supportsReasoning === true) score += 8;
  if (data?.supportsTools === true) score += 6;
  else if (data?.supportsTools === false) score -= 18;
  if (data?.supportsVision === true) score += 2;

  const ctx = data?.contextWindow;
  if (ctx !== undefined) {
    if (ctx >= 500_000) score += 6;
    else if (ctx >= 128_000) score += 4;
    else if (ctx >= 32_000) score += 1;
    else if (ctx < 16_000) score -= 10;
  }

  const knowledge = data?.knowledgeCutoff;
  if (knowledge !== undefined && knowledge.length >= 4) {
    const year = Number(knowledge.slice(0, 4));
    if (Number.isFinite(year)) {
      if (year >= 2026) score += 5;
      else if (year >= 2025) score += 3;
      else if (year >= 2024) score -= 4;
      else if (year < 2024) score -= 12;
    }
  }

  // Name demotions for tiny/cheap SKUs that price-only tiering overrates.
  if (/\b(nano|tiny|lite|flash[-_]?lite|8b|7b|3b)\b/i.test(modelName)) score -= 8;
  score -= staleModelPenalty(modelName);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function staleModelPenalty(modelName: string): number {
  for (const { pattern, penalty } of STALE_MODEL_DEMOTIONS) {
    if (pattern.test(modelName)) return penalty;
  }
  return 0;
}

/**
 * Quality per dollar of input cost. Free/unknown cost uses a neutral divisor
 * so ranking still prefers higher quality.
 */
export function scoreModelValue(qualityScore: number, inputCostPerM?: number): number {
  const cost = inputCostPerM !== undefined && inputCostPerM > 0 ? inputCostPerM : 3;
  // Soften extreme cheapness so a $0.01 junk model does not dominate.
  const effective = Math.max(0.15, cost);
  return qualityScore / effective;
}

function priceTier(cost: number): ModelTier {
  if (cost < PRICE_TIER_THRESHOLDS.ultraCheap) return 'ultra-cheap';
  if (cost < PRICE_TIER_THRESHOLDS.cheap) return 'cheap';
  if (cost < PRICE_TIER_THRESHOLDS.balanced) return 'balanced';
  if (cost < PRICE_TIER_THRESHOLDS.high) return 'high';
  return 'ultra-high';
}

function nameTier(modelName: string): ModelTier {
  for (const { tier, patterns } of TIER_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(modelName))) {
      return tier;
    }
  }
  return 'balanced';
}

/**
 * Only re-bucket tiers when we have real models.dev benchmarks.
 * Heuristic family scores must not move price/name tiers — ranking within a
 * tier already uses quality/value.
 */
function adjustTierByBenchmark(
  priceOrNameTier: ModelTier,
  benchmarkScore: number | undefined,
): ModelTier {
  if (benchmarkScore === undefined) return priceOrNameTier;
  let rank = TIER_RANK[priceOrNameTier];
  // Strong coding benches can lift a mid-priced model into a higher bucket.
  if (benchmarkScore >= 88 && rank < 4) rank = Math.max(rank, 3);
  else if (benchmarkScore >= 78 && rank < 3) rank = Math.max(rank, 2);
  // Weak benches pull overpriced junk down so it is not preferred for coding.
  if (benchmarkScore < 35 && rank > 0) rank = Math.min(rank, 0);
  else if (benchmarkScore < 50 && rank > 1) rank = Math.min(rank, 1);
  return TIER_BY_RANK[rank] ?? priceOrNameTier;
}

/**
 * Classify a model into a tier using models.dev cost (primary), name patterns
 * (fallback), and optional benchmark-based promotion/demotion.
 * Missing or non-positive cost (subscription / $0 catalogs) uses name tiers so
 * every Token Plan model does not collapse into ultra-cheap.
 */
export function classifyModelTier(modelName: string, pricingData?: ModelsDevModelEntry): ModelTier {
  const cost = pricingData?.inputCostPerM;
  const base = cost !== undefined && cost > 0 ? priceTier(cost) : nameTier(modelName);
  return adjustTierByBenchmark(base, pricingData?.benchmarkScore);
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
    description: 'Summarize conversation history only — value-first, tools + ≥32k context',
    minQualityScore: 40,
    preferValue: true,
    requireTools: true,
    minContextWindow: 32_000,
  },
  {
    role: 'exploration',
    preferredTier: 'ultra-cheap',
    fallbackTier: 'cheap',
    thinkingLevel: 'low',
    description: 'Explore / desk workers — fast read-only codebase navigation',
    minQualityScore: 48,
    preferValue: true,
    requireTools: true,
    minContextWindow: 32_000,
  },
  {
    role: 'completion',
    preferredTier: 'balanced',
    fallbackTier: 'cheap',
    thinkingLevel: 'medium',
    description: 'General completion / light tool loops — balanced quality per dollar',
    minQualityScore: 55,
    preferValue: true,
    requireTools: true,
  },
  {
    role: 'coding',
    preferredTier: 'high',
    fallbackTier: 'balanced',
    thinkingLevel: 'high',
    description: 'Coder / implement / goal-driver workers — strong reasoning for edits',
    minQualityScore: 72,
    preferValue: false,
    requireTools: true,
    minContextWindow: 64_000,
  },
  {
    role: 'planning',
    preferredTier: 'high',
    fallbackTier: 'balanced',
    thinkingLevel: 'max',
    description: 'Plan / mission workers — architecture, interview, and design',
    minQualityScore: 78,
    preferValue: false,
    requireTools: true,
    minContextWindow: 128_000,
  },
  {
    role: 'debugging',
    preferredTier: 'high',
    fallbackTier: 'balanced',
    thinkingLevel: 'max',
    description: 'Debug workers — root-cause analysis with max reasoning',
    minQualityScore: 78,
    preferValue: false,
    requireTools: true,
    minContextWindow: 128_000,
  },
];

/** Role preset lookup for Settings / status copy. */
export function rolePresetFor(role: ModelRole): RolePreset | undefined {
  return ROLE_PRESETS.find((preset) => preset.role === role);
}

// ── Auto-assignment ──────────────────────────────────────────────────

/** Apply quality/value/tier scoring, optionally merging a models.dev entry. */
export function applyModelScores(
  model: Omit<ModelMetadata, 'qualityScore' | 'valueScore' | 'tier'> & {
    readonly tier?: ModelTier;
  },
  devData?: ModelsDevModelEntry,
): ModelMetadata {
  return withScores(model, devData);
}

function withScores(
  model: Omit<ModelMetadata, 'qualityScore' | 'valueScore' | 'tier'> & {
    readonly tier?: ModelTier;
  },
  devData?: ModelsDevModelEntry,
): ModelMetadata {
  const benchmarkScore = model.benchmarkScore ?? devData?.benchmarkScore;
  const benchmarkCount = model.benchmarkCount ?? devData?.benchmarkCount;
  const qualityInput = {
    supportsReasoning: model.supportsReasoning ?? devData?.supportsReasoning,
    supportsTools: model.supportsTools ?? devData?.supportsTools,
    supportsVision: model.supportsVision ?? devData?.supportsVision,
    contextWindow: model.contextWindow ?? devData?.contextWindow,
    family: model.family ?? devData?.family,
    knowledgeCutoff: model.knowledgeCutoff ?? devData?.knowledgeCutoff,
    benchmarkScore,
    benchmarkCount,
  };
  const qualityScore = scoreModelQuality(model.id, qualityInput);
  const inputCostPerM = model.inputCostPerM ?? devData?.inputCostPerM;
  const valueScore = scoreModelValue(qualityScore, inputCostPerM);
  const tier =
    model.tier ??
    classifyModelTier(model.id, {
      inputCostPerM,
      outputCostPerM: model.outputCostPerM ?? devData?.outputCostPerM,
      contextWindow: model.contextWindow ?? devData?.contextWindow,
      supportsReasoning: model.supportsReasoning ?? devData?.supportsReasoning,
      supportsTools: model.supportsTools ?? devData?.supportsTools,
      supportsVision: model.supportsVision ?? devData?.supportsVision,
      family: model.family ?? devData?.family,
      knowledgeCutoff: model.knowledgeCutoff ?? devData?.knowledgeCutoff,
      benchmarkScore,
      benchmarkCount,
    });
  return {
    ...model,
    tier,
    qualityScore,
    valueScore,
    ...(benchmarkScore !== undefined ? { benchmarkScore } : {}),
    ...(benchmarkCount !== undefined ? { benchmarkCount } : {}),
  };
}

/**
 * Enrich a list of available models with models.dev data (pricing, capabilities,
 * and coding benchmarks from models.json).
 */
export async function enrichModelMetadata(
  models: readonly {
    id: string;
    alias?: string;
    provider: string;
    available: boolean;
    failureReason?: string;
  }[],
): Promise<readonly ModelMetadata[]> {
  const data = await getModelsDevData();
  return models.map((model) => {
    const devData =
      data.models.get(model.id.toLowerCase()) ??
      data.models.get(model.alias?.toLowerCase() ?? '');
    return withScores(
      {
        ...model,
        contextWindow: devData?.contextWindow,
        inputCostPerM: devData?.inputCostPerM,
        outputCostPerM: devData?.outputCostPerM,
        supportsReasoning: devData?.supportsReasoning,
        supportsTools: devData?.supportsTools,
        supportsVision: devData?.supportsVision,
        family: devData?.family,
        knowledgeCutoff: devData?.knowledgeCutoff,
        benchmarkScore: devData?.benchmarkScore,
        benchmarkCount: devData?.benchmarkCount,
      },
      devData,
    );
  });
}

/**
 * Auto-assign models to roles based on available models, models.dev data, and presets.
 * Uses enriched metadata for data-driven tier classification.
 * User overrides take precedence.
 */
export async function autoAssignRoleModelsWithData(
  availableModels: readonly {
    id: string;
    alias?: string;
    provider: string;
    available: boolean;
    failureReason?: string;
  }[],
  userOverrides?: Partial<Record<ModelRole, string>>,
): Promise<Record<ModelRole, RoleModelAssignment | undefined>> {
  const enriched = await enrichModelMetadata(availableModels);
  return autoAssignRoleModels(enriched, userOverrides);
}

function meetsCapabilityFloor(preset: RolePreset, model: ModelMetadata): boolean {
  if (preset.requireTools === true && model.supportsTools === false) return false;
  if (
    preset.minContextWindow !== undefined &&
    model.contextWindow !== undefined &&
    model.contextWindow < preset.minContextWindow
  ) {
    return false;
  }
  return true;
}

function meetsQualityFloor(preset: RolePreset, model: ModelMetadata, anyScored: boolean): boolean {
  if (!anyScored) return true;
  if (preset.minQualityScore === undefined) return true;
  const q = model.qualityScore ?? scoreModelQuality(model.id, model);
  return q >= preset.minQualityScore;
}

function rankScore(
  preset: RolePreset,
  model: ModelMetadata,
  catalogIds: readonly string[] = [],
): number {
  const quality = model.qualityScore ?? scoreModelQuality(model.id, model);
  const value = model.valueScore ?? scoreModelValue(quality, model.inputCostPerM);
  let score =
    preset.preferValue === true
      ? value * 10 + quality * 0.05
      : quality * 10 + value * 0.1;
  if (catalogIds.length > 0 && catalogHasNewerPeer(model.id, catalogIds)) {
    score -= isQualityStrictRole(preset.role) ? 80 : 25;
  }
  if (isQualityStrictRole(preset.role)) {
    const knowledge = model.knowledgeCutoff;
    if (knowledge !== undefined && knowledge.length >= 4) {
      const year = Number(knowledge.slice(0, 4));
      if (Number.isFinite(year) && year < 2025) score -= 40;
    }
  }
  return score;
}

function pickBestForRole(
  preset: RolePreset,
  candidates: readonly ModelMetadata[],
  catalogIds: readonly string[] = [],
): ModelMetadata | undefined {
  if (candidates.length === 0) return undefined;
  const eligible = candidates.filter((m) => !isHardExcludedForRole(preset.role, m.id));
  if (eligible.length === 0) return undefined;
  const anyScored = eligible.some((m) => m.qualityScore !== undefined);
  const capable = eligible.filter((m) => meetsCapabilityFloor(preset, m));
  const pool = capable.length > 0 ? capable : eligible;
  const qualityOk = pool.filter((m) => meetsQualityFloor(preset, m, anyScored));
  // coding/planning/debugging never soft-fall back below the quality floor.
  const finalPool = isQualityStrictRole(preset.role)
    ? qualityOk
    : qualityOk.length > 0
      ? qualityOk
      : pool;
  if (finalPool.length === 0) return undefined;
  const sorted = [...finalPool].sort(
    (a, b) => rankScore(preset, b, catalogIds) - rankScore(preset, a, catalogIds),
  );
  return sorted[0];
}

function formatPickReason(
  preset: RolePreset,
  model: ModelMetadata,
  kind: 'preferred' | 'fallback' | 'any',
): string {
  const q = model.qualityScore ?? scoreModelQuality(model.id, model);
  const v = model.valueScore ?? scoreModelValue(q, model.inputCostPerM);
  const cost =
    model.inputCostPerM !== undefined ? ` $${model.inputCostPerM.toFixed(2)}/M` : '';
  if (kind === 'preferred') {
    return `Preferred ${preset.preferredTier} tier (q=${q} v=${v.toFixed(1)}${cost})`;
  }
  if (kind === 'fallback') {
    return `Fallback ${preset.fallbackTier} tier (preferred unavailable; q=${q} v=${v.toFixed(1)})`;
  }
  return `Fallback: best available by ${preset.preferValue === true ? 'value' : 'quality'} (q=${q} v=${v.toFixed(1)})`;
}

/**
 * Auto-assign models to roles based on available models and presets.
 * Within each tier, ranks by quality (coding/planning/debugging) or value
 * (compaction/exploration/completion). Enforces min quality + tool/context
 * floors when capability data is present.
 */
export function autoAssignRoleModels(
  availableModels: readonly ModelMetadata[],
  userOverrides?: Partial<Record<ModelRole, string>>,
): Record<ModelRole, RoleModelAssignment | undefined> {
  const scored = availableModels.map((m) =>
    m.qualityScore !== undefined && m.valueScore !== undefined ? m : withScores(m),
  );

  const byTier = new Map<ModelTier, ModelMetadata[]>();
  for (const model of scored) {
    if (!model.available) continue;
    const tier = model.tier || classifyModelTier(model.id);
    const list = byTier.get(tier) ?? [];
    list.push(model);
    byTier.set(tier, list);
  }

  const allAvailable = scored.filter((m) => m.available);
  const catalogIds = allAvailable.map((m) => m.id);
  const result: Partial<Record<ModelRole, RoleModelAssignment>> = {};

  for (const preset of ROLE_PRESETS) {
    // User override takes precedence when the alias is in the available catalog.
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

    const preferred = pickBestForRole(
      preset,
      byTier.get(preset.preferredTier) ?? [],
      catalogIds,
    );
    if (preferred) {
      result[preset.role] = {
        role: preset.role,
        modelId: preferred.id,
        modelAlias: preferred.alias,
        tier: preferred.tier,
        thinkingLevel: resolveThinkingLevel(preset, preferred),
        isFallback: false,
        reason: formatPickReason(preset, preferred, 'preferred'),
      };
      continue;
    }

    const fallback = pickBestForRole(
      preset,
      byTier.get(preset.fallbackTier) ?? [],
      catalogIds,
    );
    if (fallback) {
      result[preset.role] = {
        role: preset.role,
        modelId: fallback.id,
        modelAlias: fallback.alias,
        tier: fallback.tier,
        thinkingLevel: resolveThinkingLevel(preset, fallback),
        isFallback: true,
        reason: formatPickReason(preset, fallback, 'fallback'),
      };
      continue;
    }

    const any = pickBestForRole(preset, allAvailable, catalogIds);
    if (any) {
      result[preset.role] = {
        role: preset.role,
        modelId: any.id,
        modelAlias: any.alias,
        tier: any.tier,
        thinkingLevel: resolveThinkingLevel(preset, any),
        isFallback: true,
        reason: formatPickReason(preset, any, 'any'),
      };
    }
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
 * Build a fallback chain for a role: primary → fallback tier → any available,
 * each group ranked by the role's quality/value preference.
 */
export function buildFallbackChain(
  role: ModelRole,
  availableModels: readonly ModelMetadata[],
): readonly ModelMetadata[] {
  const preset = ROLE_PRESETS.find((p) => p.role === role);
  if (!preset) return [];

  const scored = availableModels
    .filter((m) => m.available && !isHardExcludedForRole(role, m.id))
    .map((m) => (m.qualityScore !== undefined ? m : withScores(m)));
  const catalogIds = scored.map((m) => m.id);
  const anyScored = scored.some((m) => m.qualityScore !== undefined);
  const floorOk = (m: ModelMetadata): boolean =>
    !isQualityStrictRole(role) || meetsQualityFloor(preset, m, anyScored);

  const preferred = scored
    .filter(
      (m) =>
        floorOk(m) && (m.tier || classifyModelTier(m.id)) === preset.preferredTier,
    )
    .sort((a, b) => rankScore(preset, b, catalogIds) - rankScore(preset, a, catalogIds));
  const fallback = scored
    .filter(
      (m) =>
        floorOk(m) && (m.tier || classifyModelTier(m.id)) === preset.fallbackTier,
    )
    .sort((a, b) => rankScore(preset, b, catalogIds) - rankScore(preset, a, catalogIds));
  const others = scored
    .filter(
      (m) =>
        floorOk(m) &&
        (m.tier || classifyModelTier(m.id)) !== preset.preferredTier &&
        (m.tier || classifyModelTier(m.id)) !== preset.fallbackTier,
    )
    .sort((a, b) => rankScore(preset, b, catalogIds) - rankScore(preset, a, catalogIds));

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
  const withTiers: ModelMetadata[] = annotated.map((m, index) =>
    withScores({
      id: m.id,
      alias: m.alias,
      provider: m.provider,
      available: m.available,
      failureReason: m.failureReason,
      tier: models[index]?.tier,
    }),
  );
  return autoAssignRoleModels(withTiers, options.userOverrides);
}

/** Local catalog row for Settings /status role-routing previews (no network). */
export type LocalRoleCatalogModel = {
  readonly alias: string;
  readonly model: string;
  readonly provider: string;
  readonly available?: boolean;
  readonly maxContextSize?: number;
  readonly capabilities?: readonly string[];
  readonly inputCostPerM?: number;
};

export type LoopRoleModelPreview = {
  readonly role: ModelRole;
  readonly description: string;
  readonly override?: string;
  readonly resolvedAlias?: string;
  readonly source: 'override' | 'auto' | 'none';
};

/**
 * Preview per-role routing for Settings and /status: healthy explicit overrides
 * win; unavailable overrides degrade to auto (same gate as smart-router).
 *
 * Ranking never considers models where `available === false` (credential missing,
 * auth rejected, or quota-exhausted via sharedCredentialHealthStore /
 * isConfigAliasHealthy). Unknown/undefined available is treated as healthy only
 * when callers did not run a health gate — prefer buildLocalModelMetadata.
 */
export function previewLoopRoleModelRouting(
  models: readonly LocalRoleCatalogModel[],
  userOverrides?: Partial<Record<ModelRole, string>>,
): readonly LoopRoleModelPreview[] {
  const metadata: ModelMetadata[] = models.map((entry) => {
    const caps = new Set((entry.capabilities ?? []).map((c) => c.trim().toLowerCase()));
    const declaredCaps = entry.capabilities !== undefined;
    const pricing =
      entry.inputCostPerM !== undefined || entry.maxContextSize !== undefined
        ? {
            ...(entry.inputCostPerM !== undefined ? { inputCostPerM: entry.inputCostPerM } : {}),
            ...(entry.maxContextSize !== undefined ? { contextWindow: entry.maxContextSize } : {}),
          }
        : undefined;
    // Strict: only true when available is not false (false → excluded from rank).
    const healthy = entry.available !== false;
    return withScores({
      id: entry.model,
      alias: entry.alias,
      provider: entry.provider,
      available: healthy,
      ...(healthy ? {} : { failureReason: 'credential_or_quota_unhealthy' }),
      contextWindow: entry.maxContextSize,
      inputCostPerM: entry.inputCostPerM,
      supportsReasoning: declaredCaps
        ? caps.has('thinking') || caps.has('always_thinking')
        : undefined,
      supportsTools: declaredCaps ? caps.has('tool_use') : undefined,
      supportsVision: declaredCaps ? caps.has('image_in') : undefined,
      tier: classifyModelTier(entry.model, pricing),
    });
  });

  const availableByAlias = new Map(
    metadata.map((entry) => [entry.alias ?? entry.id, entry.available === true] as const),
  );

  const overrides: Partial<Record<ModelRole, string>> = {};
  for (const [role, value] of Object.entries(userOverrides ?? {}) as Array<
    [ModelRole, string | undefined]
  >) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed.length > 0) overrides[role] = trimmed;
  }

  const healthyOverrides: Partial<Record<ModelRole, string>> = {};
  for (const [role, alias] of Object.entries(overrides) as Array<[ModelRole, string]>) {
    if (availableByAlias.get(alias) === true) healthyOverrides[role] = alias;
  }

  const assignments = autoAssignRoleModels(metadata, healthyOverrides);
  return ROLE_PRESETS.map((preset) => {
    const override = overrides[preset.role];
    if (override !== undefined) {
      if (availableByAlias.get(override) === true) {
        return {
          role: preset.role,
          description: preset.description,
          override,
          resolvedAlias: override,
          source: 'override' as const,
        };
      }
      const assignment = assignments[preset.role];
      const resolvedAlias = assignment?.modelAlias ?? assignment?.modelId;
      return {
        role: preset.role,
        description: preset.description,
        override,
        ...(resolvedAlias !== undefined ? { resolvedAlias } : {}),
        source: 'override' as const,
      };
    }
    const assignment = assignments[preset.role];
    const resolvedAlias = assignment?.modelAlias ?? assignment?.modelId;
    return {
      role: preset.role,
      description: preset.description,
      ...(resolvedAlias !== undefined ? { resolvedAlias } : {}),
      source: resolvedAlias !== undefined ? ('auto' as const) : ('none' as const),
    };
  });
}

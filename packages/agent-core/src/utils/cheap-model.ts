/**
 * Well-known model-name fragments associated with cheap, fast model tiers.
 * Lower score = cheaper / faster.
 */
const CHEAP_MODEL_PATTERNS: ReadonlyArray<{ pattern: string; score: number }> = [
  { pattern: 'haiku', score: 1 },
  { pattern: 'flash', score: 2 },
  { pattern: 'nano', score: 3 },
  { pattern: 'mini', score: 4 },
  { pattern: 'lite', score: 5 },
  { pattern: 'turbo', score: 6 },
];

/** Local model alias shape used for cheap/compaction routing (sync, no network). */
export type CheapModelConfig = {
  readonly model: string;
  readonly provider?: string;
  readonly maxContextSize?: number;
  /** Per-million-token pricing in USD (models.dev / config.toml). */
  readonly cost?: {
    readonly input?: number;
    readonly output?: number;
    readonly cache_read?: number;
    readonly cache_write?: number;
  };
};

/**
 * Pick the cheapest-looking alias from a configured models record using only
 * well-known name patterns — no pricing lookup, safe to call from synchronous
 * code paths. Matches against both the alias key and the underlying model
 * name. Returns `undefined` when nothing matches so callers can fall back to
 * their default (usually the main) model.
 */
export function inferCheapModelAliasSync(
  models: Record<string, CheapModelConfig | { model: string; provider?: string }> | undefined,
  isAliasHealthy?: (alias: string) => boolean,
): string | undefined {
  if (models === undefined) return undefined;

  let bestAlias: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [alias, config] of Object.entries(models)) {
    if (isAliasHealthy !== undefined && !isAliasHealthy(alias)) continue;
    const haystack = `${alias} ${config.model}`.toLowerCase();
    for (const { pattern, score } of CHEAP_MODEL_PATTERNS) {
      if (haystack.includes(pattern) && score < bestScore) {
        bestScore = score;
        bestAlias = alias;
      }
    }
  }
  return bestAlias;
}

/**
 * Pick the lowest-priced configured alias using local `cost.input` (USD / 1M
 * tokens), optionally requiring a minimum context window. Aliases without an
 * input cost are skipped so free/unknown entries do not always win. Safe for
 * synchronous compaction hot paths — no models.dev network fetch.
 */
export function inferCheapestModelAliasByCostSync(
  models: Record<string, CheapModelConfig> | undefined,
  isAliasHealthy?: (alias: string) => boolean,
  options?: {
    readonly minContextTokens?: number;
  },
): string | undefined {
  if (models === undefined) return undefined;

  let bestAlias: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [alias, config] of Object.entries(models)) {
    if (isAliasHealthy !== undefined && !isAliasHealthy(alias)) continue;
    const inputCost = config.cost?.input;
    if (inputCost === undefined || !Number.isFinite(inputCost) || inputCost < 0) continue;
    const maxContext = config.maxContextSize;
    if (
      options?.minContextTokens !== undefined &&
      maxContext !== undefined &&
      maxContext > 0 &&
      maxContext < options.minContextTokens
    ) {
      continue;
    }
    const outputCost =
      config.cost?.output !== undefined && Number.isFinite(config.cost.output)
        ? Math.max(0, config.cost.output)
        : 0;
    // Prefer input price; small output weight breaks ties toward cheaper completions.
    // Soft floor avoids $0.00 junk models always winning over slightly pricier ones.
    const score = Math.max(0.05, inputCost) + outputCost * 0.25;
    if (score < bestScore) {
      bestScore = score;
      bestAlias = alias;
    }
  }
  return bestAlias;
}

/**
 * Resolve which model alias full compaction / dream should use.
 *
 * Priority:
 * 1. Explicit `loopControl.compactionModel` (caller validates resolve; may throw)
 * 2. Lowest local `models.*.cost` among healthy aliases (optional min context)
 * 3. Name-heuristic cheap tier (`flash` / `haiku` / …)
 * 4. `undefined` → caller falls back to the main session model
 */
export function resolveCompactionModelAlias(params: {
  readonly explicit?: string | undefined;
  readonly models?: Record<string, CheapModelConfig> | undefined;
  readonly isAliasHealthy?: (alias: string) => boolean;
  readonly minContextTokens?: number;
}): string | undefined {
  const explicit = params.explicit?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit;

  return (
    inferCheapestModelAliasByCostSync(params.models, params.isAliasHealthy, {
      minContextTokens: params.minContextTokens,
    }) ?? inferCheapModelAliasSync(params.models, params.isAliasHealthy)
  );
}

/**
 * Resolve the model alias a subagent should run on.
 *
 * Read-only "explore" subagents do codebase exploration that a small, fast
 * model handles well, so route them to the cheapest configured alias when one
 * can be inferred. Every other profile (coder/plan/agent/...) keeps the
 * parent's model, and explore falls back to the parent's model when no cheap
 * alias exists — a subagent must never end up without a usable model alias.
 * When the parent itself has no alias yet, `undefined` is returned so the
 * child config update stays a no-op, exactly like plain inheritance.
 */
export function resolveSubagentModelAlias(
  profileName: string | undefined,
  profileBaseName: string | undefined,
  parentModelAlias: string | undefined,
  models: Record<string, { model: string; provider?: string }> | undefined,
  explorationModel?: string | undefined,
  options?: {
    /** Return false when the alias's provider credential is known-unhealthy. */
    readonly isAliasHealthy?: (alias: string) => boolean;
  },
): string | undefined {
  if (parentModelAlias === undefined) return undefined;
  if (!isExploreSubagentProfile(profileName, profileBaseName)) return parentModelAlias;

  const healthy = options?.isAliasHealthy;
  const pickIfHealthy = (alias: string | undefined): string | undefined => {
    if (alias === undefined) return undefined;
    if (healthy === undefined) return alias;
    return healthy(alias) ? alias : undefined;
  };

  // Explicit explorationModel wins, then an auto-inferred cheap model, then the
  // parent model — skip aliases whose credentials are marked unhealthy.
  return (
    pickIfHealthy(explorationModel) ??
    pickIfHealthy(inferCheapModelAliasSync(models, healthy)) ??
    parentModelAlias
  );
}

/**
 * Whether a subagent profile is the read-only exploration type. Expert
 * profiles built on top of "explore" carry it as their base name, while
 * forked profiles typically keep "explore" in the profile name itself.
 */
function isExploreSubagentProfile(
  profileName: string | undefined,
  profileBaseName: string | undefined,
): boolean {
  if (profileBaseName?.toLowerCase() === 'explore') return true;
  const name = profileName?.toLowerCase();
  return name !== undefined && name.includes('explore');
}

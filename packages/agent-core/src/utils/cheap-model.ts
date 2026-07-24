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

/**
 * Pick the cheapest-looking alias from a configured models record using only
 * well-known name patterns — no pricing lookup, safe to call from synchronous
 * code paths. Matches against both the alias key and the underlying model
 * name. Returns `undefined` when nothing matches so callers can fall back to
 * their default (usually the main) model.
 */
export function inferCheapModelAliasSync(
  models: Record<string, { model: string }> | undefined,
): string | undefined {
  if (models === undefined) return undefined;

  let bestAlias: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [alias, config] of Object.entries(models)) {
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
  models: Record<string, { model: string }> | undefined,
  explorationModel?: string | undefined,
): string | undefined {
  if (parentModelAlias === undefined) return undefined;
  if (!isExploreSubagentProfile(profileName, profileBaseName)) return parentModelAlias;
  // Explicit explorationModel wins, then an auto-inferred cheap model, then the
  // parent model — mirrors the compactionModel/completionModel override pattern.
  return explorationModel ?? inferCheapModelAliasSync(models) ?? parentModelAlias;
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

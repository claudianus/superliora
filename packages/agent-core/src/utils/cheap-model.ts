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

import { z } from 'zod';

export const ResearchIntensitySchema = z.enum(['balanced', 'premium', 'max']);
export type ResearchIntensity = z.infer<typeof ResearchIntensitySchema>;

export const ResearchLocalDirectSourcesSchema = z.object({
  github: z.boolean().optional(),
  arxiv: z.boolean().optional(),
  npm: z.boolean().optional(),
  pypi: z.boolean().optional(),
  crates: z.boolean().optional(),
});

export type ResearchLocalDirectSources = z.infer<typeof ResearchLocalDirectSourcesSchema>;

export const ResearchLocalSearchConfigSchema = z.object({
  enabled: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  searxngUrl: z.string().url().optional(),
  yacyUrl: z.string().url().optional(),
  directSources: ResearchLocalDirectSourcesSchema.optional(),
  renderedFetch: z.boolean().optional(),
  offlineMode: z.enum(['auto', 'always', 'never']).optional(),
});

export type ResearchLocalSearchConfig = z.infer<typeof ResearchLocalSearchConfigSchema>;

export const ResearchContext7ConfigSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().optional(),
});

export type ResearchContext7Config = z.infer<typeof ResearchContext7ConfigSchema>;
export const ResearchSearchProviderKindSchema = z.enum([
  'brave',
  'tavily',
  'exa',
  'serper',
  'google_cse',
  'bing',
  'searxng',
  'duckduckgo_ia',
  'duckduckgo',
  'moonshot',
]);

export type ResearchSearchProviderKind = z.infer<typeof ResearchSearchProviderKindSchema>;

export const ResearchSearchProviderConfigSchema = z.object({
  /** Provider backend. */
  kind: ResearchSearchProviderKindSchema,
  /** Optional friendly label used by routing / status. */
  label: z.string().min(1).optional(),
  /** Raw API key, or `{env:NAME}` style ref. */
  apiKey: z.string().optional(),
  /** Env var name that holds the API key (preferred over embedding secrets). */
  apiKeyEnv: z.string().optional(),
  /** Google Custom Search engine id (cx). */
  cx: z.string().optional(),
  /** Env var name that holds the Google CSE cx value. */
  cxEnv: z.string().optional(),
  /** Additional API keys for per-provider load balancing / fallback. */
  apiKeys: z.array(z.string().min(1)).optional(),
  /** Provider-specific base URL override (self-hosted SearXNG, proxies). */
  baseUrl: z.string().url().optional(),
  /** Local requests-per-minute budget for this provider. */
  rpm: z.number().int().min(1).optional(),
  /** Relative weight when strategy is weighted_round_robin. */
  weight: z.number().int().min(1).optional(),
  /** Disable this slot without deleting it. */
  enabled: z.boolean().optional(),
});

export type ResearchSearchProviderConfig = z.infer<typeof ResearchSearchProviderConfigSchema>;

export const ResearchSearchRoutingStrategySchema = z.enum([
  'auto',
  'parallel',
  'fallback',
  'round_robin',
  'weighted_round_robin',
  'least_used',
  'rate_limit_aware',
]);

export type ResearchSearchRoutingStrategy = z.infer<typeof ResearchSearchRoutingStrategySchema>;

export const ResearchSearchConfigSchema = z.object({
  /**
   * Routing strategy.
   * - `auto` (default): cost-aware cascade — cheapest ready paid provider first,
   *   escalate only if results are thin; free fallback last. Prefer this.
   * - `parallel`: fan-out (burns quota; opt-in only when you need recall).
   * - `fallback` / `round_robin` / …: explicit load-balancing modes.
   */
  strategy: ResearchSearchRoutingStrategySchema.optional(),
  /** Explicit provider slots. Env-detected keys are merged at runtime even when empty. */
  providers: z.array(ResearchSearchProviderConfigSchema).optional(),
  /** Cooldown after a 429 / rate-limit signal (ms). */
  cooldownMs: z.number().int().min(0).optional(),
  /** Max concurrent provider calls during parallel search. */
  concurrency: z.number().int().min(1).max(16).optional(),
  /**
   * Hard cap on paid/remote provider HTTP calls per WebSearch invocation.
   * Default 2 for auto/cascade. Parallel mode still respects this.
   */
  maxProviderCalls: z.number().int().min(1).max(8).optional(),
  /**
   * Stop cascading once this many ranked results are available.
   * Default: min(requested limit, 3).
   */
  minResultsToStop: z.number().int().min(1).max(20).optional(),
  /**
   * Max characters of page body kept per result when include_content is on.
   * Default 2500 — enough for grounding, cheap on tokens.
   */
  maxContentChars: z.number().int().min(200).max(20_000).optional(),
  /**
   * Max pages to fetch body for when include_content is true. Default 2.
   */
  contentFetchLimit: z.number().int().min(0).max(8).optional(),
  /** Keep zero-config free adapters (DuckDuckGo/direct sources) as last-resort fallback. Default true. */
  freeFallback: z.boolean().optional(),
});

export type ResearchSearchConfig = z.infer<typeof ResearchSearchConfigSchema>;

export const ResearchConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intensity: ResearchIntensitySchema.optional(),
  localSearch: ResearchLocalSearchConfigSchema.optional(),
  /** Multi-provider deep research search (Brave/Tavily/Exa/Serper/Google CSE/Bing + free fallback). */
  search: ResearchSearchConfigSchema.optional(),
  context7: ResearchContext7ConfigSchema.optional(),
  persistVerifiedFindings: z.boolean().optional(),
});

export type ResearchConfig = z.infer<typeof ResearchConfigSchema>;

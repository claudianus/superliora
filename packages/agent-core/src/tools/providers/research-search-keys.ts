/**
 * Easy search-provider key registration helpers.
 *
 * Supported env auto-detect (zero config when already exported):
 *   BRAVE_API_KEY / BRAVE_SEARCH_API_KEY
 *   TAVILY_API_KEY
 *   EXA_API_KEY
 *   SERPER_API_KEY / SERPER_DEV_API_KEY
 *
 * Config path:
 *   [research.search]
 *   strategy = "auto"
 *   [[research.search.providers]]
 *   kind = "brave"
 *   api_key_env = "BRAVE_API_KEY"
 */

import type {
  LioraConfig,
  ResearchSearchConfig,
  ResearchSearchProviderConfig,
  ResearchSearchProviderKind,
} from '#/config/schema';
import { detectSearchProviderEnvKeys, resolveResearchApiKey } from './research-search';

export const SEARCH_PROVIDER_SIGNUP: ReadonlyArray<{
  readonly kind: ResearchSearchProviderKind;
  readonly title: string;
  readonly env: string;
  readonly signupUrl: string;
  readonly freeTier: string;
}> = [
  {
    kind: 'brave',
    title: 'Brave Search',
    env: 'BRAVE_API_KEY',
    signupUrl: 'https://api-dashboard.search.brave.com/',
    freeTier: 'free plan available',
  },
  {
    kind: 'tavily',
    title: 'Tavily',
    env: 'TAVILY_API_KEY',
    signupUrl: 'https://app.tavily.com/home',
    freeTier: 'free credits for agents',
  },
  {
    kind: 'exa',
    title: 'Exa',
    env: 'EXA_API_KEY',
    signupUrl: 'https://dashboard.exa.ai/',
    freeTier: 'free trial credits',
  },
  {
    kind: 'serper',
    title: 'Serper (Google)',
    env: 'SERPER_API_KEY',
    signupUrl: 'https://serper.dev/',
    freeTier: '2,500 free queries',
  },
];

export function listReadySearchProviders(config: LioraConfig | undefined): {
  readonly ready: readonly ResearchSearchProviderKind[];
  readonly missing: readonly ResearchSearchProviderKind[];
  readonly envDetected: readonly ResearchSearchProviderKind[];
} {
  const configured = config?.research?.search?.providers ?? [];
  const envDetected = detectSearchProviderEnvKeys().map((p) => p.kind);
  const readyKinds = new Set<ResearchSearchProviderKind>(envDetected);
  for (const provider of configured) {
    if (provider.enabled === false) continue;
    if (resolveResearchApiKey(provider) !== undefined || provider.kind === 'searxng' || provider.kind === 'duckduckgo') {
      readyKinds.add(provider.kind);
    }
  }
  // Free fallback always counts as ready.
  readyKinds.add('duckduckgo');

  const paid: ResearchSearchProviderKind[] = ['brave', 'tavily', 'exa', 'serper'];
  return {
    ready: [...readyKinds],
    missing: paid.filter((kind) => !readyKinds.has(kind)),
    envDetected,
  };
}

export function buildSearchProviderKeyPatch(input: {
  readonly kind: ResearchSearchProviderKind;
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly label?: string;
  readonly rpm?: number;
  readonly weight?: number;
  readonly existing?: ResearchSearchConfig | undefined;
}): { readonly research: { readonly search: ResearchSearchConfig } } {
  const provider: ResearchSearchProviderConfig = {
    kind: input.kind,
    label: input.label ?? input.kind,
    apiKey: input.apiKey,
    apiKeyEnv: input.apiKeyEnv,
    rpm: input.rpm,
    weight: input.weight,
  };
  const existingProviders = input.existing?.providers ?? [];
  // Replace same-kind slot or append.
  const without = existingProviders.filter((p) => p.kind !== input.kind);
  return {
    research: {
      search: {
        strategy: input.existing?.strategy ?? 'auto',
        freeFallback: input.existing?.freeFallback ?? true,
        concurrency: input.existing?.concurrency,
        cooldownMs: input.existing?.cooldownMs,
        providers: [...without, provider],
      },
    },
  };
}

export function formatSearchProviderReadinessLine(config: LioraConfig | undefined): string {
  const { ready, envDetected } = listReadySearchProviders(config);
  const paidReady = ready.filter((k) => k !== 'duckduckgo' && k !== 'searxng' && k !== 'moonshot');
  if (paidReady.length === 0) {
    return 'local free · set BRAVE/TAVILY/EXA/SERPER_API_KEY or /research-key for stronger search';
  }
  const envNote = envDetected.length > 0 ? ` · env:${envDetected.join(',')}` : '';
  return `ready · ${paidReady.join('+')}${envNote} · free fallback on`;
}

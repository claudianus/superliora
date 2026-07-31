/** Ch2 meta/self-host — SearXNG instance URL (soft env gate). */
export const SEARXNG_URL_ENV = 'SUPERLIORA_SEARXNG_URL';

export interface MetaChannelStatus {
  readonly configured: boolean;
  readonly ready: boolean;
  readonly url?: string | undefined;
  readonly hint?: string | undefined;
}

export interface BuildMetaChannelStatusOptions {
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** Config wins over env (research.localSearch.searxngUrl or provider baseUrl). */
  readonly configUrl?: string | undefined;
}

function normalizeUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** Resolve SearXNG base URL — config first, then SUPERLIORA_SEARXNG_URL. */
export function resolveSearxngUrl(
  env: NodeJS.ProcessEnv = process.env,
  configUrl?: string | undefined,
): string | undefined {
  return normalizeUrl(configUrl) ?? normalizeUrl(env[SEARXNG_URL_ENV]);
}

/** Operator-facing one-liner for Settings / never-empty hints. */
export function researchMetaCh2Tip(): string {
  return (
    `Ch2 Meta: set ${SEARXNG_URL_ENV} or research.localSearch.searxngUrl ` +
    '(self-hosted SearXNG with JSON format enabled).'
  );
}

/** Snapshot for engine status / TUI — env or config URL (no live health probe yet). */
export function buildMetaChannelStatus(
  options: BuildMetaChannelStatusOptions = {},
): MetaChannelStatus {
  const env = options.env ?? process.env;
  const url = resolveSearxngUrl(env, options.configUrl);
  if (url === undefined) {
    return {
      configured: false,
      ready: false,
      hint: researchMetaCh2Tip(),
    };
  }
  return {
    configured: true,
    ready: true,
    url,
    hint: `Ch2 Meta ready — SearXNG ${url} (soft; probe on first search).`,
  };
}

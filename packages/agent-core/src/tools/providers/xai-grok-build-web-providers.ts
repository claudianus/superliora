import type { WebSearchProvider, WebSearchResult } from '../builtin/web/web-search';

import type { XaiGrokBuildClient } from './xai-grok-build';

export class XaiGrokWebSearchProvider implements WebSearchProvider {
  constructor(private readonly client: XaiGrokBuildClient) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    return this.client.search(query, {
      limit: options?.limit,
    });
  }
}

/**
 * Prefer Grok Build search when the subscription session is signed in,
 * then fall back to the multi-provider research stack.
 */
export class PreferXaiGrokWebSearchProvider implements WebSearchProvider {
  private lastServed: 'xai' | 'fallback' | undefined;

  /** Forwards the research stack health when the fallback exposes it. */
  readonly status: WebSearchProvider['status'];

  constructor(
    private readonly xai: WebSearchProvider,
    readonly researchFallback: WebSearchProvider,
  ) {
    this.status = researchFallback.status?.bind(researchFallback);
  }

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    try {
      const results = await this.xai.search(query, options);
      this.lastServed = 'xai';
      return results;
    } catch {
      this.lastServed = 'fallback';
      return this.researchFallback.search(query, options);
    }
  }

  /** Channels that served the latest query — xAI or the research cascade. */
  lastChannels(): readonly string[] {
    if (this.lastServed === 'xai') return ['xai-grok'];
    return this.researchFallback.lastChannels?.() ?? [];
  }
}

export interface XaiGrokCredentialProbe {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly tokenProvider?: import('./xai-grok-build').XaiGrokTokenProvider;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isXaiGrokCredentialConfigured(probe: XaiGrokCredentialProbe): boolean {
  if (nonEmpty(probe.apiKey) !== undefined) return true;
  if (nonEmpty(process.env['XAI_API_KEY']) !== undefined) return true;
  return probe.tokenProvider !== undefined;
}

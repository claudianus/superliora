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
  constructor(
    private readonly xai: WebSearchProvider,
    readonly researchFallback: WebSearchProvider,
  ) {}

  async search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]> {
    try {
      return await this.xai.search(query, options);
    } catch {
      return this.researchFallback.search(query, options);
    }
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

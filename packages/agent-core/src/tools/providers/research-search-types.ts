import type {
  ResearchSearchConfig,
  ResearchSearchProviderKind,
  ResearchSearchRoutingStrategy,
} from '#/config/schema';
import type { UrlFetcher } from '../builtin/web/fetch-url';
import type { LocalWebSearchProviderOptions } from './local-web-search';

export interface ResearchSearchEngineOptions {
  readonly search?: ResearchSearchConfig | undefined;
  readonly local?: LocalWebSearchProviderOptions | undefined;
  readonly moonshot?: {
    readonly baseUrl: string;
    readonly apiKey?: string | undefined;
    readonly defaultHeaders?: Record<string, string> | undefined;
    readonly customHeaders?: Record<string, string> | undefined;
    readonly tokenProvider?: {
      getAccessToken(options?: { readonly force?: boolean | undefined }): Promise<string>;
    };
  };
  readonly fetchImpl?: typeof fetch;
  readonly urlFetcher?: UrlFetcher;
  readonly now?: () => number;
}

export interface ResearchSearchStatus {
  readonly providers: readonly ResearchSearchProviderStatus[];
  readonly strategy: ResearchSearchRoutingStrategy;
  readonly freeFallback: boolean;
}

export interface ResearchSearchProviderStatus {
  readonly id: string;
  readonly kind: ResearchSearchProviderKind;
  readonly label: string;
  readonly ready: boolean;
  readonly source: 'config' | 'env' | 'local' | 'moonshot';
  readonly cooldownUntil?: number | undefined;
  readonly rpm?: number | undefined;
}

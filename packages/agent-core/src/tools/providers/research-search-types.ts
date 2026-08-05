import type {
  ResearchSearchConfig,
  ResearchSearchProviderKind,
  ResearchSearchRoutingStrategy,
} from '#/config/schema';
import type { CircuitBreakerRegistry } from '#/runtime/circuit-breaker';
import type { UrlFetcher } from '../builtin/web/fetch-url';
import type { LocalWebSearchProviderOptions } from './local-web-search';
import type { BrowserSearchChannel } from './research-search-browser';
import type { SearchNeverEmptyTelemetry } from './search-never-empty-telemetry';

export type { SearchNeverEmptyTelemetry } from './search-never-empty-telemetry';

export interface ResearchSearchBrowserStatus {
  readonly configured: boolean;
  readonly ready: boolean;
  readonly escalateAttempted?: boolean;
}

export interface ResearchSearchChromeExtensionStatus {
  readonly configured: boolean;
  /** True when SUPERLIORA_CHROME_RESEARCH_BRIDGE=1 or legacy SUPERLIORA_CHROME_EXT_BRIDGE=1. */
  readonly enabled: boolean;
  readonly ready: boolean;
  readonly bridgeUrl?: string | undefined;
  readonly hint?: string | undefined;
  readonly escalateAttempted?: boolean | undefined;
}

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
  /**
   * OpenAI Codex (ChatGPT subscription) extras credentials. When present,
   * the engine adds a subscription-tier search slot backed by the Codex
   * backend `web_search` server tool.
   */
  readonly codex?: {
    readonly baseUrl?: string | undefined;
    readonly model?: string | undefined;
    readonly tokenProvider: {
      getAccessToken(options?: { readonly force?: boolean | undefined }): Promise<string>;
    };
  };
  /**
   * Provider kinds whose env-detected slots are suppressed (Settings →
   * Provider extras off switch). Explicit `search.providers` entries are
   * user config and always stay.
   */
  readonly disabledEnvKinds?: readonly ResearchSearchProviderKind[] | undefined;
  readonly fetchImpl?: typeof fetch;
  readonly urlFetcher?: UrlFetcher;
  readonly browserChannel?: BrowserSearchChannel | undefined;
  readonly chromeExtensionChannel?: BrowserSearchChannel | undefined;
  readonly now?: () => number;
  /** Optional Never-Halt registry (Agent.circuitBreakerRegistry when wired). */
  readonly circuitBreakers?: CircuitBreakerRegistry | undefined;
  /** Called after breaker state changes when Agent is available. */
  readonly onCircuitBreakerChanged?: (() => void) | undefined;
}

export interface ResearchSearchStatus {
  readonly providers: readonly ResearchSearchProviderStatus[];
  readonly strategy: ResearchSearchRoutingStrategy;
  readonly freeFallback: boolean;
  readonly browser: ResearchSearchBrowserStatus;
  readonly chromeExtension: ResearchSearchChromeExtensionStatus;
  /** W13 never-empty counters when wired (WebSearch / DeepResearch degrade paths). */
  readonly neverEmpty?: SearchNeverEmptyTelemetry;
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

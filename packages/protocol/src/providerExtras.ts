/**
 * Wire status for the provider-extras harness: which subscription/plan
 * capabilities (web search, image/video generation, dedicated MCP servers)
 * are detected, how the search cascade is ordered, and which media backends
 * the auto-router can use. Projected by agent-core; consumed by SDK status
 * and the TUI /status Extras section.
 */

export type ProviderExtrasCapability = 'web_search' | 'image_gen' | 'video_gen' | 'mcp_servers';

export interface ProviderExtrasDetectedEntry {
  readonly id: string;
  readonly label: string;
  /** Where the credential was detected. */
  readonly source: 'env' | 'config' | 'oauth';
  readonly capabilities: readonly ProviderExtrasCapability[];
  /** User opted this service out via config extras.disabledProviders. */
  readonly disabled: boolean;
}

export interface ProviderExtrasSearchSlotStatus {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  /** Slot has credentials and is not cooling down. */
  readonly ready: boolean;
  readonly source: 'config' | 'env' | 'local' | 'moonshot';
  readonly cooldownUntil?: number;
}

export interface ProviderExtrasMediaStatus {
  /** Ordered auto-router preference for GenerateImage backends. */
  readonly image: readonly string[];
  /** Ordered auto-router preference for GenerateVideo backends. */
  readonly video: readonly string[];
}

export interface ProviderExtrasStatus {
  readonly providers: readonly ProviderExtrasDetectedEntry[];
  /** Search cascade in routing order (local fallback last). */
  readonly searchCascade: readonly ProviderExtrasSearchSlotStatus[];
  readonly media: ProviderExtrasMediaStatus;
  /** Names of provider-bundled MCP servers auto-injected this session. */
  readonly autoMcpServers: readonly string[];
}

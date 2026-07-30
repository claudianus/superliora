import { OAuthUnauthorizedError } from './errors';
import { SUPERLIORA_PROVIDER_NAME } from './managed-kimi-code-constants';

export type ManagedKimiCodeProtocol = 'anthropic';

/**
 * Server-declared thinking toggle support from `/models`:
 *  - 'only' — thinking cannot be turned off (always-thinking)
 *  - 'no'   — thinking is not supported at all
 *  - 'both' — thinking can be toggled on and off
 * Absent on older servers — callers fall back to `supportsReasoning`.
 */
export type SupportsThinkingType = 'only' | 'no' | 'both';

export interface ManagedKimiCodeModelInfo {
  readonly id: string;
  readonly contextLength: number;
  readonly supportsReasoning: boolean;
  readonly supportsImageIn: boolean;
  readonly supportsVideoIn: boolean;
  readonly supportsToolUse?: boolean;
  readonly supportsThinkingType?: SupportsThinkingType;
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
  readonly displayName?: string | undefined;
  readonly protocol?: ManagedKimiCodeProtocol | undefined;
}

export interface ManagedKimiCodeProvisionResult {
  readonly providerName: typeof SUPERLIORA_PROVIDER_NAME;
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
  readonly models: readonly ManagedKimiCodeModelInfo[];
  readonly configPath?: string | undefined;
}

export interface FetchManagedKimiCodeModelsOptions {
  readonly accessToken: string;
  readonly baseUrl?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface ManagedKimiCodeApplyResult {
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
}

export interface ManagedKimiCodeCleanupResult {
  readonly providerName: typeof SUPERLIORA_PROVIDER_NAME;
  readonly removedProvider: boolean;
  readonly removedModels: readonly string[];
  readonly defaultModelCleared: boolean;
  readonly removedServices: readonly string[];
}

export interface ManagedKimiOAuthRef {
  readonly storage: 'file' | 'keyring';
  readonly key: string;
  readonly oauthHost?: string | undefined;
  readonly label?: string | undefined;
}

export interface ManagedKimiOAuthRefInput {
  readonly storage?: 'file' | 'keyring' | undefined;
  readonly key?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly label?: string | undefined;
}

export interface ManagedKimiRuntimeAuth {
  readonly baseUrl?: string | undefined;
  readonly oauthRef: ManagedKimiOAuthRef;
}

export interface ManagedKimiLoginAuth {
  readonly baseUrl?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly oauthRef?: ManagedKimiOAuthRef | undefined;
}

export interface ManagedKimiEnv {
  readonly SUPERLIORA_BASE_URL?: string | undefined;
  readonly SUPERLIORA_OAUTH_HOST?: string | undefined;
  readonly KIMI_OAUTH_HOST?: string | undefined;
}

export class ManagedKimiCodeModelsAuthError extends OAuthUnauthorizedError {
  readonly status: number;
  readonly baseUrl: string;

  constructor(options: {
    readonly status: number;
    readonly baseUrl: string;
    readonly message: string;
  }) {
    super(
      `SuperLiora models endpoint ${options.baseUrl} rejected OAuth credentials: ${options.message}`,
    );
    this.name = 'ManagedKimiCodeModelsAuthError';
    this.status = options.status;
    this.baseUrl = options.baseUrl;
  }
}

export interface ManagedKimiProviderConfig {
  type: 'kimi';
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  oauth?: ManagedKimiOAuthRef | undefined;
  oauths?: ManagedKimiOAuthRef[] | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedKimiModelAlias {
  provider: string;
  model: string;
  maxContextSize: number;
  capabilities?: string[] | undefined;
  supportEfforts?: string[] | undefined;
  defaultEffort?: string | undefined;
  displayName?: string | undefined;
  protocol?: ManagedKimiCodeProtocol | undefined;
  betaApi?: boolean | undefined;
  adaptiveThinking?: boolean | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedKimiServiceConfig {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  oauth?: ManagedKimiOAuthRef | undefined;
}

export interface ManagedKimiServicesConfig {
  moonshotSearch?: ManagedKimiServiceConfig | undefined;
  moonshotFetch?: ManagedKimiServiceConfig | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedKimiConfigShape {
  providers: Record<string, ManagedKimiProviderConfig | Record<string, unknown>>;
  models?: Record<string, ManagedKimiModelAlias | Record<string, unknown>> | undefined;
  defaultModel?: string | undefined;
  defaultThinking?: boolean | undefined;
  services?: ManagedKimiServicesConfig | undefined;
  [key: string]: unknown;
}

export interface ManagedKimiConfigAdapter<TConfig> {
  read(): Promise<TConfig> | TConfig;
  write(config: TConfig): Promise<void> | void;
  apply(
    config: TConfig,
    input: {
      readonly models: readonly ManagedKimiCodeModelInfo[];
      readonly baseUrl?: string | undefined;
      readonly oauthKey?: string | undefined;
      readonly oauthHost?: string | undefined;
      readonly preserveDefaultModel?: boolean | undefined;
    },
  ): ManagedKimiCodeApplyResult;
  remove?(config: TConfig): void;
  readonly configPath?: string | undefined;
}

export interface ProvisionManagedKimiCodeConfigOptions<TConfig> {
  readonly adapter: ManagedKimiConfigAdapter<TConfig>;
  readonly accessToken: string;
  readonly baseUrl?: string | undefined;
  readonly oauthKey?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly preserveDefaultModel?: boolean | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

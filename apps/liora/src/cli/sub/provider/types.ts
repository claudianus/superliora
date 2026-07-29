/**
 * Type definitions for the `liora provider` CLI sub-command.
 */

import type { LioraConfig, ProviderRouteStatus } from '@superliora/sdk';

export interface WritableLike {
  write(chunk: string): boolean;
}

export interface ProviderDeps {
  readonly getHarness: () => import('@superliora/sdk').LioraHarness;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly env: NodeJS.ProcessEnv;
  readonly exit: (code: number) => never;
}

export interface AddOptions {
  readonly apiKey?: string;
}

export interface ListOptions {
  readonly json: boolean;
}

export interface DoctorOptions {
  readonly json: boolean;
}

export interface CatalogListOptions {
  readonly json: boolean;
  readonly filter?: string;
  readonly url?: string;
}

export interface CatalogAddOptions {
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly defaultModel?: string;
  readonly url?: string;
}

export interface CustomAddOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly keyless?: boolean;
  readonly model?: string;
  readonly alias?: string;
  readonly type?: string;
  readonly context?: string;
  readonly output?: string;
  readonly displayName?: string;
  readonly thinking?: boolean;
  readonly setDefault?: boolean;
}

export interface KeyAddOptions {
  readonly apiKey?: string;
  readonly apiKeys?: string;
  readonly apiKeyEnv?: string;
  readonly apiKeyEnvs?: string;
  readonly baseUrl?: string;
  readonly label?: string;
  readonly labels?: string;
  readonly rpm?: string;
  readonly tpm?: string;
  readonly autoRoute?: boolean;
}

export interface OAuthAddOptions {
  readonly key?: string;
  readonly storage?: string;
  readonly oauthHost?: string;
  readonly label?: string;
  readonly autoRoute?: boolean;
}

export interface KeyLimitOptions {
  readonly rpm?: string;
  readonly tpm?: string;
  readonly clear?: boolean;
}

export interface RouteSetOptions {
  readonly fallback?: string;
  readonly strategy?: string;
  readonly cooldownMs?: string;
  readonly weights?: string;
  readonly sessionAffinity?: string;
  readonly preferredCredential?: string;
}

export interface RouteAutoOptions {
  readonly fallback?: string;
  readonly cooldownMs?: string;
  readonly sessionAffinity?: string;
  readonly preferredCredential?: string;
}

export interface RouteStatusOptions {
  readonly json: boolean;
}

export interface RoutePreviewOptions {
  readonly json: boolean;
}

export interface RoutePreview {
  readonly modelAlias: string;
  readonly strategy:
    | 'auto'
    | 'fallback'
    | 'fill_first'
    | 'round_robin'
    | 'weighted_round_robin'
    | 'least_used'
    | 'lowest_latency'
    | 'rate_limit_aware'
    | 'random';
  readonly active: boolean;
  readonly fallbackModels: readonly string[];
  readonly sessionAffinity?: boolean;
  readonly preferredCredential?: string;
  readonly candidates: readonly RoutePreviewCandidate[];
}

export interface RoutePreviewCandidate {
  readonly modelAlias: string;
  readonly providerName: string;
  readonly providerType: LioraConfig['providers'][string]['type'];
  readonly providerModel: string;
  readonly weight?: number;
  readonly credentialLabel?: string;
  readonly credentialSource: string;
  readonly auth: 'api_key' | 'oauth' | 'keyless' | 'none' | 'vertexai_service_account';
  readonly baseUrl?: string;
  readonly rpm?: number;
  readonly tpm?: number;
  readonly preferred?: boolean;
}

export interface ProviderAutoRouteResult {
  readonly aliases: readonly string[];
  readonly models?: LioraConfig['models'];
}

export interface ProviderCredentialPreview {
  readonly credentialLabel?: string;
  readonly credentialSource: string;
  readonly auth: RoutePreviewCandidate['auth'];
  readonly baseUrl?: string;
  readonly rpm?: number;
  readonly tpm?: number;
}

export interface OAuthCredentialPreview {
  readonly ref: ConfigOAuthRef;
  readonly source: string;
}

export type ConfigOAuthRef = NonNullable<LioraConfig['providers'][string]['oauth']>;
export type ConfigProviderCredential = NonNullable<
  LioraConfig['providers'][string]['credentials']
>[number];
export type ConfigModelAlias = NonNullable<LioraConfig['models']>[string];

export interface ProviderApiKeySlot {
  readonly apiKey: string;
  readonly credentialSource?: string;
  readonly baseUrl?: string;
  readonly label?: string;
  readonly rpm?: number;
  readonly tpm?: number;
}

export interface ProviderDoctorReport {
  readonly ok: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly routeCount: number;
  readonly candidateCount: number;
  readonly issues: readonly ProviderDoctorIssue[];
}

export interface ProviderDoctorIssue {
  readonly level: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
  readonly providerId?: string;
  readonly modelAlias?: string;
  readonly envVar?: string;
}

export type { ProviderRouteStatus };

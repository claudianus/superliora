import { join } from 'node:path';

import {
  defaultRefreshThreshold,
  FileTokenStorage,
  listProviderOAuthRefs,
  OAUTH_PROACTIVE_REFRESH_INTERVAL_MS,
  resolveKimiTokenStorageName,
  SUPERLIORA_PROVIDER_NAME,
  type ProviderOAuthRef,
} from '@superliora/oauth';
import type { LioraConfig } from '../config';

export interface SessionOAuthStatusSnapshot {
  readonly poolSize?: number;
  readonly nextRefreshAtMs?: number;
}

export interface BuildSessionOAuthStatusInput {
  readonly config: LioraConfig;
  readonly homeDir: string;
  readonly modelAlias?: string | undefined;
  readonly nowMs?: number | undefined;
}

/** Derive OAuth pool snapshot for SessionStatus from config + token storage. */
export async function buildSessionOAuthStatus(
  input: BuildSessionOAuthStatusInput,
): Promise<SessionOAuthStatusSnapshot | undefined> {
  const providerName = resolveOAuthProviderName(input.config, input.modelAlias);
  if (providerName === undefined) return undefined;

  const provider = input.config.providers[providerName];
  const refs = listProviderOAuthRefs(provider as Record<string, unknown> | undefined);
  if (refs.length === 0) return undefined;

  const nowMs = input.nowMs ?? Date.now();
  const nextRefreshAtMs = await resolveNextOAuthRefreshAtMs({
    homeDir: input.homeDir,
    providerName,
    primaryRef: refs[0]!,
    nowMs,
  });

  return {
    poolSize: refs.length,
    ...(nextRefreshAtMs !== undefined ? { nextRefreshAtMs } : {}),
  };
}

function resolveOAuthProviderName(
  config: LioraConfig,
  modelAlias?: string,
): string | undefined {
  const alias = modelAlias?.trim() ?? config.defaultModel?.trim();
  if (alias !== undefined && alias.length > 0) {
    const model = config.models?.[alias];
    const providerName = model?.provider ?? config.defaultProvider;
    if (providerName !== undefined && config.providers[providerName] !== undefined) {
      return providerName;
    }
  }

  if (config.providers[SUPERLIORA_PROVIDER_NAME] !== undefined) {
    return SUPERLIORA_PROVIDER_NAME;
  }

  for (const [name, provider] of Object.entries(config.providers)) {
    if (listProviderOAuthRefs(provider as Record<string, unknown>).length > 0) {
      return name;
    }
  }
  return undefined;
}

async function resolveNextOAuthRefreshAtMs(input: {
  readonly homeDir: string;
  readonly providerName: string;
  readonly primaryRef: ProviderOAuthRef;
  readonly nowMs: number;
}): Promise<number | undefined> {
  const proactiveAtMs = input.nowMs + OAUTH_PROACTIVE_REFRESH_INTERVAL_MS;
  const tokenRefreshAtMs = await peekPrimaryTokenRefreshAtMs(input);
  if (tokenRefreshAtMs === undefined) return proactiveAtMs;
  return Math.min(proactiveAtMs, tokenRefreshAtMs);
}

async function peekPrimaryTokenRefreshAtMs(input: {
  readonly homeDir: string;
  readonly providerName: string;
  readonly primaryRef: ProviderOAuthRef;
  readonly nowMs: number;
}): Promise<number | undefined> {
  const storageName =
    input.providerName === SUPERLIORA_PROVIDER_NAME
      ? resolveKimiTokenStorageName({ oauthKey: input.primaryRef.key })
      : (input.primaryRef.key?.trim() || input.providerName);
  if (storageName.length === 0) return undefined;

  const storage = new FileTokenStorage(join(input.homeDir, 'credentials'));
  const token = await storage.load(storageName);
  if (token === undefined || token.expiresAt <= 0) return undefined;

  const refreshAtSec = token.expiresAt - defaultRefreshThreshold(token.expiresIn);
  const refreshAtMs = refreshAtSec * 1000;
  return refreshAtMs <= input.nowMs ? input.nowMs : refreshAtMs;
}

import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

import { DEFAULT_SUPERLIORA_OAUTH_HOST } from './constants';
import { DEFAULT_SUPERLIORA_BASE_URL } from './managed-usage';
import { isRecord } from './utils';
import {
  SUPERLIORA_OAUTH_KEY,
  SUPERLIORA_SCOPED_OAUTH_KEY_PREFIX,
} from './managed-kimi-code-constants';
import type {
  ManagedKimiOAuthRef,
  ManagedKimiOAuthRefInput,
  ManagedKimiProviderConfig,
} from './managed-kimi-code-types';
import { defaultBaseUrl, normalizeEndpoint } from './managed-kimi-code-url';

function persistedOAuthHost(options: {
  readonly key: string;
  readonly oauthHost?: string | undefined;
}): string | undefined {
  const oauthHost = options.oauthHost;
  const normalized = normalizeEndpoint(oauthHost ?? DEFAULT_SUPERLIORA_OAUTH_HOST);
  if (
    options.key === SUPERLIORA_OAUTH_KEY &&
    normalized === normalizeEndpoint(DEFAULT_SUPERLIORA_OAUTH_HOST)
  ) {
    return undefined;
  }
  return normalized;
}

export function managedOAuthRef(options: {
  readonly key: string;
  readonly oauthHost?: string | undefined;
  readonly storage?: 'file' | 'keyring' | undefined;
  readonly label?: string | undefined;
}): ManagedKimiOAuthRef {
  const oauthHost = persistedOAuthHost(options);
  const label = options.label?.trim();
  return {
    storage: options.storage ?? 'file',
    key: options.key,
    oauthHost,
    ...(label === undefined || label.length === 0 ? {} : { label }),
  };
}

export function configuredOAuthRef(
  oauthRef: ManagedKimiOAuthRefInput | undefined,
): ManagedKimiOAuthRef | undefined {
  if (oauthRef === undefined) return undefined;
  const key = oauthRef.key;
  if (key === undefined) return undefined;
  return managedOAuthRef({
    storage: oauthRef.storage,
    key,
    oauthHost: oauthRef.oauthHost,
    label: oauthRef.label,
  });
}

function uniqueManagedOAuthRefs(refs: readonly ManagedKimiOAuthRef[]): ManagedKimiOAuthRef[] {
  const unique: ManagedKimiOAuthRef[] = [];
  for (const ref of refs) {
    if (unique.some((existing) => sameManagedOAuthRef(existing, ref))) continue;
    unique.push(ref);
  }
  return unique;
}

function sameManagedOAuthRef(left: ManagedKimiOAuthRef, right: ManagedKimiOAuthRef): boolean {
  return (
    left.storage === right.storage &&
    left.key === right.key &&
    (left.oauthHost ?? '') === (right.oauthHost ?? '')
  );
}

export function managedOAuthPool(
  primary: ManagedKimiOAuthRef,
  existingProvider: ManagedKimiProviderConfig | Record<string, unknown> | undefined,
): ManagedKimiOAuthRef[] {
  const refs: ManagedKimiOAuthRef[] = [primary];
  if (isRecord(existingProvider)) {
    const existingPrimary = configuredOAuthRef(
      existingProvider['oauth'] as ManagedKimiOAuthRefInput,
    );
    if (existingPrimary !== undefined) refs.push(existingPrimary);
    const existingFallbacks = existingProvider['oauths'];
    if (Array.isArray(existingFallbacks)) {
      for (const ref of existingFallbacks) {
        const configured = configuredOAuthRef(ref as ManagedKimiOAuthRefInput);
        if (configured !== undefined) refs.push(configured);
      }
    }
  }
  return uniqueManagedOAuthRefs(refs);
}

export function listManagedKimiOAuthRefs(
  provider: ManagedKimiProviderConfig | Record<string, unknown> | undefined,
): ManagedKimiOAuthRef[] {
  if (!isRecord(provider)) return [];
  const refs: ManagedKimiOAuthRef[] = [];
  const primary = configuredOAuthRef(provider['oauth'] as ManagedKimiOAuthRefInput);
  if (primary !== undefined) refs.push(primary);
  if (Array.isArray(provider['oauths'])) {
    for (const entry of provider['oauths']) {
      const ref = configuredOAuthRef(entry as ManagedKimiOAuthRefInput);
      if (ref !== undefined) refs.push(ref);
    }
  }
  return uniqueManagedOAuthRefs(refs);
}

function sanitizeOAuthAccountLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim().toLowerCase();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  const slug = trimmed
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length === 0 ? undefined : slug;
}

/**
 * Allocate a fresh OAuth storage key for an additional login account so the
 * existing primary/fallback refs stay intact. When no provider accounts exist
 * yet, returns the canonical default key so the first login stays stable.
 */
export function allocateManagedKimiOAuthAccountKey(
  provider: ManagedKimiProviderConfig | Record<string, unknown> | undefined,
  options: {
    readonly oauthHost?: string | undefined;
    readonly baseUrl?: string | undefined;
    readonly label?: string | undefined;
    readonly now?: (() => number) | undefined;
    readonly randomBytes?: ((size: number) => Uint8Array) | undefined;
  } = {},
): ManagedKimiOAuthRef {
  const existing = listManagedKimiOAuthRefs(provider);
  const oauthHost = options.oauthHost;
  const baseUrl = options.baseUrl;
  if (existing.length === 0) {
    return managedOAuthRef({
      key: resolveKimiCodeOAuthKey({ oauthHost, baseUrl }),
      oauthHost,
    });
  }

  const used = new Set(existing.map((ref) => ref.key));
  const labelSlug = sanitizeOAuthAccountLabel(options.label);
  if (labelSlug !== undefined) {
    const labeledKey = `oauth/kimi-code-${labelSlug}`;
    if (!used.has(labeledKey)) {
      return managedOAuthRef({ key: labeledKey, oauthHost });
    }
  }

  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? ((size: number) => nodeRandomBytes(size));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stamp = now().toString(36);
    const entropy = Buffer.from(randomBytes(4)).toString('hex');
    const key = `oauth/kimi-code-account-${stamp}${attempt === 0 ? '' : `-${String(attempt)}`}-${entropy}`;
    if (!used.has(key)) {
      return managedOAuthRef({ key, oauthHost });
    }
  }

  // Extremely unlikely collision path: fall back to a full sha digest.
  const digest = createHash('sha256')
    .update(JSON.stringify({ used: [...used], at: now() }))
    .digest('hex')
    .slice(0, 16);
  return managedOAuthRef({ key: `oauth/kimi-code-account-${digest}`, oauthHost });
}

export function resolveKimiCodeOAuthKey(options: {
  readonly oauthHost?: string | undefined;
  readonly baseUrl?: string | undefined;
}): string {
  const oauthHost = normalizeEndpoint(options.oauthHost ?? DEFAULT_SUPERLIORA_OAUTH_HOST);
  const baseUrl = defaultBaseUrl(options.baseUrl);
  const defaultOauthHost = normalizeEndpoint(DEFAULT_SUPERLIORA_OAUTH_HOST);
  const defaultApiBaseUrl = normalizeEndpoint(DEFAULT_SUPERLIORA_BASE_URL);

  if (oauthHost === defaultOauthHost && baseUrl === defaultApiBaseUrl) {
    return SUPERLIORA_OAUTH_KEY;
  }

  const digest = createHash('sha256')
    .update(JSON.stringify({ oauthHost, baseUrl }))
    .digest('hex')
    .slice(0, 16);
  return `${SUPERLIORA_SCOPED_OAUTH_KEY_PREFIX}${digest}`;
}

/**
 * Resolve the full managed-Kimi-Code OAuth ref (credential storage key +
 * persisted host) for an (oauthHost, baseUrl) environment.
 *
 * Single source of truth for "which credential slot does this environment map
 * to". Login, provisioning, and the runtime provider all derive their ref
 * through here, so the slot a token is written to always matches the slot it
 * is later read from — preventing the env-mismatch credential mix-ups this
 * scoping is meant to fix.
 */
export function resolveKimiCodeOAuthRef(options: {
  readonly oauthHost?: string | undefined;
  readonly baseUrl?: string | undefined;
}): ManagedKimiOAuthRef {
  return managedOAuthRef({
    key: resolveKimiCodeOAuthKey(options),
    oauthHost: options.oauthHost,
  });
}
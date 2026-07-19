/**
 * Shared OAuth account-pool helpers for non-Kimi providers (xAI Grok, OpenAI
 * Codex, Anthropic OAuth, …). Mirrors the managed-Kimi multi-account model:
 * primary `oauth` + fallback `oauths[]`, each pointing at a distinct token
 * storage key so quota/rate-limit failover can rotate accounts.
 */

import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';

export interface ProviderOAuthRef {
  readonly storage: 'file' | 'keyring';
  readonly key: string;
  readonly oauthHost?: string | undefined;
  readonly label?: string | undefined;
}

type ProviderOAuthRefInput = {
  readonly storage?: 'file' | 'keyring' | undefined;
  readonly key?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly label?: string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configuredOAuthRef(oauthRef: ProviderOAuthRefInput | undefined): ProviderOAuthRef | undefined {
  if (oauthRef === undefined) return undefined;
  const key = oauthRef.key?.trim();
  if (key === undefined || key.length === 0) return undefined;
  const label = oauthRef.label?.trim();
  const oauthHost = oauthRef.oauthHost?.trim();
  return {
    storage: oauthRef.storage ?? 'file',
    key,
    ...(oauthHost === undefined || oauthHost.length === 0 ? {} : { oauthHost }),
    ...(label === undefined || label.length === 0 ? {} : { label }),
  };
}

function sameOAuthRef(left: ProviderOAuthRef, right: ProviderOAuthRef): boolean {
  return (
    left.storage === right.storage &&
    left.key === right.key &&
    (left.oauthHost ?? '') === (right.oauthHost ?? '')
  );
}

function uniqueOAuthRefs(refs: readonly ProviderOAuthRef[]): ProviderOAuthRef[] {
  const unique: ProviderOAuthRef[] = [];
  for (const ref of refs) {
    if (unique.some((existing) => sameOAuthRef(existing, ref))) continue;
    unique.push(ref);
  }
  return unique;
}

/** Lists primary + fallback OAuth refs for a provider config object. */
export function listProviderOAuthRefs(
  provider: Record<string, unknown> | undefined,
): ProviderOAuthRef[] {
  if (!isRecord(provider)) return [];
  const refs: ProviderOAuthRef[] = [];
  const primary = configuredOAuthRef(provider['oauth'] as ProviderOAuthRefInput | undefined);
  if (primary !== undefined) refs.push(primary);
  if (Array.isArray(provider['oauths'])) {
    for (const entry of provider['oauths']) {
      const ref = configuredOAuthRef(entry as ProviderOAuthRefInput);
      if (ref !== undefined) refs.push(ref);
    }
  }
  return uniqueOAuthRefs(refs);
}

/**
 * Builds the next provider config after a successful OAuth login.
 *
 * - First login / refresh of the primary: single `oauth` ref.
 * - Add-account: new ref becomes primary; previous primary + fallbacks move
 *   into `oauths` so the runtime route pool can fail over.
 */
export function mergeProviderOAuthLogin(
  existingProvider: Record<string, unknown> | undefined,
  loginRef: ProviderOAuthRef,
  options: {
    readonly addAccount?: boolean | undefined;
    readonly baseUrl?: string | undefined;
    readonly type?: string | undefined;
    readonly customHeaders?: Readonly<Record<string, string>> | undefined;
  } = {},
): Record<string, unknown> {
  const existing = isRecord(existingProvider) ? { ...existingProvider } : {};
  const existingRefs = listProviderOAuthRefs(existing);
  const nextPrimary = {
    storage: loginRef.storage,
    key: loginRef.key,
    ...(loginRef.oauthHost === undefined ? {} : { oauthHost: loginRef.oauthHost }),
    ...(loginRef.label === undefined ? {} : { label: loginRef.label }),
  };

  let oauths: ProviderOAuthRef[] | undefined;
  if (options.addAccount === true && existingRefs.length > 0) {
    oauths = uniqueOAuthRefs(
      existingRefs.filter((ref) => !sameOAuthRef(ref, nextPrimary)),
    );
  } else if (options.addAccount !== true && existingRefs.length > 1) {
    // Refresh primary: keep existing fallbacks, just rewrite the primary key.
    oauths = uniqueOAuthRefs(
      existingRefs
        .slice(1)
        .filter((ref) => !sameOAuthRef(ref, nextPrimary)),
    );
  }

  const next: Record<string, unknown> = {
    ...existing,
    ...(options.type === undefined ? {} : { type: options.type }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    oauth: nextPrimary,
  };
  if (options.customHeaders !== undefined) {
    next['customHeaders'] = { ...options.customHeaders };
  }
  if (oauths !== undefined && oauths.length > 0) {
    next['oauths'] = oauths;
  } else {
    delete next['oauths'];
  }
  return next;
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
 * Allocate a fresh OAuth storage key for an additional account under
 * `providerId`. When no accounts exist yet, returns the canonical default key
 * so the first login stays on the stable filename.
 */
export function allocateProviderOAuthAccountKey(
  providerId: string,
  provider: Record<string, unknown> | undefined,
  options: {
    readonly defaultKey?: string | undefined;
    readonly label?: string | undefined;
    readonly now?: (() => number) | undefined;
    readonly randomBytes?: ((size: number) => Uint8Array) | undefined;
  } = {},
): ProviderOAuthRef {
  const defaultKey =
    options.defaultKey ??
    providerId.replace(/^managed:/, '').replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  const existing = listProviderOAuthRefs(provider);
  if (existing.length === 0) {
    return { storage: 'file', key: defaultKey };
  }

  const used = new Set(existing.map((ref) => ref.key));
  const labelSlug = sanitizeOAuthAccountLabel(options.label);
  if (labelSlug !== undefined) {
    const labeledKey = `${defaultKey}-${labelSlug}`;
    if (!used.has(labeledKey)) {
      return { storage: 'file', key: labeledKey, label: labelSlug };
    }
  }

  const now = options.now ?? Date.now;
  const randomBytes = options.randomBytes ?? ((size: number) => nodeRandomBytes(size));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const stamp = now().toString(36);
    const entropy = Buffer.from(randomBytes(4)).toString('hex');
    const key = `${defaultKey}-account-${stamp}${attempt === 0 ? '' : `-${String(attempt)}`}-${entropy}`;
    if (!used.has(key)) {
      return { storage: 'file', key };
    }
  }

  const digest = createHash('sha256')
    .update(JSON.stringify({ used: [...used], at: now() }))
    .digest('hex')
    .slice(0, 16);
  return { storage: 'file', key: `${defaultKey}-account-${digest}` };
}

/**
 * Display credential label validation (CLI + TUI). Distinct from
 * {@link sanitizeOAuthAccountLabel}, which only produces storage-key slugs.
 */
export function isValidProviderOAuthCredentialLabel(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value);
}

/** Short stable fingerprint for an OAuth ref (list rows, CLI output). */
export function fingerprintProviderOAuthRef(ref: ProviderOAuthRef): string {
  return createHash('sha256')
    .update(JSON.stringify([ref.storage, ref.key, ref.oauthHost ?? '']))
    .digest('hex')
    .slice(0, 12);
}

function serializeOAuthRef(ref: ProviderOAuthRef): ProviderOAuthRef {
  return {
    storage: ref.storage,
    key: ref.key,
    ...(ref.oauthHost === undefined || ref.oauthHost.length === 0
      ? {}
      : { oauthHost: ref.oauthHost }),
    ...(ref.label === undefined || ref.label.length === 0 ? {} : { label: ref.label }),
  };
}

/**
 * Rewrites a provider config so `oauth` is the primary ref and `oauths` holds
 * the fallbacks. Empty refs drop both fields.
 */
export function rewriteProviderOAuthRefs(
  provider: Record<string, unknown> | undefined,
  refs: readonly ProviderOAuthRef[],
): Record<string, unknown> {
  const base = isRecord(provider) ? { ...provider } : {};
  delete base['oauth'];
  delete base['oauths'];
  const unique = uniqueOAuthRefs(refs.map(serializeOAuthRef));
  if (unique.length === 0) return base;
  return {
    ...base,
    oauth: unique[0],
    // Always set oauths (even []) so deep-merge setConfig clears stale fallbacks.
    oauths: unique.slice(1),
  };
}

/** Move `values[index]` to the front (primary). No-op for index 0 / OOB. */
export function promoteProviderOAuthSlot<T>(values: readonly T[], index: number): T[] {
  if (index <= 0 || index >= values.length) return [...values];
  return [values[index]!, ...values.slice(0, index), ...values.slice(index + 1)];
}

export type PromoteProviderOAuthResult =
  | { readonly ok: true; readonly provider: Record<string, unknown>; readonly alreadyPrimary: boolean }
  | { readonly ok: false; readonly reason: 'empty' | 'index_out_of_range' };

/** Promote the OAuth ref at 0-based `index` to primary. */
export function promoteProviderOAuthRef(
  provider: Record<string, unknown> | undefined,
  index: number,
): PromoteProviderOAuthResult {
  const refs = listProviderOAuthRefs(provider);
  if (refs.length === 0) return { ok: false, reason: 'empty' };
  if (index < 0 || index >= refs.length) return { ok: false, reason: 'index_out_of_range' };
  if (index === 0) {
    return {
      ok: true,
      alreadyPrimary: true,
      provider: rewriteProviderOAuthRefs(provider, refs),
    };
  }
  return {
    ok: true,
    alreadyPrimary: false,
    provider: rewriteProviderOAuthRefs(provider, promoteProviderOAuthSlot(refs, index)),
  };
}

export type LabelProviderOAuthResult =
  | { readonly ok: true; readonly provider: Record<string, unknown> }
  | {
      readonly ok: false;
      readonly reason: 'empty' | 'index_out_of_range' | 'invalid_label' | 'duplicate_label';
    };

/** Set or clear the display label on the OAuth ref at 0-based `index`. */
export function labelProviderOAuthRef(
  provider: Record<string, unknown> | undefined,
  index: number,
  label: string | undefined,
): LabelProviderOAuthResult {
  const refs = listProviderOAuthRefs(provider);
  if (refs.length === 0) return { ok: false, reason: 'empty' };
  if (index < 0 || index >= refs.length) return { ok: false, reason: 'index_out_of_range' };

  let nextLabel: string | undefined;
  if (label !== undefined) {
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      nextLabel = undefined;
    } else if (!isValidProviderOAuthCredentialLabel(trimmed)) {
      return { ok: false, reason: 'invalid_label' };
    } else {
      const duplicate = refs.some(
        (ref, refIndex) =>
          refIndex !== index && ref.label?.toLowerCase() === trimmed.toLowerCase(),
      );
      if (duplicate) return { ok: false, reason: 'duplicate_label' };
      nextLabel = trimmed;
    }
  }

  const nextRefs = refs.map((ref, refIndex) => {
    if (refIndex !== index) return ref;
    const { label: _prev, ...rest } = ref;
    return nextLabel === undefined ? rest : { ...rest, label: nextLabel };
  });
  return { ok: true, provider: rewriteProviderOAuthRefs(provider, nextRefs) };
}

export type RemoveProviderOAuthResult =
  | { readonly ok: true; readonly provider: Record<string, unknown>; readonly remaining: number }
  | { readonly ok: false; readonly reason: 'empty' | 'index_out_of_range' };

/** Remove the OAuth ref at 0-based `index`. */
export function removeProviderOAuthRef(
  provider: Record<string, unknown> | undefined,
  index: number,
): RemoveProviderOAuthResult {
  const refs = listProviderOAuthRefs(provider);
  if (refs.length === 0) return { ok: false, reason: 'empty' };
  if (index < 0 || index >= refs.length) return { ok: false, reason: 'index_out_of_range' };
  const nextRefs = refs.filter((_, refIndex) => refIndex !== index);
  return {
    ok: true,
    remaining: nextRefs.length,
    provider: rewriteProviderOAuthRefs(provider, nextRefs),
  };
}

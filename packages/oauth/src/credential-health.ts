/**
 * Credential health cache for multi-provider OAuth / API keys.
 *
 * Failure-driven (no per-turn network probe): callers mark reject/expiry after
 * real auth failures; readers use the cache to set `available=false` before
 * role assignment and route candidate expansion.
 *
 * Usage snapshots (TUI UsageMonitor / getAllProvidersUsage) may also mark
 * provider-level quota exhaustion via {@link applyUsageSnapshotsToCredentialHealth}
 * so smart routing skips exhausted plans before the next failed API call.
 */

import type {
  AllProvidersUsageSnapshot,
  ProviderUsageRow,
  ProviderUsageSnapshot,
} from './provider-usage/provider-usage-types';

export type CredentialHealthStatus =
  | 'healthy'
  | 'auth_rejected'
  | 'expired'
  | 'rate_limited'
  | 'unknown';

export interface CredentialHealthRecord {
  readonly providerId: string;
  readonly credentialKey: string;
  readonly status: CredentialHealthStatus;
  readonly failureReason?: string;
  readonly updatedAt: number;
  readonly cooldownUntil?: number;
}

export interface CredentialHealthKey {
  readonly providerId: string;
  readonly credentialKey?: string;
}

const DEFAULT_AUTH_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;
/** Quota-exhausted cooldown (~1h) — usage snapshots can clear earlier when headroom returns. */
export const DEFAULT_QUOTA_COOLDOWN_MS = 60 * 60_000;
/** Failure reason stamped when usage snapshot reports exhausted quota. */
export const QUOTA_EXHAUSTED_FAILURE_REASON = 'quota_exhausted';

function normalizeKey(providerId: string, credentialKey?: string): string {
  const id = providerId.trim();
  const cred = (credentialKey ?? 'default').trim() || 'default';
  return `${id}::${cred}`;
}

export function credentialHealthCacheKey(
  providerId: string,
  credentialKey?: string,
): string {
  return normalizeKey(providerId, credentialKey);
}

/** Process-local health map (shared across managers in the same process). */
const globalHealth = new Map<string, CredentialHealthRecord>();

export class CredentialHealthStore {
  constructor(private readonly store: Map<string, CredentialHealthRecord> = globalHealth) {}

  get(providerId: string, credentialKey?: string): CredentialHealthRecord | undefined {
    return this.store.get(normalizeKey(providerId, credentialKey));
  }

  /**
   * True when the credential may be offered as a route/role candidate.
   * Unknown (never seen) is treated as available.
   */
  isAvailable(providerId: string, credentialKey?: string, now = Date.now()): boolean {
    const record = this.get(providerId, credentialKey);
    if (record === undefined) return true;
    if (record.status === 'healthy' || record.status === 'unknown') return true;
    if (record.cooldownUntil !== undefined && record.cooldownUntil <= now) {
      return true;
    }
    return false;
  }

  failureReason(
    providerId: string,
    credentialKey?: string,
    now = Date.now(),
  ): string | undefined {
    const record = this.get(providerId, credentialKey);
    if (record === undefined) return undefined;
    if (this.isAvailable(providerId, credentialKey, now)) return undefined;
    return record.failureReason ?? record.status;
  }

  markHealthy(providerId: string, credentialKey?: string, now = Date.now()): CredentialHealthRecord {
    const record: CredentialHealthRecord = {
      providerId: providerId.trim(),
      credentialKey: (credentialKey ?? 'default').trim() || 'default',
      status: 'healthy',
      updatedAt: now,
    };
    this.store.set(normalizeKey(providerId, credentialKey), record);
    return record;
  }

  markAuthRejected(
    providerId: string,
    options?: {
      readonly credentialKey?: string;
      readonly failureReason?: string;
      readonly cooldownMs?: number;
      readonly now?: number;
    },
  ): CredentialHealthRecord {
    const now = options?.now ?? Date.now();
    const cooldownMs = options?.cooldownMs ?? DEFAULT_AUTH_COOLDOWN_MS;
    const record: CredentialHealthRecord = {
      providerId: providerId.trim(),
      credentialKey: (options?.credentialKey ?? 'default').trim() || 'default',
      status: 'auth_rejected',
      failureReason: options?.failureReason ?? 'OAuth provider credentials were rejected',
      updatedAt: now,
      cooldownUntil: now + cooldownMs,
    };
    this.store.set(normalizeKey(providerId, options?.credentialKey), record);
    return record;
  }

  markExpired(
    providerId: string,
    options?: {
      readonly credentialKey?: string;
      readonly failureReason?: string;
      readonly cooldownMs?: number;
      readonly now?: number;
    },
  ): CredentialHealthRecord {
    const now = options?.now ?? Date.now();
    const cooldownMs = options?.cooldownMs ?? DEFAULT_AUTH_COOLDOWN_MS;
    const record: CredentialHealthRecord = {
      providerId: providerId.trim(),
      credentialKey: (options?.credentialKey ?? 'default').trim() || 'default',
      status: 'expired',
      failureReason: options?.failureReason ?? 'credential expired',
      updatedAt: now,
      cooldownUntil: now + cooldownMs,
    };
    this.store.set(normalizeKey(providerId, options?.credentialKey), record);
    return record;
  }

  markRateLimited(
    providerId: string,
    options?: {
      readonly credentialKey?: string;
      readonly failureReason?: string;
      readonly cooldownMs?: number;
      readonly now?: number;
    },
  ): CredentialHealthRecord {
    const now = options?.now ?? Date.now();
    const cooldownMs = options?.cooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
    const record: CredentialHealthRecord = {
      providerId: providerId.trim(),
      credentialKey: (options?.credentialKey ?? 'default').trim() || 'default',
      status: 'rate_limited',
      failureReason: options?.failureReason ?? 'rate limited',
      updatedAt: now,
      cooldownUntil: now + cooldownMs,
    };
    this.store.set(normalizeKey(providerId, options?.credentialKey), record);
    return record;
  }

  /**
   * Mark provider-level quota exhaustion (usage snapshot or clear 429 quota error).
   * Uses {@link DEFAULT_QUOTA_COOLDOWN_MS} (~1h) unless overridden.
   */
  markQuotaExhausted(
    providerId: string,
    options?: {
      readonly credentialKey?: string;
      readonly failureReason?: string;
      readonly cooldownMs?: number;
      readonly now?: number;
    },
  ): CredentialHealthRecord {
    return this.markRateLimited(providerId, {
      credentialKey: options?.credentialKey,
      failureReason: options?.failureReason ?? QUOTA_EXHAUSTED_FAILURE_REASON,
      cooldownMs: options?.cooldownMs ?? DEFAULT_QUOTA_COOLDOWN_MS,
      now: options?.now,
    });
  }

  clear(providerId?: string, credentialKey?: string): void {
    if (providerId === undefined) {
      this.store.clear();
      return;
    }
    if (credentialKey !== undefined) {
      this.store.delete(normalizeKey(providerId, credentialKey));
      return;
    }
    const prefix = `${providerId.trim()}::`;
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  snapshot(): readonly CredentialHealthRecord[] {
    return [...this.store.values()];
  }
}

/** Shared process-local store used by agent-core and oauth callers. */
export const sharedCredentialHealthStore = new CredentialHealthStore();

/**
 * Provider keys whose usage snapshots may mark routing health as quota-exhausted.
 * Token-plan family only — subscription/header probes elsewhere stay best-effort UI.
 */
const QUOTA_HEALTH_PROVIDER_KEYS = new Set([
  'qwen-token-plan',
  'alibaba-token-plan',
  'alibaba-token-plan-cn',
]);

const QUOTA_ERROR_RE =
  /quota\s*(may be\s*)?exhaust|quota[_\s-]?exceed|insufficient\s*quota|out of quota|credit[s]?\s*(exhausted|exceeded|depleted)|rate limited\s*[—-]\s*quota/i;

export type ApplyUsageSnapshotsToCredentialHealthResult = {
  readonly exhausted: readonly string[];
  readonly cleared: readonly string[];
  readonly skipped: readonly string[];
};

function usageRowExhausted(row: ProviderUsageRow | null | undefined): boolean {
  if (row === null || row === undefined) return false;
  if (!(row.limit > 0)) return false;
  return row.used >= row.limit;
}

/** True when a usage snapshot clearly indicates provider-level quota exhaustion. */
export function isProviderUsageQuotaExhausted(snapshot: ProviderUsageSnapshot): boolean {
  if (usageRowExhausted(snapshot.summary)) return true;
  for (const row of snapshot.limits) {
    if (usageRowExhausted(row)) return true;
  }
  const error = snapshot.error?.trim();
  if (error !== undefined && error.length > 0 && QUOTA_ERROR_RE.test(error)) {
    return true;
  }
  return false;
}

/**
 * Whether a usage snapshot has enough signal to clear a prior quota_exhausted mark.
 * Requires a successful fetch with at least one quota row still under limit.
 */
export function canClearQuotaExhaustionFromUsage(snapshot: ProviderUsageSnapshot): boolean {
  if (snapshot.error !== undefined && snapshot.error.trim().length > 0) return false;
  if (!snapshot.available) return false;
  const rows: ProviderUsageRow[] = [];
  if (snapshot.summary !== null) rows.push(snapshot.summary);
  rows.push(...snapshot.limits);
  if (rows.length === 0) return false;
  return rows.every((row) => !usageRowExhausted(row));
}

function isQuotaHealthProviderKey(providerKey: string): boolean {
  return QUOTA_HEALTH_PROVIDER_KEYS.has(providerKey.trim());
}

/**
 * Apply provider usage snapshots onto credential health (provider-level keys).
 *
 * - used >= limit (summary or any limit row) → mark rate_limited / quota_exhausted (~1h cooldown)
 * - clear quota-exhausted error text → same mark
 * - successful under-limit snapshot → clear only prior quota_exhausted marks (not auth_rejected)
 * - never overwrites a live auth_rejected / expired record
 */
export function applyUsageSnapshotsToCredentialHealth(
  snapshots:
    | readonly ProviderUsageSnapshot[]
    | AllProvidersUsageSnapshot
    | ProviderUsageSnapshot,
  options?: {
    readonly store?: CredentialHealthStore;
    readonly now?: number;
    readonly cooldownMs?: number;
    /** When set, only these provider keys are considered (still filtered to token-plan family). */
    readonly providerKeys?: readonly string[];
  },
): ApplyUsageSnapshotsToCredentialHealthResult {
  const store = options?.store ?? sharedCredentialHealthStore;
  const now = options?.now ?? Date.now();
  const cooldownMs = options?.cooldownMs ?? DEFAULT_QUOTA_COOLDOWN_MS;

  const list: readonly ProviderUsageSnapshot[] = Array.isArray(snapshots)
    ? snapshots
    : 'providers' in snapshots
      ? snapshots.providers
      : [snapshots];

  const allow =
    options?.providerKeys === undefined
      ? undefined
      : new Set(options.providerKeys.map((k) => k.trim()));

  const exhausted: string[] = [];
  const cleared: string[] = [];
  const skipped: string[] = [];

  for (const snap of list) {
    const providerKey = snap.providerKey.trim();
    if (!isQuotaHealthProviderKey(providerKey)) {
      skipped.push(providerKey);
      continue;
    }
    if (allow !== undefined && !allow.has(providerKey)) {
      skipped.push(providerKey);
      continue;
    }

    const existing = store.get(providerKey);
    // Never clobber a real auth rejection / expiry with usage-derived state.
    if (
      existing !== undefined &&
      (existing.status === 'auth_rejected' || existing.status === 'expired') &&
      (existing.cooldownUntil === undefined || existing.cooldownUntil > now)
    ) {
      skipped.push(providerKey);
      continue;
    }

    if (isProviderUsageQuotaExhausted(snap)) {
      store.markQuotaExhausted(providerKey, {
        failureReason: QUOTA_EXHAUSTED_FAILURE_REASON,
        cooldownMs,
        now,
      });
      exhausted.push(providerKey);
      continue;
    }

    if (
      canClearQuotaExhaustionFromUsage(snap) &&
      existing?.status === 'rate_limited' &&
      existing.failureReason === QUOTA_EXHAUSTED_FAILURE_REASON
    ) {
      store.markHealthy(providerKey, undefined, now);
      cleared.push(providerKey);
      continue;
    }

    skipped.push(providerKey);
  }

  return { exhausted, cleared, skipped };
}

/**
 * Build role-catalog rows from provider model lists + health.
 * Models without credentials or with unhealthy oauth are `available: false`.
 */
export function annotateModelsWithCredentialHealth<
  T extends { readonly id: string; readonly provider: string; readonly alias?: string },
>(
  models: readonly T[],
  options: {
    readonly hasCredential: (providerId: string, model: T) => boolean;
    readonly credentialKey?: (providerId: string, model: T) => string | undefined;
    readonly store?: CredentialHealthStore;
    readonly now?: number;
  },
): Array<
  T & {
    readonly available: boolean;
    readonly failureReason?: string;
  }
> {
  const store = options.store ?? sharedCredentialHealthStore;
  const now = options.now ?? Date.now();
  return models.map((model) => {
    const providerId = model.provider;
    if (!options.hasCredential(providerId, model)) {
      return {
        ...model,
        available: false,
        failureReason: 'no_credential',
      };
    }
    const credKey = options.credentialKey?.(providerId, model);
    if (!store.isAvailable(providerId, credKey, now)) {
      return {
        ...model,
        available: false,
        failureReason: store.failureReason(providerId, credKey) ?? 'auth_unhealthy',
      };
    }
    return {
      ...model,
      available: true,
    };
  });
}

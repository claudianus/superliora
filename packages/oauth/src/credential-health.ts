/**
 * Credential health cache for multi-provider OAuth / API keys.
 *
 * Failure-driven (no per-turn network probe): callers mark reject/expiry after
 * real auth failures; readers use the cache to set `available=false` before
 * role assignment and route candidate expansion.
 */

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

/**
 * Alias-scoped route health (model ID retired / probe fail / 404).
 * Separate from CredentialHealthStore (provider/credential auth+quota).
 */

export type ModelRouteHealthKind = 'model_unavailable' | 'probe_fail' | 'route_fail';

export type ModelRouteHealthRecord = {
  readonly alias: string;
  readonly kind: ModelRouteHealthKind;
  readonly failureReason?: string;
  readonly updatedAt: number;
  readonly cooldownUntil: number;
};

export const DEFAULT_MODEL_UNAVAILABLE_COOLDOWN_MS = 60 * 60_000;
export const DEFAULT_PROBE_FAIL_COOLDOWN_MS = 10 * 60_000;
/** Real LLM traffic within this window proves alias liveness without a probe. */
export const TRAFFIC_SUCCESS_FRESH_MS = 5 * 60_000;

const globalAliasHealth = new Map<string, ModelRouteHealthRecord>();

function normalizeAlias(alias: string): string {
  return alias.trim();
}

export class ModelRouteHealthStore {
  private readonly trafficSuccessAt = new Map<string, number>();

  constructor(private readonly store: Map<string, ModelRouteHealthRecord> = globalAliasHealth) {}

  get(alias: string): ModelRouteHealthRecord | undefined {
    const key = normalizeAlias(alias);
    if (key.length === 0) return undefined;
    return this.store.get(key);
  }

  isAvailable(alias: string, now = Date.now()): boolean {
    const record = this.get(alias);
    if (record === undefined) return true;
    return record.cooldownUntil <= now;
  }

  failureReason(alias: string, now = Date.now()): string | undefined {
    const record = this.get(alias);
    if (record === undefined) return undefined;
    if (this.isAvailable(alias, now)) return undefined;
    return record.failureReason ?? record.kind;
  }

  markUnavailable(
    alias: string,
    options?: {
      readonly kind?: ModelRouteHealthKind;
      readonly failureReason?: string;
      readonly cooldownMs?: number;
      readonly now?: number;
    },
  ): ModelRouteHealthRecord | undefined {
    const key = normalizeAlias(alias);
    if (key.length === 0) return undefined;
    const kind = options?.kind ?? 'model_unavailable';
    const now = options?.now ?? Date.now();
    const cooldownMs =
      options?.cooldownMs ??
      (kind === 'model_unavailable'
        ? DEFAULT_MODEL_UNAVAILABLE_COOLDOWN_MS
        : DEFAULT_PROBE_FAIL_COOLDOWN_MS);
    const record: ModelRouteHealthRecord = {
      alias: key,
      kind,
      failureReason: options?.failureReason,
      updatedAt: now,
      cooldownUntil: now + cooldownMs,
    };
    this.store.set(key, record);
    return record;
  }

  markHealthy(alias: string): void {
    const key = normalizeAlias(alias);
    if (key.length === 0) return;
    this.store.delete(key);
  }

  /**
   * Record a successful real LLM call on this alias. Actual traffic is
   * stronger liveness evidence than any probe, so it also clears stale
   * cooldown marks.
   */
  markTrafficSuccess(alias: string, now: number = Date.now()): void {
    const key = normalizeAlias(alias);
    if (key.length === 0) return;
    this.trafficSuccessAt.set(key, now);
    this.store.delete(key);
  }

  lastTrafficSuccessAt(alias: string): number | undefined {
    return this.trafficSuccessAt.get(normalizeAlias(alias));
  }

  hasFreshTrafficSuccess(
    alias: string,
    now: number = Date.now(),
    windowMs: number = TRAFFIC_SUCCESS_FRESH_MS,
  ): boolean {
    const at = this.trafficSuccessAt.get(normalizeAlias(alias));
    return at !== undefined && now - at < windowMs;
  }

  clear(alias?: string): void {
    if (alias === undefined) {
      this.store.clear();
      this.trafficSuccessAt.clear();
      return;
    }
    const key = normalizeAlias(alias);
    if (key.length > 0) {
      this.store.delete(key);
      this.trafficSuccessAt.delete(key);
    }
  }

  snapshot(): readonly ModelRouteHealthRecord[] {
    return [...this.store.values()];
  }
}

/** Process-local store shared by smart-router, live-probe, and LLM failover. */
export const sharedModelRouteHealthStore = new ModelRouteHealthStore();

/** @internal */
export function resetModelRouteHealthStoreForTests(): void {
  sharedModelRouteHealthStore.clear();
}

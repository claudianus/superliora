/**
 * In-memory provider route state: candidate ordering, cooldowns, and usage.
 *
 * Extracted from kosong-llm so routing policy stays separate from chat I/O.
 */

import {
  emptyUsage,
  grandTotal,
  type ChatProvider,
  type TokenUsage,
} from '@superliora/kosong';

import type {
  ProviderRouteCandidateStatus,
  ProviderRouteRateLimitStatus,
  ProviderRouteStatus,
} from '#/rpc';
import type {
  KosongLLMRoute,
  KosongLLMRouteCandidate,
  ProviderRouteFailure,
  ProviderRouteState,
  ProviderRouteSuccessMetrics,
  ProviderRouteUnavailable,
} from './provider-route-types';
import {
  candidateKey,
  candidateWeight,
  compareRateLimitAwareCandidates,
  copyProviderRouteRateLimits,
  matchesPreferredCredential,
  normalizeLatencyMs,
  providerBaseUrl,
  rateLimitHeadroom,
  sameProviderRouteRateLimits,
  shuffleCandidates,
  type ProviderRouteCandidateStats,
  type ProviderRouteFailureRecord,
  type ProviderRouteLocalUsageRecord,
} from './provider-route-helpers';

export { providerBaseUrl } from './provider-route-helpers';

const LOCAL_LIMIT_WINDOW_MS = 60_000;

export class InMemoryProviderRouteState implements ProviderRouteState {
  private readonly failureByCandidate = new Map<string, ProviderRouteFailureRecord>();
  private readonly statsByCandidate = new Map<string, ProviderRouteCandidateStats>();
  private readonly rateLimitsByCandidate = new Map<
    string,
    readonly ProviderRouteRateLimitStatus[]
  >();
  private readonly localUsageByCandidate = new Map<string, ProviderRouteLocalUsageRecord>();
  private readonly roundRobinIndexByRoute = new Map<string, number>();
  private readonly weightedRoundRobinByRoute = new Map<string, Map<string, number>>();
  private readonly pinnedCandidateByRoute = new Map<string, string>();

  orderCandidates(route: KosongLLMRoute): readonly KosongLLMRouteCandidate[] {
    const available = route.candidates.filter((candidate) => !this.isUnavailable(candidate));
    const candidates = available.length > 0 ? available : route.candidates;
    if (candidates.length <= 1) return candidates;

    const preferred = this.preferredCandidate(route, candidates);
    if (preferred !== undefined) {
      return [preferred, ...candidates.filter((candidate) => candidate !== preferred)];
    }

    const pinned = this.pinnedCandidate(route, candidates);
    if (pinned !== undefined) {
      return [pinned, ...candidates.filter((candidate) => candidate !== pinned)];
    }

    if (route.strategy === 'auto') {
      return this.orderAuto(route, candidates);
    }

    if (route.strategy === 'least_used') {
      return candidates
        .map((candidate, index) => ({ candidate, index, requestCount: this.requestCount(candidate) }))
        .toSorted((left, right) => left.requestCount - right.requestCount || left.index - right.index)
        .map((entry) => entry.candidate);
    }

    if (route.strategy === 'lowest_latency') {
      return this.orderLowestLatency(candidates);
    }

    if (route.strategy === 'rate_limit_aware') {
      return this.orderRateLimitAware(candidates);
    }

    if (route.strategy === 'random') {
      return shuffleCandidates(candidates);
    }

    if (route.strategy === 'weighted_round_robin') {
      return this.orderWeightedRoundRobin(route, candidates);
    }

    if (route.strategy !== 'round_robin') return candidates;

    const start = this.roundRobinIndexByRoute.get(route.key) ?? 0;
    this.roundRobinIndexByRoute.set(route.key, (start + 1) % candidates.length);
    return [...candidates.slice(start), ...candidates.slice(0, start)];
  }

  unavailable(route: KosongLLMRoute): ProviderRouteUnavailable | undefined {
    const retryAts = route.candidates.map((candidate) => this.candidateUnavailableUntil(candidate));
    if (retryAts.some((retryAt) => retryAt === undefined)) return undefined;
    const retryAt = Math.min(...retryAts.map((value) => value ?? Number.POSITIVE_INFINITY));
    if (!Number.isFinite(retryAt)) return undefined;
    return { retryAt, retryAfterMs: Math.max(0, retryAt - Date.now()) };
  }

  reset(route: KosongLLMRoute): boolean {
    let changed = false;
    for (const candidate of route.candidates) {
      const key = candidateKey(candidate);
      changed = this.failureByCandidate.delete(key) || changed;
      changed = this.statsByCandidate.delete(key) || changed;
      changed = this.rateLimitsByCandidate.delete(key) || changed;
      changed = this.localUsageByCandidate.delete(key) || changed;
    }
    changed = this.deleteRoundRobinState(route.key) || changed;
    changed = this.weightedRoundRobinByRoute.delete(route.key) || changed;
    changed = this.pinnedCandidateByRoute.delete(route.key) || changed;
    return changed;
  }

  recordSuccess(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    metrics?: ProviderRouteSuccessMetrics,
  ): boolean {
    const key = candidateKey(candidate);
    const previous = this.statsByCandidate.get(key);
    this.recordLocalUsage(candidate, metrics?.usage);
    const latencyMs = normalizeLatencyMs(metrics?.latencyMs);
    const avgLatencyMs =
      latencyMs === undefined
        ? previous?.avgLatencyMs
        : previous?.avgLatencyMs === undefined
          ? latencyMs
          : Math.round(previous.avgLatencyMs * 0.8 + latencyMs * 0.2);
    this.statsByCandidate.set(key, {
      successCount: (previous?.successCount ?? 0) + 1,
      failureCount: previous?.failureCount ?? 0,
      lastSuccessAt: Date.now(),
      lastLatencyMs: latencyMs ?? previous?.lastLatencyMs,
      avgLatencyMs,
      lastFailureKind: previous?.lastFailureKind,
      lastFailureAt: previous?.lastFailureAt,
    });
    this.failureByCandidate.delete(key);
    if (route.sessionAffinity === true) {
      this.pinnedCandidateByRoute.set(route.key, key);
    }
    return true;
  }

  recordCooldown(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    failure: ProviderRouteFailure,
  ): boolean {
    const recordedAt = Date.now();
    const next = {
      kind: failure.kind,
      failedAt: recordedAt,
      cooldownUntil: recordedAt + failure.cooldownMs,
    };
    const key = candidateKey(candidate);
    const previous = this.failureByCandidate.get(key);
    this.failureByCandidate.set(key, next);
    this.clearPinnedCandidate(route, key);
    return (
      previous?.kind !== next.kind ||
      previous.failedAt !== next.failedAt ||
      previous.cooldownUntil !== next.cooldownUntil
    );
  }

  recordRateLimits(
    _route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    rateLimits: readonly ProviderRouteRateLimitStatus[],
  ): boolean {
    const key = candidateKey(candidate);
    if (rateLimits.length === 0) {
      return this.rateLimitsByCandidate.delete(key);
    }
    const next = copyProviderRouteRateLimits(rateLimits);
    const previous = this.rateLimitsByCandidate.get(key);
    this.rateLimitsByCandidate.set(key, next);
    return !sameProviderRouteRateLimits(previous, next);
  }

  recordFailure(
    route: KosongLLMRoute,
    candidate: KosongLLMRouteCandidate,
    failure: ProviderRouteFailure,
  ): boolean {
    const failedAt = Date.now();
    const next = {
      kind: failure.kind,
      failedAt,
      cooldownUntil: failedAt + failure.cooldownMs,
    };
    const key = candidateKey(candidate);
    const previous = this.failureByCandidate.get(key);
    const stats = this.statsByCandidate.get(key);
    this.statsByCandidate.set(key, {
      successCount: stats?.successCount ?? 0,
      failureCount: (stats?.failureCount ?? 0) + 1,
      lastSuccessAt: stats?.lastSuccessAt,
      lastLatencyMs: stats?.lastLatencyMs,
      avgLatencyMs: stats?.avgLatencyMs,
      lastFailureKind: failure.kind,
      lastFailureAt: failedAt,
    });
    this.failureByCandidate.set(key, next);
    this.clearPinnedCandidate(route, key);
    return (
      previous?.kind !== next.kind ||
      previous.failedAt !== next.failedAt ||
      previous.cooldownUntil !== next.cooldownUntil
    );
  }

  snapshot(route: KosongLLMRoute): ProviderRouteStatus {
    return {
      modelAlias: route.key,
      strategy: route.strategy,
      sessionAffinity: route.sessionAffinity === true ? true : undefined,
      preferredCredential: route.preferredCredential,
      candidates: route.candidates.map((candidate): ProviderRouteCandidateStatus => {
        const failure = this.activeFailure(candidate);
        const key = candidateKey(candidate);
        const stats = this.statsByCandidate.get(key);
        const successCount = stats?.successCount ?? 0;
        const failureCount = stats?.failureCount ?? 0;
        const rateLimits = this.candidateRateLimits(candidate);
        return {
          modelAlias: candidate.modelAlias,
          providerName: candidate.providerName,
          credentialLabel: candidate.credentialLabel,
          providerModel: candidate.provider.modelName,
          baseUrl: providerBaseUrl(candidate.provider),
          preferred: matchesPreferredCredential(route.preferredCredential, candidate)
            ? true
            : undefined,
          pinned:
            route.sessionAffinity === true && this.pinnedCandidateByRoute.get(route.key) === key
              ? true
              : undefined,
          weight: candidate.weight,
          rateLimits:
            rateLimits === undefined || rateLimits.length === 0
              ? undefined
              : copyProviderRouteRateLimits(rateLimits),
          rateLimitHeadroom: rateLimitHeadroom(rateLimits),
          cooldownUntil: failure?.cooldownUntil,
          cooldownKind: failure?.kind,
          lastSuccessAt: stats?.lastSuccessAt,
          lastLatencyMs: stats?.lastLatencyMs,
          avgLatencyMs: stats?.avgLatencyMs,
          lastFailureKind: stats?.lastFailureKind,
          lastFailureAt: stats?.lastFailureAt,
          successCount: successCount > 0 ? successCount : undefined,
          failureCount: failureCount > 0 ? failureCount : undefined,
        };
      }),
    };
  }

  private isUnavailable(candidate: KosongLLMRouteCandidate): boolean {
    return this.candidateUnavailableUntil(candidate) !== undefined;
  }

  private candidateUnavailableUntil(candidate: KosongLLMRouteCandidate): number | undefined {
    const activeFailure = this.activeFailure(candidate);
    if (activeFailure !== undefined) return activeFailure.cooldownUntil;
    return this.localLimitUnavailableUntil(candidate);
  }

  private requestCount(candidate: KosongLLMRouteCandidate): number {
    const stats = this.statsByCandidate.get(candidateKey(candidate));
    return (stats?.successCount ?? 0) + (stats?.failureCount ?? 0);
  }

  private avgLatencyMs(candidate: KosongLLMRouteCandidate): number | undefined {
    return this.statsByCandidate.get(candidateKey(candidate))?.avgLatencyMs;
  }

  private rateLimitHeadroom(candidate: KosongLLMRouteCandidate): number | undefined {
    return rateLimitHeadroom(this.candidateRateLimits(candidate));
  }

  private candidateRateLimits(
    candidate: KosongLLMRouteCandidate,
  ): readonly ProviderRouteRateLimitStatus[] | undefined {
    const remote = this.rateLimitsByCandidate.get(candidateKey(candidate));
    const local = this.localRateLimits(candidate);
    if (remote === undefined || remote.length === 0) return local.length === 0 ? undefined : local;
    if (local.length === 0) return remote;
    return [...local, ...remote];
  }

  private localRateLimits(candidate: KosongLLMRouteCandidate): ProviderRouteRateLimitStatus[] {
    const limits = candidate.localLimits;
    if (limits?.rpm === undefined && limits?.tpm === undefined) return [];
    const now = Date.now();
    const record = this.normalizedLocalUsageRecord(candidate, now);
    const windowStartedAt = record?.windowStartedAt ?? now;
    const resetAt = windowStartedAt + LOCAL_LIMIT_WINDOW_MS;
    const out: ProviderRouteRateLimitStatus[] = [];
    if (limits.rpm !== undefined) {
      out.push({
        name: 'local_requests',
        limit: limits.rpm,
        remaining: Math.max(0, limits.rpm - (record?.requestCount ?? 0)),
        resetAt,
      });
    }
    if (limits.tpm !== undefined) {
      out.push({
        name: 'local_tokens',
        limit: limits.tpm,
        remaining: Math.max(0, limits.tpm - (record?.tokenCount ?? 0)),
        resetAt,
      });
    }
    return out;
  }

  private localLimitUnavailableUntil(candidate: KosongLLMRouteCandidate): number | undefined {
    const exhausted = this.localRateLimits(candidate).filter(
      (limit) =>
        limit.remaining !== undefined &&
        limit.remaining <= 0 &&
        limit.resetAt !== undefined &&
        limit.resetAt > Date.now(),
    );
    if (exhausted.length === 0) return undefined;
    return Math.min(...exhausted.map((limit) => limit.resetAt!));
  }

  private recordLocalUsage(
    candidate: KosongLLMRouteCandidate,
    usage: TokenUsage | undefined,
  ): void {
    const limits = candidate.localLimits;
    if (limits?.rpm === undefined && limits?.tpm === undefined) return;
    const key = candidateKey(candidate);
    const now = Date.now();
    const previous = this.normalizedLocalUsageRecord(candidate, now);
    this.localUsageByCandidate.set(key, {
      windowStartedAt: previous?.windowStartedAt ?? now,
      requestCount: (previous?.requestCount ?? 0) + 1,
      tokenCount: (previous?.tokenCount ?? 0) + grandTotal(usage ?? emptyUsage()),
    });
  }

  private normalizedLocalUsageRecord(
    candidate: KosongLLMRouteCandidate,
    now: number,
  ): ProviderRouteLocalUsageRecord | undefined {
    const key = candidateKey(candidate);
    const record = this.localUsageByCandidate.get(key);
    if (record === undefined) return undefined;
    if (record.windowStartedAt + LOCAL_LIMIT_WINDOW_MS > now) return record;
    this.localUsageByCandidate.delete(key);
    return undefined;
  }

  private preferredCandidate(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): KosongLLMRouteCandidate | undefined {
    const preferredCredential = route.preferredCredential;
    if (preferredCredential === undefined) return undefined;
    const candidate = candidates.find((entry) =>
      matchesPreferredCredential(preferredCredential, entry),
    );
    if (candidate === undefined) return undefined;
    if (this.rateLimitHeadroom(candidate) === 0) return undefined;
    return candidate;
  }

  private pinnedCandidate(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): KosongLLMRouteCandidate | undefined {
    if (route.sessionAffinity !== true) return undefined;
    const pinnedKey = this.pinnedCandidateByRoute.get(route.key);
    if (pinnedKey === undefined) return undefined;
    const candidate = candidates.find((entry) => candidateKey(entry) === pinnedKey);
    if (candidate === undefined) {
      this.pinnedCandidateByRoute.delete(route.key);
      return undefined;
    }
    if (this.rateLimitHeadroom(candidate) === 0) return undefined;
    return candidate;
  }

  private clearPinnedCandidate(route: KosongLLMRoute, candidateKeyValue: string): void {
    if (this.pinnedCandidateByRoute.get(route.key) === candidateKeyValue) {
      this.pinnedCandidateByRoute.delete(route.key);
    }
  }

  private orderAuto(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    if (candidates.some((candidate) => this.rateLimitHeadroom(candidate) !== undefined)) {
      return this.orderRateLimitAware(candidates);
    }
    if (candidates.some((candidate) => this.avgLatencyMs(candidate) !== undefined)) {
      return this.orderLowestLatency(candidates);
    }
    if (candidates.some((candidate) => candidate.weight !== undefined)) {
      return this.orderWeightedRoundRobin(route, candidates);
    }
    return this.orderLeadingAliasRoundRobin(route, candidates);
  }

  private orderLowestLatency(
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    return candidates
      .map((candidate, index) => ({
        candidate,
        index,
        latencyMs: this.avgLatencyMs(candidate),
      }))
      .toSorted(
        (left, right) =>
          (left.latencyMs ?? Number.POSITIVE_INFINITY) -
            (right.latencyMs ?? Number.POSITIVE_INFINITY) ||
          left.index - right.index,
      )
      .map((entry) => entry.candidate);
  }

  private orderRateLimitAware(
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    return candidates
      .map((candidate, index) => ({
        candidate,
        index,
        headroom: this.rateLimitHeadroom(candidate),
      }))
      .toSorted(compareRateLimitAwareCandidates)
      .map((entry) => entry.candidate);
  }

  private orderLeadingAliasRoundRobin(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    const leadingModelAlias = candidates[0]?.modelAlias;
    if (leadingModelAlias === undefined) return candidates;
    const leading = candidates.filter((candidate) => candidate.modelAlias === leadingModelAlias);
    if (leading.length <= 1) return candidates;
    const rest = candidates.filter((candidate) => candidate.modelAlias !== leadingModelAlias);
    const key = `${route.key}:${leadingModelAlias}`;
    const start = this.roundRobinIndexByRoute.get(key) ?? 0;
    this.roundRobinIndexByRoute.set(key, (start + 1) % leading.length);
    return [...leading.slice(start), ...leading.slice(0, start), ...rest];
  }

  private activeFailure(candidate: KosongLLMRouteCandidate): ProviderRouteFailureRecord | undefined {
    const key = candidateKey(candidate);
    const failure = this.failureByCandidate.get(key);
    if (failure === undefined) return undefined;
    if (failure.cooldownUntil > Date.now()) return failure;
    this.failureByCandidate.delete(key);
    return undefined;
  }

  private orderWeightedRoundRobin(
    route: KosongLLMRoute,
    candidates: readonly KosongLLMRouteCandidate[],
  ): readonly KosongLLMRouteCandidate[] {
    if (candidates.length <= 1) return candidates;
    const weights = candidates.map(candidateWeight);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    if (totalWeight <= 0) return candidates;

    const current = this.weightedRoundRobinState(route);
    let selectedIndex = 0;
    let selectedWeight = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      const key = candidateKey(candidate);
      const nextWeight = (current.get(key) ?? 0) + weights[index]!;
      current.set(key, nextWeight);
      if (nextWeight > selectedWeight) {
        selectedIndex = index;
        selectedWeight = nextWeight;
      }
    }

    const selected = candidates[selectedIndex]!;
    current.set(candidateKey(selected), (current.get(candidateKey(selected)) ?? 0) - totalWeight);
    return [
      selected,
      ...candidates.slice(0, selectedIndex),
      ...candidates.slice(selectedIndex + 1),
    ];
  }

  private weightedRoundRobinState(route: KosongLLMRoute): Map<string, number> {
    const state = this.weightedRoundRobinByRoute.get(route.key);
    if (state !== undefined) return state;
    const next = new Map<string, number>();
    this.weightedRoundRobinByRoute.set(route.key, next);
    return next;
  }

  private deleteRoundRobinState(routeKey: string): boolean {
    let changed = this.roundRobinIndexByRoute.delete(routeKey);
    const prefix = `${routeKey}:`;
    for (const key of this.roundRobinIndexByRoute.keys()) {
      if (!key.startsWith(prefix)) continue;
      changed = this.roundRobinIndexByRoute.delete(key) || changed;
    }
    return changed;
  }
}

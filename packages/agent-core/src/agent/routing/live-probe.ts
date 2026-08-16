/**
 * Minimal live LLM probe for Smart Auto: verify the chosen alias with a tiny
 * generate call, then walk the route chain on failure.
 *
 * Success cache TTL 10m; failures feed alias ModelRouteHealthStore (+ provider
 * credential health for auth/quota). No per-turn ping when success cache is fresh.
 */

import {
  createProvider,
  createUserMessage,
  generate,
  type ChatProvider,
} from '@superliora/kosong';
import { sharedCredentialHealthStore } from '@superliora/oauth';

import type { Agent } from '..';
import { pinCompletionThinking } from '../intelligence/prompt-intelligence';
import { classifyProviderRouteFailure } from '../turn/provider-route-classify';
import type {
  ProviderRouteFailure,
  ProviderRouteFailureKind,
} from '../turn/provider-route-types';
import {
  DEFAULT_PROBE_FAIL_COOLDOWN_MS,
  sharedModelRouteHealthStore,
} from './model-route-health';
import { shouldMarkProviderCredential } from './provider-failure-scope';
import { isConfigAliasHealthy, type SmartRoute } from './smart-router';

export const LIVE_PROBE_SUCCESS_TTL_MS = 10 * 60_000;
export const LIVE_PROBE_TIMEOUT_MS = 12_000;

export type LiveProbeAliasResult = {
  readonly ok: boolean;
  readonly alias: string;
  readonly provider?: string;
  readonly fromCache?: boolean;
  readonly failureKind?: ProviderRouteFailureKind;
};

type ProbeCacheEntry = {
  readonly alias: string;
  readonly provider: string;
  readonly status: 'ok' | 'fail';
  readonly expiresAt: number;
  readonly failureKind?: ProviderRouteFailureKind;
};

const successCache = new Map<string, ProbeCacheEntry>();
const inFlight = new Map<string, Promise<LiveProbeAliasResult>>();

export type LiveProbeRunner = (
  agent: Agent,
  alias: string,
  signal: AbortSignal,
) => Promise<void>;

let probeRunnerForTests: LiveProbeRunner | undefined;

/** Test seam — replace the network generate. */
export function setLiveProbeRunnerForTests(runner: LiveProbeRunner | undefined): void {
  probeRunnerForTests = runner;
}

export function resetLiveProbeCacheForTests(): void {
  successCache.clear();
  inFlight.clear();
  probeRunnerForTests = undefined;
}

export function isLiveProbeSuccessFresh(alias: string, now = Date.now()): boolean {
  const entry = successCache.get(alias);
  if (entry === undefined || entry.status !== 'ok') return false;
  return entry.expiresAt > now;
}

/** True when a recent probe failure is still cached (mirrors alias health TTL). */
export function isLiveProbeFailureFresh(alias: string, now = Date.now()): boolean {
  const entry = successCache.get(alias);
  if (entry === undefined || entry.status !== 'fail') return false;
  return entry.expiresAt > now;
}

export function invalidateLiveProbeSuccess(alias: string | undefined): void {
  if (alias === undefined || alias.length === 0) return;
  const entry = successCache.get(alias);
  if (entry?.status === 'ok') successCache.delete(alias);
}

export function invalidateLiveProbeSuccessForProvider(providerName: string | undefined): void {
  if (providerName === undefined || providerName.length === 0) return;
  const needle = providerName.trim();
  for (const [alias, entry] of successCache) {
    if (entry.status === 'ok' && entry.provider === needle) {
      successCache.delete(alias);
    }
  }
}

/**
 * Probe one model alias (static gate + cache + minimal generate).
 */
export async function probeModelAlias(
  agent: Agent,
  alias: string,
  options?: {
    readonly signal?: AbortSignal;
    readonly now?: number;
    /** Skip the success TTL cache (still short-circuits on a fresh failure). */
    readonly force?: boolean;
  },
): Promise<LiveProbeAliasResult> {
  const now = options?.now ?? Date.now();
  const config = agent.runtimeConfig ?? agent.kimiConfig;
  if (config === undefined || config.models?.[alias] === undefined) {
    return { ok: false, alias };
  }

  const providerName = config.models[alias]?.provider ?? '';
  // Fresh failures are sticky — check before static health so a force retry
  // still short-circuits after alias/provider cooldowns land.
  if (isLiveProbeFailureFresh(alias, now)) {
    const entry = successCache.get(alias);
    return {
      ok: false,
      alias,
      provider: providerName,
      fromCache: true,
      failureKind: entry?.failureKind,
    };
  }
  if (!isConfigAliasHealthy(config, alias)) {
    return { ok: false, alias, provider: providerName };
  }
  if (options?.force !== true && isLiveProbeSuccessFresh(alias, now)) {
    return { ok: true, alias, provider: providerName, fromCache: true };
  }

  const existing = inFlight.get(alias);
  if (existing !== undefined) return existing;

  const run = runProbeModelAlias(agent, alias, providerName, options?.signal, now);
  inFlight.set(alias, run);
  try {
    return await run;
  } finally {
    inFlight.delete(alias);
  }
}

/**
 * Walk `route.chain` until a live probe succeeds. Returns an updated route
 * (alias may degrade) or undefined when every candidate fails.
 */
export async function ensureSmartRouteProbed(
  agent: Agent,
  route: SmartRoute,
  options?: {
    readonly signal?: AbortSignal;
    readonly now?: number;
    readonly force?: boolean;
    readonly onAliasProgress?: (alias: string, chainIndex: number, chainTotal: number) => void;
  },
): Promise<SmartRoute | undefined> {
  const config = agent.runtimeConfig ?? agent.kimiConfig;
  if (config === undefined) return undefined;

  const chain = route.chain.length > 0 ? route.chain : [route.alias];
  const chainTotal = chain.length;
  for (let i = 0; i < chain.length; i += 1) {
    const alias = chain[i]!;
    if (!isConfigAliasHealthy(config, alias)) continue;
    options?.onAliasProgress?.(alias, i + 1, chainTotal);
    const result = await probeModelAlias(agent, alias, options);
    if (!result.ok) continue;
    if (alias === route.alias) return route;
    return {
      ...route,
      alias,
      chain: uniqueFrom(alias, chain),
      reason: `Live probe fallback · ${route.alias} → ${alias}`,
    };
  }
  return undefined;
}

/** Fire-and-forget warm probe for session start (deduped via in-flight map). */
export function scheduleSmartAutoLiveProbe(agent: Agent): void {
  if (agent.config.modelAlias?.trim().toLowerCase() !== 'auto') return;
  const alias = agent.config.effectiveModelAlias ?? agent.config.modelAlias;
  if (alias === undefined || alias.length === 0 || alias.toLowerCase() === 'auto') return;

  void probeModelAlias(agent, alias).catch((error) => {
    agent.log.warn('smart auto live probe warm failed', {
      alias,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function runProbeModelAlias(
  agent: Agent,
  alias: string,
  providerName: string,
  outerSignal: AbortSignal | undefined,
  now: number,
): Promise<LiveProbeAliasResult> {
  const timeout = AbortSignal.timeout(LIVE_PROBE_TIMEOUT_MS);
  const signal =
    outerSignal === undefined ? timeout : AbortSignal.any([outerSignal, timeout]);

  try {
    const runner = probeRunnerForTests ?? defaultProbeRunner;
    await runner(agent, alias, signal);
    successCache.set(alias, {
      alias,
      provider: providerName,
      status: 'ok',
      expiresAt: now + LIVE_PROBE_SUCCESS_TTL_MS,
    });
    sharedModelRouteHealthStore.markHealthy(alias);
    if (providerName.length > 0) {
      sharedCredentialHealthStore.markHealthy(providerName);
    }
    return { ok: true, alias, provider: providerName };
  } catch (error) {
    if (outerSignal?.aborted) throw error;
    const failure = classifyProviderRouteFailure(error, undefined);
    const failureReason = error instanceof Error ? error.message : 'live probe failed';
    if (failure !== undefined) {
      // Live probe empty is usually account/proxy death, not a flaky one-token
      // blip — floor to probe-fail TTL so Conductor cannot re-summon in ~5s.
      const cooldownMs = liveProbeFailureCooldownMs(failure);
      applyFailureToHealth(alias, providerName, failure, failureReason, now, cooldownMs);
      successCache.set(alias, {
        alias,
        provider: providerName,
        status: 'fail',
        expiresAt: now + cooldownMs,
        failureKind: failure.kind,
      });
      return { ok: false, alias, provider: providerName, failureKind: failure.kind };
    }
    // Unclassified (e.g. unsupported-parameter 400) is alias-local. Do not
    // inflate to the 10-minute probe_fail TTL when a sibling on the same
    // credential is still healthy — that hid grok-4.6 after a dated SKU 400.
    const unclassifiedCooldownMs = unclassifiedProbeCooldownMs(
      agent,
      alias,
      providerName,
      now,
    );
    sharedModelRouteHealthStore.markUnavailable(alias, {
      kind: 'probe_fail',
      failureReason,
      cooldownMs: unclassifiedCooldownMs,
      now,
    });
    successCache.set(alias, {
      alias,
      provider: providerName,
      status: 'fail',
      expiresAt: now + unclassifiedCooldownMs,
    });
    return { ok: false, alias, provider: providerName };
  }
}

async function defaultProbeRunner(
  agent: Agent,
  alias: string,
  signal: AbortSignal,
): Promise<void> {
  const resolved = agent.modelProvider?.resolveProviderConfig(alias);
  if (resolved === undefined) {
    throw new Error(`Model "${alias}" is not configured`);
  }

  let provider: ChatProvider = createProvider(resolved.provider);
  const pinned = pinCompletionThinking(provider);
  if (pinned !== undefined) provider = pinned;
  if (typeof provider.withMaxCompletionTokens === 'function') {
    provider = provider.withMaxCompletionTokens(1);
  }

  const history = [createUserMessage('ok')];
  const system = 'Reply with ok.';
  const withAuth = agent.modelProvider?.resolveAuth?.(alias, { log: agent.log });

  if (withAuth === undefined) {
    await generate(provider, system, [], history, undefined, { signal });
    return;
  }
  await withAuth((auth) => generate(provider, system, [], history, undefined, { signal, auth }));
}

/** Floor short classifier cooldowns so mid-turn JobCreate retries stay sticky. */
function liveProbeFailureCooldownMs(failure: ProviderRouteFailure): number {
  if (failure.kind === 'empty') {
    return Math.max(failure.cooldownMs, DEFAULT_PROBE_FAIL_COOLDOWN_MS);
  }
  return failure.cooldownMs;
}

const UNCLASSIFIED_PROBE_COOLDOWN_MS = 30_000;

function unclassifiedProbeCooldownMs(
  agent: Agent,
  failedAlias: string,
  providerName: string,
  now: number,
): number {
  if (providerName.length === 0) return DEFAULT_PROBE_FAIL_COOLDOWN_MS;
  if (hasHealthySiblingOnProvider(agent, failedAlias, providerName, now)) {
    return UNCLASSIFIED_PROBE_COOLDOWN_MS;
  }
  return DEFAULT_PROBE_FAIL_COOLDOWN_MS;
}

function hasHealthySiblingOnProvider(
  agent: Agent,
  failedAlias: string,
  providerName: string,
  now: number,
): boolean {
  const config = agent.runtimeConfig ?? agent.kimiConfig;
  const models = config?.models;
  if (models === undefined) return false;
  for (const [alias, model] of Object.entries(models)) {
    if (alias === failedAlias) continue;
    if (model?.provider !== providerName) continue;
    if (isLiveProbeFailureFresh(alias, now)) continue;
    if (sharedModelRouteHealthStore.isAvailable(alias, now)) return true;
  }
  return false;
}

function applyFailureToHealth(
  alias: string,
  providerName: string,
  failure: ProviderRouteFailure,
  failureReason: string,
  now: number,
  cooldownMs: number = failure.cooldownMs,
): void {
  if (failure.kind === 'model_unavailable') {
    sharedModelRouteHealthStore.markUnavailable(alias, {
      kind: 'model_unavailable',
      failureReason,
      cooldownMs,
      now,
    });
    return;
  }

  sharedModelRouteHealthStore.markUnavailable(alias, {
    kind: failure.kind === 'auth' ? 'route_fail' : 'probe_fail',
    failureReason,
    cooldownMs,
    now,
  });

  if (providerName.length === 0) return;
  if (!shouldMarkProviderCredential(providerName, failure.kind)) return;
  if (failure.kind === 'auth') {
    sharedCredentialHealthStore.markAuthRejected(providerName, {
      failureReason,
      cooldownMs,
    });
    return;
  }
  sharedCredentialHealthStore.markRateLimited(providerName, {
    failureReason,
    cooldownMs,
  });
}

function uniqueFrom(head: string, chain: readonly string[]): readonly string[] {
  const out: string[] = [head];
  const seen = new Set<string>([head]);
  for (const alias of chain) {
    if (seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
  }
  return out;
}

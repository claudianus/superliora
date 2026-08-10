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
  options?: { readonly signal?: AbortSignal; readonly now?: number },
): Promise<LiveProbeAliasResult> {
  const now = options?.now ?? Date.now();
  const config = agent.runtimeConfig ?? agent.kimiConfig;
  if (config === undefined || !isConfigAliasHealthy(config, alias)) {
    return { ok: false, alias };
  }

  const providerName = config.models?.[alias]?.provider ?? '';
  if (isLiveProbeSuccessFresh(alias, now)) {
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
  options?: { readonly signal?: AbortSignal; readonly now?: number },
): Promise<SmartRoute | undefined> {
  const config = agent.runtimeConfig ?? agent.kimiConfig;
  if (config === undefined) return undefined;

  const chain = route.chain.length > 0 ? route.chain : [route.alias];
  for (const alias of chain) {
    if (!isConfigAliasHealthy(config, alias)) continue;
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
      applyFailureToHealth(alias, providerName, failure, failureReason, now);
      successCache.set(alias, {
        alias,
        provider: providerName,
        status: 'fail',
        expiresAt: now + failure.cooldownMs,
        failureKind: failure.kind,
      });
      return { ok: false, alias, provider: providerName, failureKind: failure.kind };
    }
    sharedModelRouteHealthStore.markUnavailable(alias, {
      kind: 'probe_fail',
      failureReason,
      cooldownMs: DEFAULT_PROBE_FAIL_COOLDOWN_MS,
      now,
    });
    successCache.set(alias, {
      alias,
      provider: providerName,
      status: 'fail',
      expiresAt: now + DEFAULT_PROBE_FAIL_COOLDOWN_MS,
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

function applyFailureToHealth(
  alias: string,
  providerName: string,
  failure: ProviderRouteFailure,
  failureReason: string,
  now: number,
): void {
  if (failure.kind === 'model_unavailable') {
    sharedModelRouteHealthStore.markUnavailable(alias, {
      kind: 'model_unavailable',
      failureReason,
      cooldownMs: failure.cooldownMs,
      now,
    });
    return;
  }

  sharedModelRouteHealthStore.markUnavailable(alias, {
    kind: failure.kind === 'auth' ? 'route_fail' : 'probe_fail',
    failureReason,
    cooldownMs: failure.cooldownMs,
    now,
  });

  if (providerName.length === 0) return;
  if (failure.kind === 'auth') {
    sharedCredentialHealthStore.markAuthRejected(providerName, {
      failureReason,
      cooldownMs: failure.cooldownMs,
    });
    return;
  }
  if (
    failure.kind === 'quota' ||
    failure.kind === 'rate_limit' ||
    failure.kind === 'server' ||
    failure.kind === 'connection' ||
    failure.kind === 'timeout'
  ) {
    sharedCredentialHealthStore.markRateLimited(providerName, {
      failureReason,
      cooldownMs: failure.cooldownMs,
    });
  }
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

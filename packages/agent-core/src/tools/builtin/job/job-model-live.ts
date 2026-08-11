/**
 * Live model gates for Conductor Jobs.
 *
 * Static `isConfigAliasHealthy` only knows credentials + cooldown marks.
 * Quota / account / provider exceptions need a tiny generate probe before we
 * ACK JobCreate or spawn a worker onto a doomed alias.
 */

import type { Agent } from '../../../agent/index';
import {
  ensureSmartRouteProbed,
  escalateSmartRoute,
  isConfigAliasHealthy,
  isCursorIncludedLaneModel,
  isLiveProbeFailureFresh,
  probeModelAlias,
  resolveSmartRoute,
  type SmartRoute,
} from '../../../agent/routing';
import { formatModelFailedNote } from '../../../session/subagent/subagent-model-failed-note';
import {
  currentAgentConfig,
  resolveSubagentModelSelection,
  roleForSubagentProfile,
} from '../../../session/subagent/subagent-model-routing';
import { profileForJobKind } from './job-runtime';
import type { JobRecord } from './job-store-key';

export type JobModelLiveReject = {
  readonly isError: true;
  readonly output: string;
};

/**
 * Reject JobCreate.model_alias when static health fails or a live probe fails.
 * Fresh success cache (10m) skips the network round-trip.
 */
export async function rejectUnhealthyJobModelAliasLive(
  agent: Agent | undefined,
  modelAlias: string,
  options?: { readonly signal?: AbortSignal },
): Promise<JobModelLiveReject | undefined> {
  const config = agent?.runtimeConfig ?? agent?.kimiConfig;
  if (config === undefined) {
    return {
      isError: true,
      output:
        `model_alias ${JSON.stringify(modelAlias)} cannot be validated (no session config) — ` +
        'omit model_alias or retry after models are loaded.',
    };
  }
  if (!isConfigAliasHealthy(config, modelAlias)) {
    const stillLive = listStillLiveJobModelAliases(config, modelAlias);
    const next =
      stillLive.length > 0
        ? `Still live now: ${stillLive.join(', ')}. Pick one of these, or omit model_alias.`
        : 'omit model_alias for harness role pick (do not invent aliases).';
    return {
      isError: true,
      output:
        `model_alias ${JSON.stringify(modelAlias)} is unknown or unhealthy — ${next}`,
    };
  }
  if (agent === undefined) {
    return {
      isError: true,
      output:
        `model_alias ${JSON.stringify(modelAlias)} cannot be live-probed (no agent) — ` +
        'omit model_alias or retry after the session is ready.',
    };
  }

  const probe = await probeModelAlias(agent, modelAlias, { signal: options?.signal });
  if (probe.ok) return undefined;

  const kind = probe.failureKind ?? 'probe_fail';
  // Catalog injected at turn start is stale after this probe — list what is
  // still live *now* so Conductor does not re-summon just-failed siblings.
  const stillLive = listStillLiveJobModelAliases(config, modelAlias);
  const next =
    stillLive.length > 0
      ? `Still live now: ${stillLive.join(', ')}. Pick one of these, or omit model_alias.`
      : 'No live catalog aliases remain — omit model_alias for harness role pick (do not invent aliases).';
  return {
    isError: true,
    output:
      `model_alias ${JSON.stringify(modelAlias)} failed live probe (${kind}) — ${next} ` +
      'Do not blind-retry the same model until quota/account recovers.',
  };
}

/** Fresh-healthy aliases after a probe failure (capped for tool-result size). */
function listStillLiveJobModelAliases(
  config: NonNullable<Agent['runtimeConfig']>,
  failedAlias: string,
  max = 6,
): readonly string[] {
  const live: string[] = [];
  for (const alias of Object.keys(config.models ?? {})) {
    const trimmed = alias.trim();
    if (trimmed.length === 0 || trimmed === failedAlias) continue;
    if (isLiveProbeFailureFresh(trimmed)) continue;
    if (!isConfigAliasHealthy(config, trimmed)) continue;
    live.push(trimmed);
  }
  // Cursor included lane (Auto / Grok 4.5 / Composer 2.5) first — separate from API quota.
  live.sort((a, b) => {
    const ai = isCursorIncludedLaneModel(a) ? 1 : 0;
    const bi = isCursorIncludedLaneModel(b) ? 1 : 0;
    if (ai !== bi) return bi - ai;
    return a.localeCompare(b);
  });
  return live.slice(0, max);
}

export type JobWorkerModelPreflight =
  | { readonly ok: true; readonly modelAlias: string | undefined }
  | { readonly ok: false; readonly error: string; readonly note: string };

/**
 * Live-verify the worker model before spawn.
 * - Pinned Job.modelAlias: probe that alias only (Conductor choice stays sticky).
 * - Unpinned: resolve role route + walk live probe chain; pin the winner.
 *
 * Balanced intensity often keeps only cheap aliases. When those are
 * statically healthy but live-dead (quota/account), escalate intensity and
 * finally try the Conductor/parent model before failing the Job.
 */
export async function preflightJobWorkerModel(
  agent: Agent,
  job: JobRecord,
  options?: {
    readonly signal?: AbortSignal;
    readonly preferVision?: boolean;
  },
): Promise<JobWorkerModelPreflight> {
  const pinned = job.modelAlias?.trim() || undefined;
  const profileName = profileForJobKind(job.kind);
  const role = roleForSubagentProfile(profileName);

  if (pinned !== undefined) {
    const config = currentAgentConfig(agent) ?? agent.runtimeConfig ?? agent.kimiConfig;
    if (config === undefined || !isConfigAliasHealthy(config, pinned)) {
      const note = formatModelFailedNote({
        alias: pinned,
        kind: 'unhealthy',
        tried: [pinned],
      });
      return {
        ok: false,
        error: `worker model ${pinned} is unknown or unhealthy before spawn`,
        note,
      };
    }
    // Spawn always re-probes successes — a Job may sit queued past the 10m TTL
    // window while quota/account dies; JobCreate already used the soft cache.
    const probe = await probeModelAlias(agent, pinned, {
      signal: options?.signal,
      force: true,
    });
    if (probe.ok) return { ok: true, modelAlias: pinned };

    const kind = probe.failureKind ?? 'probe_fail';
    const nextHint = suggestNextHint(agent, job, pinned, options?.preferVision === true);
    const note = formatModelFailedNote({
      alias: pinned,
      kind,
      tried: [pinned],
      nextHint,
    });
    return {
      ok: false,
      error: `worker model ${pinned} failed live probe (${kind})`,
      note,
    };
  }

  const parentAlias = resolveParentWorkerAlias(agent);
  const signals = {
    prompt: job.prompt ?? job.title,
    profileName,
  } as const;

  const selection = resolveSubagentModelSelection(agent, profileName, undefined, {
    preferVision: options?.preferVision === true,
    signals,
  });

  const config = currentAgentConfig(agent) ?? agent.runtimeConfig ?? agent.kimiConfig;
  let route: SmartRoute | undefined = selection.route;
  if (route === undefined && role !== undefined && config !== undefined) {
    route = resolveSmartRoute({
      role,
      config,
      intensity: 'balanced',
      ...(parentAlias !== undefined ? { parentAlias } : {}),
      signals,
    });
  }

  if (route !== undefined) {
    const tried: string[] = [];
    let current: SmartRoute | undefined = appendProbeCandidates(route, parentAlias, config);

    while (current !== undefined) {
      const chain = current.chain.length > 0 ? current.chain : [current.alias];
      const remaining = chain.filter((alias) => !tried.includes(alias));
      for (const alias of remaining) tried.push(alias);

      if (remaining.length > 0) {
        const probeRoute: SmartRoute =
          remaining.length === chain.length && remaining[0] === current.alias
            ? current
            : {
                ...current,
                alias: remaining[0]!,
                chain: remaining,
                reason: `${current.reason} · live escalate`,
              };
        const probed = await ensureSmartRouteProbed(agent, probeRoute, {
          signal: options?.signal,
          force: true,
        });
        if (probed !== undefined) return { ok: true, modelAlias: probed.alias };
      }

      if (role === undefined || config === undefined) break;
      const escalated = escalateSmartRoute(
        {
          role,
          config,
          ...(parentAlias !== undefined ? { parentAlias } : {}),
          intensity: current.intensity,
        },
        current,
      );
      if (escalated === undefined) break;
      current = appendProbeCandidates(escalated, parentAlias, config);
    }

    if (
      parentAlias !== undefined &&
      !tried.includes(parentAlias) &&
      !isLiveProbeFailureFresh(parentAlias) &&
      config !== undefined &&
      isConfigAliasHealthy(config, parentAlias)
    ) {
      tried.push(parentAlias);
      const probe = await probeModelAlias(agent, parentAlias, {
        signal: options?.signal,
        force: true,
      });
      if (probe.ok) return { ok: true, modelAlias: parentAlias };
    }

    const note = formatModelFailedNote({
      alias: route.alias,
      kind: 'probe_fail',
      tried: tried.length > 0 ? tried : route.chain.length > 0 ? route.chain : [route.alias],
      nextHint: suggestNextHint(agent, job, route.alias, options?.preferVision === true),
    });
    const triedLabel = (tried.length > 0 ? tried : [route.alias]).slice(0, 6).join(', ');
    return {
      ok: false,
      error:
        `no live worker model for ${profileName} (tried ${triedLabel}) — ` +
        'pin a live model with /model (or JobCreate.model_alias), then /goal resume / JobResume.',
      note,
    };
  }

  const alias = selection.alias?.trim() || undefined;
  if (alias === undefined) return { ok: true, modelAlias: undefined };

  const probe = await probeModelAlias(agent, alias, {
    signal: options?.signal,
    force: true,
  });
  if (probe.ok) return { ok: true, modelAlias: alias };

  const kind = probe.failureKind ?? 'probe_fail';
  const note = formatModelFailedNote({
    alias,
    kind,
    tried: [alias],
  });
  return {
    ok: false,
    error: `worker model ${alias} failed live probe (${kind})`,
    note,
  };
}

/** Conductor / parent session alias when healthy — last-resort worker staff. */
function resolveParentWorkerAlias(agent: Agent): string | undefined {
  const sessionConfig = agent.config;
  if (sessionConfig === undefined) return undefined;
  const pinned = sessionConfig.modelAlias?.trim();
  const alias =
    pinned !== undefined && pinned.toLowerCase() === 'auto'
      ? sessionConfig.effectiveModelAlias?.trim()
      : pinned;
  if (alias === undefined || alias.length === 0 || alias.toLowerCase() === 'auto') {
    return undefined;
  }
  const config = currentAgentConfig(agent) ?? agent.runtimeConfig ?? agent.kimiConfig;
  if (config === undefined || !isConfigAliasHealthy(config, alias)) return undefined;
  return alias;
}

function appendProbeCandidates(
  route: SmartRoute,
  parentAlias: string | undefined,
  config: ReturnType<typeof currentAgentConfig>,
): SmartRoute {
  if (parentAlias === undefined || config === undefined) return route;
  if (!isConfigAliasHealthy(config, parentAlias)) return route;
  const chain = route.chain.length > 0 ? [...route.chain] : [route.alias];
  if (chain.includes(parentAlias)) return route;
  return { ...route, chain: [...chain, parentAlias] };
}

function suggestNextHint(
  agent: Agent,
  job: JobRecord,
  failedAlias: string,
  preferVision: boolean,
): string | undefined {
  const parent = resolveParentWorkerAlias(agent);
  if (parent !== undefined && parent !== failedAlias && !isLiveProbeFailureFresh(parent)) {
    return parent;
  }
  const profileName = profileForJobKind(job.kind);
  const role = roleForSubagentProfile(profileName);
  const config = currentAgentConfig(agent) ?? agent.runtimeConfig ?? agent.kimiConfig;
  if (role !== undefined && config !== undefined) {
    const maxRoute = resolveSmartRoute({
      role,
      config,
      intensity: 'max',
      ...(parent !== undefined ? { parentAlias: parent } : {}),
      signals: { prompt: job.prompt ?? job.title, profileName },
    });
    for (const alias of maxRoute?.chain ?? []) {
      const trimmed = alias.trim();
      if (trimmed.length === 0 || trimmed === failedAlias) continue;
      if (isLiveProbeFailureFresh(trimmed)) continue;
      if (isConfigAliasHealthy(config, trimmed)) return trimmed;
    }
  }
  const selection = resolveSubagentModelSelection(agent, profileName, undefined, {
    preferVision,
    signals: { prompt: job.prompt ?? job.title, profileName },
  });
  const chain = selection.route?.chain ?? [];
  for (const alias of chain) {
    const trimmed = alias.trim();
    if (trimmed.length === 0 || trimmed === failedAlias) continue;
    if (isLiveProbeFailureFresh(trimmed)) continue;
    if (config !== undefined && isConfigAliasHealthy(config, trimmed)) return trimmed;
  }
  return undefined;
}

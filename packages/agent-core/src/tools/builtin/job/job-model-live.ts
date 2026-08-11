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
  isConfigAliasHealthy,
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
    return {
      isError: true,
      output:
        `model_alias ${JSON.stringify(modelAlias)} is unknown or unhealthy — ` +
        'pick a healthy alias from <fleet_model_catalog>, or omit model_alias for harness role pick.',
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
  return {
    isError: true,
    output:
      `model_alias ${JSON.stringify(modelAlias)} failed live probe (${kind}) — ` +
      'pick a different <fleet_model_catalog> alias, or omit model_alias for harness role pick. ' +
      'Do not blind-retry the same model until quota/account recovers.',
  };
}

export type JobWorkerModelPreflight =
  | { readonly ok: true; readonly modelAlias: string | undefined }
  | { readonly ok: false; readonly error: string; readonly note: string };

/**
 * Live-verify the worker model before spawn.
 * - Pinned Job.modelAlias: probe that alias only (Conductor choice stays sticky).
 * - Unpinned: resolve role route + walk live probe chain; pin the winner.
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

  const selection = resolveSubagentModelSelection(agent, profileName, undefined, {
    preferVision: options?.preferVision === true,
    signals: {
      prompt: job.prompt ?? job.title,
      profileName,
    },
  });

  let route: SmartRoute | undefined = selection.route;
  if (route === undefined && role !== undefined) {
    const config = currentAgentConfig(agent) ?? agent.runtimeConfig ?? agent.kimiConfig;
    if (config !== undefined) {
      route = resolveSmartRoute({
        role,
        config,
        intensity: 'balanced',
        signals: { prompt: job.prompt ?? job.title, profileName },
      });
    }
  }

  if (route !== undefined) {
    const probed = await ensureSmartRouteProbed(agent, route, {
      signal: options?.signal,
      force: true,
    });
    if (probed === undefined) {
      const tried = route.chain.length > 0 ? route.chain : [route.alias];
      const note = formatModelFailedNote({
        alias: route.alias,
        kind: 'probe_fail',
        tried,
      });
      return {
        ok: false,
        error: `no live-healthy worker model in role chain for ${profileName}`,
        note,
      };
    }
    return { ok: true, modelAlias: probed.alias };
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

function suggestNextHint(
  agent: Agent,
  job: JobRecord,
  failedAlias: string,
  preferVision: boolean,
): string | undefined {
  const profileName = profileForJobKind(job.kind);
  const selection = resolveSubagentModelSelection(agent, profileName, undefined, {
    preferVision,
    signals: { prompt: job.prompt ?? job.title, profileName },
  });
  const chain = selection.route?.chain ?? [];
  for (const alias of chain) {
    const trimmed = alias.trim();
    if (trimmed.length === 0 || trimmed === failedAlias) continue;
    if (isLiveProbeFailureFresh(trimmed)) continue;
    const config = currentAgentConfig(agent) ?? agent.runtimeConfig ?? agent.kimiConfig;
    if (config !== undefined && isConfigAliasHealthy(config, trimmed)) return trimmed;
  }
  return undefined;
}

/**
 * Settings "Smart auto routing": rank per-role chains, live-probe, pin survivors.
 *
 * Ignores existing loopControl.*Model overrides so ranking is pure auto, then
 * walks each role chain with ensureSmartRouteProbed (alias probe cache shared).
 *
 * Caller must set `agent.runtimeConfig` / `agent.kimiConfig` to the same config
 * passed here (typically {@link configWithoutRoleModelOverrides}) so probe
 * health checks see stripped overrides.
 */

import type { Agent } from '..';
import type { LioraConfig } from '../../config';
import type { ModelRole } from '../../utils/model-presets';
import { ROLE_PRESETS } from '../../utils/model-presets';
import { ensureSmartRouteProbed } from './live-probe';
import { resolveSmartRoute } from './smart-router';

export type LoopRoleModelConfigKey =
  | 'compactionModel'
  | 'completionModel'
  | 'explorationModel'
  | 'codingModel'
  | 'planningModel'
  | 'debuggingModel';

export type LoopRoleRoutingClearPath = `loopControl.${LoopRoleModelConfigKey}`;

export type SmartLoopRolePinPlan = {
  readonly role: ModelRole;
  readonly configKey: LoopRoleModelConfigKey;
  readonly label: string;
  readonly alias: string;
};

export type SmartLoopRoleSkipPlan = {
  readonly role: ModelRole;
  readonly configKey: LoopRoleModelConfigKey;
  readonly label: string;
  readonly reason: string;
};

export type SmartLoopRoleRoutingPlan = {
  readonly pins: readonly SmartLoopRolePinPlan[];
  readonly skipped: readonly SmartLoopRoleSkipPlan[];
  readonly patch: {
    readonly loopControl: Partial<Record<LoopRoleModelConfigKey, string>>;
  };
  readonly clearPaths: readonly LoopRoleRoutingClearPath[];
};

/** Live progress while Settings Smart auto walks role chains. */
export type SmartLoopProbeProgress = {
  readonly role: ModelRole;
  readonly label: string;
  /** 1-based role index among roles being probed. */
  readonly index: number;
  readonly total: number;
  /** Candidate alias under probe, when known. */
  readonly alias?: string;
  /** 1-based index within the role chain (when probing an alias). */
  readonly chainIndex?: number;
  readonly chainTotal?: number;
  readonly outcome?: 'pinned' | 'skipped';
};

const LOOP_ROLE_ENTRIES: readonly {
  readonly role: ModelRole;
  readonly configKey: LoopRoleModelConfigKey;
  readonly label: string;
}[] = [
  { role: 'compaction', configKey: 'compactionModel', label: 'Compaction' },
  { role: 'completion', configKey: 'completionModel', label: 'Completion' },
  { role: 'exploration', configKey: 'explorationModel', label: 'Exploration' },
  { role: 'coding', configKey: 'codingModel', label: 'Coding' },
  { role: 'planning', configKey: 'planningModel', label: 'Planning' },
  { role: 'debugging', configKey: 'debuggingModel', label: 'Debugging' },
];

const ROLE_OVERRIDE_KEYS: readonly LoopRoleModelConfigKey[] = LOOP_ROLE_ENTRIES.map(
  (entry) => entry.configKey,
);

/** Roles exposed in Settings model routing (must match ROLE_PRESETS). */
export function loopRoleRoutingEntries(): typeof LOOP_ROLE_ENTRIES {
  return LOOP_ROLE_ENTRIES;
}

export function configWithoutRoleModelOverrides(config: LioraConfig): LioraConfig {
  const loopControl = { ...config.loopControl };
  for (const key of ROLE_OVERRIDE_KEYS) {
    delete loopControl[key];
  }
  return { ...config, loopControl };
}

/**
 * Live-probe each role's auto chain and return healthy pins only.
 */
export async function planSmartLoopRoleRoutingLive(
  agent: Agent,
  config: LioraConfig,
  options?: {
    readonly signal?: AbortSignal;
    readonly now?: number;
    readonly onProgress?: (progress: SmartLoopProbeProgress) => void;
  },
): Promise<SmartLoopRoleRoutingPlan> {
  const rankingConfig = configWithoutRoleModelOverrides(config);
  const onProgress = options?.onProgress;

  const pins: SmartLoopRolePinPlan[] = [];
  const skipped: SmartLoopRoleSkipPlan[] = [];
  const loopControl: Partial<Record<LoopRoleModelConfigKey, string>> = {};
  const total = LOOP_ROLE_ENTRIES.length;

  for (let index = 0; index < LOOP_ROLE_ENTRIES.length; index += 1) {
    const entry = LOOP_ROLE_ENTRIES[index]!;
    const roleIndex = index + 1;
    onProgress?.({
      role: entry.role,
      label: entry.label,
      index: roleIndex,
      total,
    });

    const route = resolveSmartRoute({ role: entry.role, config: rankingConfig });
    if (route === undefined) {
      skipped.push({
        role: entry.role,
        configKey: entry.configKey,
        label: entry.label,
        reason: 'no healthy candidate',
      });
      onProgress?.({
        role: entry.role,
        label: entry.label,
        index: roleIndex,
        total,
        outcome: 'skipped',
      });
      continue;
    }
    const probed = await ensureSmartRouteProbed(agent, route, {
      signal: options?.signal,
      now: options?.now,
      onAliasProgress: (alias, chainIndex, chainTotal) => {
        onProgress?.({
          role: entry.role,
          label: entry.label,
          index: roleIndex,
          total,
          alias,
          chainIndex,
          chainTotal,
        });
      },
    });
    if (probed === undefined) {
      skipped.push({
        role: entry.role,
        configKey: entry.configKey,
        label: entry.label,
        reason: `live probe failed: ${route.chain.join(' → ') || route.alias}`,
      });
      onProgress?.({
        role: entry.role,
        label: entry.label,
        index: roleIndex,
        total,
        outcome: 'skipped',
      });
      continue;
    }
    pins.push({
      role: entry.role,
      configKey: entry.configKey,
      label: entry.label,
      alias: probed.alias,
    });
    loopControl[entry.configKey] = probed.alias;
    onProgress?.({
      role: entry.role,
      label: entry.label,
      index: roleIndex,
      total,
      alias: probed.alias,
      outcome: 'pinned',
    });
  }

  return {
    pins,
    skipped,
    patch: { loopControl },
    clearPaths: LOOP_ROLE_ENTRIES.map(
      (entry) => `loopControl.${entry.configKey}` as LoopRoleRoutingClearPath,
    ),
  };
}

/** Ratchet helper: ROLE_PRESETS roles must equal LOOP_ROLE_ENTRIES. */
export function assertLoopRolesMatchPresets(): void {
  const presetRoles = new Set(ROLE_PRESETS.map((p) => p.role));
  const entryRoles = new Set(LOOP_ROLE_ENTRIES.map((e) => e.role));
  if (presetRoles.size !== entryRoles.size) {
    throw new Error(
      `Loop role count mismatch: presets=${presetRoles.size} entries=${entryRoles.size}`,
    );
  }
  for (const role of presetRoles) {
    if (!entryRoles.has(role)) {
      throw new Error(`Missing loop routing role entry for preset role: ${role}`);
    }
  }
}

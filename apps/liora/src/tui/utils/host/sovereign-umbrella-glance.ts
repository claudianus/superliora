/**
 * Sovereign umbrella Session (live) — soft-gate checklist (SSOT via env helpers).
 * Gate set + core profile — SSOT via env helpers below.
 */

import { isRepoIndexWarmEnabled } from '@superliora/sdk';

import { isSovereignCoreDefaultEnabled } from '#/tui/utils/agent/profile-glance';
import { isHideLegacyToolNamesEnabled } from '#/tui/utils/tool/tools-glance';

import {
  HOST_SOVEREIGN_UMBRELLA_ACTIVE_LINE,
  isSovereignUmbrellaEnabled,
} from '#/tui/utils/host/host-glance';

export interface SovereignUmbrellaSoftGates {
  readonly coreProfile: boolean;
  readonly hideLegacy: boolean;
  readonly warm: boolean;
}

/** Grade umbrella soft gates from env helpers (no agent-core import in TUI). */
export function resolveSovereignUmbrellaSoftGates(
  env: NodeJS.ProcessEnv = process.env,
): SovereignUmbrellaSoftGates {
  return {
    coreProfile: isSovereignCoreDefaultEnabled(env),
    hideLegacy: isHideLegacyToolNamesEnabled(env),
    warm: isRepoIndexWarmEnabled(env),
  };
}

function formatSovereignGateLine(label: string, on: boolean): string {
  return `· ${label}: ${on ? 'ON' : 'OFF'}`;
}

export interface HostSessionLiveGlance {
  readonly env?: NodeJS.ProcessEnv;
}

/** Session (live) — sovereign umbrella gate checklist when {@link isSovereignUmbrellaEnabled}. */
export function buildHostSessionLiveLines(
  glance: HostSessionLiveGlance = {},
): readonly string[] {
  const env = glance.env ?? process.env;
  if (!isSovereignUmbrellaEnabled(env)) {
    return [];
  }

  const gates = resolveSovereignUmbrellaSoftGates(env);
  return [
    '── Session (live) ───────────────────────────',
    HOST_SOVEREIGN_UMBRELLA_ACTIVE_LINE,
    formatSovereignGateLine('core profile', gates.coreProfile),
    formatSovereignGateLine('hide-legacy', gates.hideLegacy),
    formatSovereignGateLine('codemap warm', gates.warm),
    '',
  ];
}

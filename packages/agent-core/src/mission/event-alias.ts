import type { AgentEvent } from '@superliora/protocol';
import {
  isMissionUltraworkEventType,
  isUltraworkOrMissionEventType,
  missionUltraworkEventAlias,
  normalizeMissionUltraworkEventAlias,
  ultraworkMissionEventAlias,
} from '@superliora/protocol';

import { SOVEREIGN_UMBRELLA_ENV } from '#/profile/main-profile';
import {
  MISSION_DUAL_EMIT_ENV,
  isMissionDualEmitEnabled,
  missionDualEmitEnableReason,
} from '#/profile/sovereign-soft-gates';

export {
  isMissionUltraworkEventType,
  isUltraworkOrMissionEventType,
  missionUltraworkEventAlias,
  normalizeMissionUltraworkEventAlias,
  ultraworkMissionEventAlias,
};

export {
  MISSION_DUAL_EMIT_ENV,
  isMissionDualEmitEnabled,
  missionDualEmitEnableReason,
};

function missionAliasForUltraworkEvent<E extends AgentEvent & { readonly type: string }>(
  event: E,
): E | undefined {
  if (!event.type.startsWith('ultrawork.')) return undefined;
  return {
    ...event,
    type: ultraworkMissionEventAlias(event.type) as E['type'],
  };
}

/**
 * Live-RPC-only mission alias when {@link isMissionDualEmitEnabled} — never call
 * from journal / durable trace sinks.
 */
export function maybeEmitMissionUltraworkAliasLive(
  emitLive: ((event: AgentEvent) => void) | undefined,
  event: AgentEvent,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (emitLive === undefined || !isMissionDualEmitEnabled(env)) return;
  const alias = missionAliasForUltraworkEvent(event);
  if (alias !== undefined) emitLive(alias);
}

/**
 * Opt-in dual-emit for high-traffic mission lifecycle events.
 *
 * Journals and golden sequence tests still see a single canonical `ultrawork.*`
 * row; the `mission.*` alias is live-RPC only (not logged to durable trace).
 * Requires {@link isMissionDualEmitEnabled}. Prefer {@link maybeEmitMissionUltraworkAliasLive}
 * at Agent emit sites; use this helper only when you control separate durable vs live sinks.
 */
export function dualEmitMissionUltraworkAlias(
  emit: (event: AgentEvent) => void,
  event: AgentEvent & { readonly type: `ultrawork.${string}` },
  options?: {
    readonly emitLive?: (event: AgentEvent) => void;
    readonly env?: NodeJS.ProcessEnv;
  },
): void {
  emit(event);
  if (!isMissionDualEmitEnabled(options?.env)) return;
  const alias = missionAliasForUltraworkEvent(event);
  if (alias === undefined) return;
  if (options?.emitLive !== undefined) {
    options.emitLive(alias);
    return;
  }
  emit(alias);
}

/** Settings / ops copy for Mission dual-emit env gate. */
export function missionDualEmitStatusLine(env: NodeJS.ProcessEnv = process.env): string {
  const reason = missionDualEmitEnableReason(env);
  return reason !== null
    ? `Dual-emit: ON (${reason}) — mission.* live WS only; journal stays ultrawork.*`
    : `Dual-emit: OFF (default) — journal golden sequences safe; read-path normalize accepts mission.* · opt-in: ${MISSION_DUAL_EMIT_ENV}=1 or ${SOVEREIGN_UMBRELLA_ENV}=1`;
}

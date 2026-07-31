import type { AgentEvent } from '@superliora/protocol';
import {
  FLEET_ULTRAWORK_EVENT_SUFFIXES,
  ultraworkFleetEventAlias,
} from '@superliora/protocol';

import { SOVEREIGN_UMBRELLA_ENV } from '#/profile/main-profile';
import {
  FLEET_DUAL_EMIT_ENV,
  fleetDualEmitEnableReason,
  isFleetDualEmitEnabled,
} from '#/profile/sovereign-soft-gates';

export {
  FLEET_DUAL_EMIT_ENV,
  fleetDualEmitEnableReason,
  isFleetDualEmitEnabled,
};

function fleetAliasForUltraworkEvent<E extends AgentEvent & { readonly type: string }>(
  event: E,
): E | undefined {
  if (!event.type.startsWith('ultrawork.')) return undefined;
  const suffix = event.type.slice('ultrawork.'.length);
  if (!(FLEET_ULTRAWORK_EVENT_SUFFIXES as readonly string[]).includes(suffix)) return undefined;
  const aliasType = ultraworkFleetEventAlias(event.type);
  if (aliasType === event.type) return undefined;
  return { ...event, type: aliasType as E['type'] };
}

/**
 * Live-RPC-only fleet alias when {@link isFleetDualEmitEnabled} — never call
 * from journal / durable trace sinks.
 */
export function maybeEmitFleetUltraworkAliasLive(
  emitLive: ((event: AgentEvent) => void) | undefined,
  event: AgentEvent,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (emitLive === undefined || !isFleetDualEmitEnabled(env)) return;
  const alias = fleetAliasForUltraworkEvent(event);
  if (alias !== undefined) emitLive(alias);
}

/**
 * Opt-in dual-emit for collaboration/swarm lifecycle events.
 *
 * Journals and golden sequence tests still see a single canonical `ultrawork.*`
 * row; the `fleet.*` alias is live-RPC only (not logged to durable trace).
 * Requires {@link isFleetDualEmitEnabled}. Prefer {@link maybeEmitFleetUltraworkAliasLive}
 * at Agent emit sites; use this helper only when you control separate durable vs live sinks.
 */
export function dualEmitFleetUltraworkAlias(
  emit: (event: AgentEvent) => void,
  event: AgentEvent & { readonly type: `ultrawork.${string}` },
  options?: {
    readonly emitLive?: (event: AgentEvent) => void;
    readonly env?: NodeJS.ProcessEnv;
  },
): void {
  emit(event);
  if (!isFleetDualEmitEnabled(options?.env)) return;
  const alias = fleetAliasForUltraworkEvent(event);
  if (alias === undefined) return;
  if (options?.emitLive !== undefined) {
    options.emitLive(alias);
    return;
  }
  emit(alias);
}

/** Settings / ops copy for Fleet dual-emit env gate. */
export function fleetDualEmitStatusLine(env: NodeJS.ProcessEnv = process.env): string {
  const reason = fleetDualEmitEnableReason(env);
  return reason !== null
    ? `Dual-emit: ON (${reason}) — fleet.* live WS only; journal stays ultrawork.*`
    : `Dual-emit: OFF (default) — journal golden sequences safe; read-path normalize accepts fleet.* · opt-in: ${FLEET_DUAL_EMIT_ENV}=1 or ${SOVEREIGN_UMBRELLA_ENV}=1`;
}

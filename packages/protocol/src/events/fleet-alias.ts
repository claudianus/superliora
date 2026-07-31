/**
 * Fleet ↔ Ultrawork collaboration/swarm protocol soft path.
 *
 * Canonical wire type remains `ultrawork.*`. Consumers accept `fleet.*` aliases
 * on read for collaboration/swarm suffixes without dual-emitting journal rows.
 */

import {
  isMissionUltraworkEventType,
  missionUltraworkEventAlias,
  ULTRAWORK_EVENT_PREFIX,
  type MissionUltraworkEventSuffix,
} from './mission-alias';

export const FLEET_EVENT_PREFIX = 'fleet.' as const;

/** Collaboration / swarm suffixes that may arrive as `fleet.*` during rename. */
export const FLEET_ULTRAWORK_EVENT_SUFFIXES = [
  'collaboration.message',
  'collaboration.mention',
  'collaboration.debate',
  'collaboration.steer',
  'team.staffed',
  'routing.decided',
  'task.assigned',
  'council.decision',
  'swarm.paused',
  'swarm.resumed',
  'swarm.restaff_requested',
] as const satisfies readonly MissionUltraworkEventSuffix[];

export type FleetUltraworkEventSuffix = (typeof FLEET_ULTRAWORK_EVENT_SUFFIXES)[number];

export function isFleetUltraworkEventType(
  type: string,
): type is `fleet.${FleetUltraworkEventSuffix}` {
  if (!type.startsWith(FLEET_EVENT_PREFIX)) return false;
  const suffix = type.slice(FLEET_EVENT_PREFIX.length);
  return (FLEET_ULTRAWORK_EVENT_SUFFIXES as readonly string[]).includes(suffix);
}

export function isUltraworkOrFleetEventType(type: string): boolean {
  return type.startsWith(ULTRAWORK_EVENT_PREFIX) || isFleetUltraworkEventType(type);
}

export function fleetUltraworkEventAlias(type: string): string {
  if (!type.startsWith(FLEET_EVENT_PREFIX)) return type;
  return ULTRAWORK_EVENT_PREFIX + type.slice(FLEET_EVENT_PREFIX.length);
}

export function ultraworkFleetEventAlias(type: string): string {
  if (!type.startsWith(ULTRAWORK_EVENT_PREFIX)) return type;
  const suffix = type.slice(ULTRAWORK_EVENT_PREFIX.length);
  if (!(FLEET_ULTRAWORK_EVENT_SUFFIXES as readonly string[]).includes(suffix)) return type;
  return FLEET_EVENT_PREFIX + suffix;
}

export function normalizeFleetUltraworkEventAlias<E extends { readonly type: string }>(event: E): E {
  if (!isFleetUltraworkEventType(event.type)) return event;
  return { ...event, type: fleetUltraworkEventAlias(event.type) as E['type'] };
}

/** Normalize mission.* then fleet.* read-path aliases to canonical ultrawork.*. */
export function normalizeMissionOrFleetUltraworkEventAlias<E extends { readonly type: string }>(
  event: E,
): E {
  if (isMissionUltraworkEventType(event.type)) {
    return { ...event, type: missionUltraworkEventAlias(event.type) as E['type'] };
  }
  return normalizeFleetUltraworkEventAlias(event);
}

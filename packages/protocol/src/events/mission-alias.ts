/**
 * Mission ↔ Ultrawork protocol soft path.
 *
 * Canonical wire type remains `ultrawork.*`. Consumers accept `mission.*` aliases
 * on read (parse / handler entry) without dual-emitting duplicate journal rows.
 */

export const MISSION_EVENT_PREFIX = 'mission.' as const;
export const ULTRAWORK_EVENT_PREFIX = 'ultrawork.' as const;

/** Ultrawork event suffixes that may arrive as `mission.*` during rename rollout. */
export const MISSION_ULTRAWORK_EVENT_SUFFIXES = [
  'stage.changed',
  'research.started',
  'research.provider.selected',
  'research.finding.verified',
  'team.staffed',
  'task.assigned',
  'collaboration.message',
  'collaboration.mention',
  'collaboration.debate',
  'collaboration.steer',
  'council.decision',
  'swarm.paused',
  'swarm.resumed',
  'swarm.restaff_requested',
  'verification.completed',
  'knowledge.promoted',
] as const;

export type MissionUltraworkEventSuffix = (typeof MISSION_ULTRAWORK_EVENT_SUFFIXES)[number];

export function isMissionUltraworkEventType(type: string): type is `mission.${MissionUltraworkEventSuffix}` {
  if (!type.startsWith(MISSION_EVENT_PREFIX)) return false;
  const suffix = type.slice(MISSION_EVENT_PREFIX.length);
  return (MISSION_ULTRAWORK_EVENT_SUFFIXES as readonly string[]).includes(suffix);
}

export function isUltraworkOrMissionEventType(type: string): boolean {
  return type.startsWith(ULTRAWORK_EVENT_PREFIX) || isMissionUltraworkEventType(type);
}

export function missionUltraworkEventAlias(type: string): string {
  if (!type.startsWith(MISSION_EVENT_PREFIX)) return type;
  return ULTRAWORK_EVENT_PREFIX + type.slice(MISSION_EVENT_PREFIX.length);
}

export function ultraworkMissionEventAlias(type: string): string {
  if (!type.startsWith(ULTRAWORK_EVENT_PREFIX)) return type;
  return MISSION_EVENT_PREFIX + type.slice(ULTRAWORK_EVENT_PREFIX.length);
}

export function normalizeMissionUltraworkEventAlias<E extends { readonly type: string }>(event: E): E {
  if (!isMissionUltraworkEventType(event.type)) return event;
  return { ...event, type: missionUltraworkEventAlias(event.type) as E['type'] };
}

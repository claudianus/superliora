/**
 * Pure helpers for War Room action dock pause / restaff reason strings.
 * Side-effect free so slash commands and session controllers share one path.
 */

export type WarRoomDockAction = 'pause' | 'restaff' | 'raw';

export function defaultWarRoomReason(action: Exclude<WarRoomDockAction, 'raw'>): string {
  return action === 'pause' ? 'Paused from war room' : 'User requested restaff';
}

/**
 * Normalize optional free-text reason; falls back to dock defaults.
 */
export function resolveWarRoomReason(
  action: Exclude<WarRoomDockAction, 'raw'>,
  reason?: string,
): string {
  if (reason === undefined || reason.trim().length === 0) {
    return defaultWarRoomReason(action);
  }
  return reason.trim();
}

/**
 * Append phase context for restaff RPC / steer fallback when phase is known.
 */
export function formatWarRoomRestaffReason(input: {
  readonly reason?: string;
  readonly phase?: string;
}): string {
  const reason = resolveWarRoomReason('restaff', input.reason);
  const phase =
    input.phase === undefined || input.phase.trim().length === 0
      ? ''
      : ` (phase: ${input.phase.trim()})`;
  return phase.length > 0 ? `${reason}${phase}` : reason;
}

/**
 * Steer fallback text when session.swarmRestaff rejects (no active run).
 */
export function buildWarRoomRestaffSteerDirective(input: {
  readonly reason?: string;
  readonly phase?: string;
}): string {
  const reason = resolveWarRoomReason('restaff', input.reason);
  const phase =
    input.phase === undefined || input.phase.trim().length === 0
      ? undefined
      : ` (phase: ${input.phase.trim()})`;
  return [
    'Fleet restaff requested from war room.',
    reason,
    phase,
    'Close unresolved required gaps by staffing additional specialists when slots allow.',
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(' ');
}

/**
 * Pure model for turn work-units: you → thinking → tools → answer.
 * Used by density chrome and future grouping containers — no UI imports.
 */

export type TurnPhaseId = 'user' | 'thinking' | 'tools' | 'answer';

export type TurnPhaseDensity = 'minimal' | 'compact' | 'standard' | 'full';

export const TURN_PHASE_ORDER: readonly TurnPhaseId[] = [
  'user',
  'thinking',
  'tools',
  'answer',
] as const;

export function nextTurnPhase(current: TurnPhaseId | undefined, event: TurnPhaseId): TurnPhaseId {
  if (current === undefined) return event;
  const a = TURN_PHASE_ORDER.indexOf(current);
  const b = TURN_PHASE_ORDER.indexOf(event);
  // Phases only advance (never go backwards mid-turn).
  return b >= a ? event : current;
}

export function turnPhaseLabel(phase: TurnPhaseId): string {
  switch (phase) {
    case 'user':
      return 'you';
    case 'thinking':
      return 'thinking';
    case 'tools':
      return 'tools';
    case 'answer':
      return 'answer';
  }
}

/**
 * Whether a density level should paint phase chrome headers for a phase.
 * All densities paint chrome; the mount path differs (component header vs boundary).
 */
export function shouldPaintPhaseChrome(
  _level: TurnPhaseDensity,
  _phase: TurnPhaseId,
): boolean {
  return true;
}

/**
 * Whether the phase's primary content component already paints a phase header.
 * When true, stream mounts should not insert a separate TurnPhaseBoundary.
 *
 * - user / thinking / answer: message components paint phase tags
 * - tools: chain summary bar paints the header except at `full` (no chain bar)
 */
export function phaseContentPaintsOwnHeader(
  phase: TurnPhaseId,
  level: TurnPhaseDensity,
): boolean {
  if (phase === 'tools') return level !== 'full';
  return true;
}

/**
 * Insert a TurnPhaseBoundary once when entering a phase whose content does
 * not already paint a header (today: tools at full density).
 */
export function shouldInsertPhaseBoundary(
  current: TurnPhaseId | undefined,
  next: TurnPhaseId,
  level: TurnPhaseDensity,
): boolean {
  if (!shouldPaintPhaseChrome(level, next)) return false;
  // Stay / already in this phase — no second boundary.
  if (current === next) return false;
  // Reject backward moves (nextTurnPhase freezes current).
  if (nextTurnPhase(current, next) !== next) return false;
  return !phaseContentPaintsOwnHeader(next, level);
}

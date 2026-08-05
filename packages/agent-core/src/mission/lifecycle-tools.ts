/**
 * Mission / Conductor lifecycle tool surface — hard requirement for plan/goal progression.
 *
 * Owning a Mission run is not the same as running its plan phases. `NextPhase`
 * and `RecordInterviewFinding` drive the interview/phase engine inside a plan
 * worker; the conductor creates the run and delegates those phases to a Job, so
 * requiring them here would gate the run owner on tools it must never call.
 */

export const MISSION_LIFECYCLE_TOOL_NAMES = [
  'EnterPlanMode',
  'ExitPlanMode',
  'CreateGoal',
  'GetGoal',
  'UpdateGoal',
] as const;

export type MissionLifecycleToolName = (typeof MISSION_LIFECYCLE_TOOL_NAMES)[number];

export function missingMissionLifecycleTools(
  enabledTools: ReadonlySet<string> | readonly string[],
): MissionLifecycleToolName[] {
  const set =
    enabledTools instanceof Set
      ? enabledTools
      : new Set(Array.from(enabledTools).map((t) => t.trim()));
  // Empty set means "bootstrap / all tools" — treat as complete.
  if (set.size === 0) return [];
  return MISSION_LIFECYCLE_TOOL_NAMES.filter((name) => !set.has(name));
}

export function assertMissionLifecycleTools(
  enabledTools: ReadonlySet<string> | readonly string[],
  context = 'Mission',
): void {
  const missing = missingMissionLifecycleTools(enabledTools);
  if (missing.length === 0) return;
  throw new Error(
    `${context} requires lifecycle tools that are not on the active agent profile: ${missing.join(', ')}. ` +
      `Use the conductor profile (default) or SUPERLIORA_PROFILE=agent / superliora-full. ` +
      `Core≤12 is a worker waist and cannot run Mission plan/goal gates.`,
  );
}

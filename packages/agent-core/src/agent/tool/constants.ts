/** Foreground timeout (seconds) for a user-initiated `!` shell command. */
export const SHELL_FOREGROUND_TIMEOUT_S = 2 * 60;

/**
 * Visual-surface tools previously gated on Premium density. Now always
 * included for cache stability; kept as a reference set for telemetry.
 */
export const VISUAL_DENSITY_TOOLS = new Set([
  'GenerateImage',
  'GenerateVideo',
  'VerifySurface',
  'VisualDiff',
]);

/**
 * Mode-gated tools sorted to the tail of the tool block. Their presence is
 * constant across turns (never filtered) so the prefix cache is preserved;
 * sorting them last maximizes the stable prefix length for providers that
 * cache the tools array head.
 */
export const CACHE_GATED_TOOLS = new Set([
  'ExitPlanMode',
  'GenerateImage',
  'GenerateVideo',
  'NextPhase',
  'RecordInterviewFinding',
  'SetGoalBudget',
  'UpdateGoal',
  'VerifySurface',
  'VisualDiff',
]);

/** Consecutive observations required before a density flip is recorded. */
export const VISUAL_DENSITY_HYSTERESIS = 3;

/**
 * Identifies whether a mode (Goal, Plan, Swarm) was activated standalone by the
 * user or as part of an Ultrawork orchestration run.
 *
 * - `'standalone'` — the user invoked the mode directly (e.g. `/ultragoal`,
 *   `/ultraplan`, `/ultraswarm`). No Ultrawork stage advancement or lifecycle
 *   coupling occurs.
 * - `'ultrawork'` — the mode was entered as a stage of an active Ultrawork run.
 *   Stage advancement (`maybeAdvanceUltraworkStage`, etc.) is performed.
 */
export type ModeActivationSource = 'standalone' | 'ultrawork';

export const DEFAULT_MODE_ACTIVATION_SOURCE: ModeActivationSource = 'standalone';

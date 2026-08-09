/**
 * Conductor project-mode pool overrides (UX v2).
 * Mode sets the default maxConcurrent; SUPERLIORA_CONDUCTOR_MAX_CONCURRENT still wins.
 */

import type { ToolStore } from '../../store';

export const JOB_PROJECT_MODE_STORE_KEY = 'job_project_mode' as const;

export type ConductorProjectMode = 'balanced' | 'greenfield' | 'hotfix' | 'review';

export const CONDUCTOR_PROJECT_MODE_MAX_CONCURRENT: Readonly<
  Record<ConductorProjectMode, number>
> = {
  balanced: 6,
  greenfield: 4,
  hotfix: 2,
  review: 3,
};

export interface JobProjectModeState {
  readonly mode: ConductorProjectMode;
}

declare module '../../store' {
  interface ToolStoreData {
    job_project_mode: JobProjectModeState;
  }
}

export function resolveConductorProjectMode(store: ToolStore): ConductorProjectMode | undefined {
  return store.get(JOB_PROJECT_MODE_STORE_KEY)?.mode;
}

/** Persist a session project-mode override used as the pool default (env still wins). */
export function setConductorProjectModeMaxConcurrent(
  store: ToolStore,
  mode: ConductorProjectMode,
): void {
  store.set(JOB_PROJECT_MODE_STORE_KEY, { mode });
}

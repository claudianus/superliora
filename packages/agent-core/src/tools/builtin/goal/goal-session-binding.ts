/**
 * Conductor session Goal binding — maps `/goal` UX onto Goal Desk + driver Jobs
 * so the main lane never owns driveGoalTurnLoop.
 */

import type { Agent } from '../../../agent/index';
import type { ToolStore } from '../../store';
import { abortJobWorker } from '../job/job-handles';
import { getJob, listJobs, type JobRecord } from '../job/job-ledger';
import { patchJobAndNotify } from '../job/job-notify';

export const GOAL_SESSION_BINDING_STORE_KEY = 'goal_session_binding' as const;

export type GoalSessionBindingStatus =
  | 'active'
  | 'paused'
  | 'done'
  | 'cancelled'
  | 'blocked';

export interface GoalSessionBinding {
  readonly schemaVersion: 1;
  readonly goalId: string;
  readonly deskJobId: string;
  readonly objective: string;
  readonly completionCriterion: string;
  /** Shell gate on the goal-driver Job (Prime autonomous-gate). */
  readonly gateCommand?: string;
  readonly driverJobIds: readonly string[];
  readonly status: GoalSessionBindingStatus;
  readonly updatedAt: string;
  readonly terminalReason?: string;
}

declare module '../../store' {
  interface ToolStoreData {
    goal_session_binding: GoalSessionBinding;
  }
}

/** Default finish line when the user objective has no explicit proof. */
export const DEFAULT_GOAL_DESK_COMPLETION_CRITERION =
  'Objective met with cited verification evidence (commands/tests run).';

export function readGoalSessionBinding(store: ToolStore): GoalSessionBinding | undefined {
  return store.get(GOAL_SESSION_BINDING_STORE_KEY);
}

export function writeGoalSessionBinding(store: ToolStore, binding: GoalSessionBinding): void {
  store.set(GOAL_SESSION_BINDING_STORE_KEY, { ...binding, updatedAt: new Date().toISOString() });
}

export function clearGoalSessionBinding(store: ToolStore): void {
  const current = readGoalSessionBinding(store);
  if (current === undefined) return;
  store.set(GOAL_SESSION_BINDING_STORE_KEY, {
    ...current,
    status: 'cancelled',
    updatedAt: new Date().toISOString(),
    terminalReason: current.terminalReason ?? 'cancelled',
  });
}

export function resolveCompletionCriterion(
  objective: string,
  explicit?: string,
): string {
  const trimmed = explicit?.trim();
  if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  // Heuristic: objective already names a check → use it as the criterion.
  if (/\b(pass|passes|exit 0|green|verified|until)\b/i.test(objective)) {
    return objective.trim().slice(0, 500);
  }
  return DEFAULT_GOAL_DESK_COMPLETION_CRITERION;
}

/** Cancel desk + drivers; best-effort worker abort. */
export function cancelBoundGoalJobs(
  store: ToolStore,
  binding: GoalSessionBinding,
  reason: string,
  agent?: Agent,
): void {
  const ids = [binding.deskJobId, ...binding.driverJobIds];
  for (const id of ids) {
    const job = getJob(store, id);
    if (job === undefined) continue;
    if (
      job.status === 'done' ||
      job.status === 'failed' ||
      job.status === 'cancelled' ||
      job.status === 'interrupted'
    ) {
      continue;
    }
    abortJobWorker(id);
    const status = reason === 'pause' ? 'interrupted' : 'cancelled';
    patchJobAndNotify(
      store,
      id,
      {
        status,
        notes: [job.notes, `goal-desk: ${reason}`].filter(Boolean).join('\n'),
      },
      { agent, summary: `goal-desk: ${reason}` },
    );
  }
}

/** When a goal-driver child finishes, mirror terminal state onto the desk umbrella. */
export function syncGoalDeskParentFromDriver(
  store: ToolStore,
  driver: JobRecord,
  agent?: Agent,
): void {
  if (driver.parentJobId === undefined) return;
  const parent = getJob(store, driver.parentJobId);
  if (parent === undefined || parent.kind !== 'goal-desk') return;

  const binding = readGoalSessionBinding(store);
  const shouldEmitGoal =
    binding !== undefined &&
    binding.deskJobId === parent.id &&
    (driver.status === 'done' ||
      driver.status === 'failed' ||
      driver.status === 'blocked' ||
      driver.status === 'cancelled' ||
      driver.status === 'interrupted');

  if (binding !== undefined && binding.deskJobId === parent.id) {
    if (driver.status === 'done') {
      writeGoalSessionBinding(store, {
        ...binding,
        status: 'done',
        terminalReason: driver.resultSummary?.slice(0, 200),
      });
    } else if (driver.status === 'failed' || driver.status === 'blocked') {
      writeGoalSessionBinding(store, {
        ...binding,
        status: 'blocked',
        terminalReason: driver.resultSummary?.slice(0, 200) ?? driver.status,
      });
    } else if (driver.status === 'cancelled' || driver.status === 'interrupted') {
      writeGoalSessionBinding(store, {
        ...binding,
        status: driver.status === 'interrupted' ? 'paused' : 'cancelled',
        terminalReason: driver.resultSummary?.slice(0, 200),
      });
    }
  }

  if (driver.status === 'done' || driver.status === 'failed') {
    patchJobAndNotify(
      store,
      parent.id,
      {
        status: driver.status,
        resultSummary: driver.resultSummary,
        notes: [parent.notes, `goal-desk: driver ${driver.id} → ${driver.status}`]
          .filter(Boolean)
          .join('\n'),
      },
      { agent, summary: driver.resultSummary },
    );
  } else if (driver.status === 'blocked' || driver.status === 'needs_user') {
    patchJobAndNotify(
      store,
      parent.id,
      {
        status: driver.status === 'needs_user' ? 'needs_user' : 'blocked',
        resultSummary: driver.resultSummary,
      },
      { agent, summary: driver.resultSummary },
    );
  } else if (driver.status === 'cancelled' || driver.status === 'interrupted') {
    patchJobAndNotify(
      store,
      parent.id,
      {
        status: driver.status,
        resultSummary: driver.resultSummary,
      },
      { agent, summary: driver.resultSummary },
    );
  }

  // Surface Goal Monitor / completion card on the Conductor lane without a turn.
  if (shouldEmitGoal && agent !== undefined) {
    // Lazy import avoids a facade ↔ binding cycle at module init.
    void import('./goal-desk-facade').then(({ emitGoalDeskSnapshot }) => {
      emitGoalDeskSnapshot(agent, store);
    });
  }
}

export function listActiveGoalDeskJobs(store: ToolStore): readonly JobRecord[] {
  return listJobs(store).filter(
    (j) =>
      j.kind === 'goal-desk' &&
      (j.status === 'queued' ||
        j.status === 'running' ||
        j.status === 'needs_user' ||
        j.status === 'blocked' ||
        j.status === 'interrupted'),
  );
}

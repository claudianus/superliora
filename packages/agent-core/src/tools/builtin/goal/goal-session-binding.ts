/**
 * Conductor session Goal binding — maps `/goal` UX onto Goal Desk + driver Jobs
 * so the main lane never owns driveGoalTurnLoop.
 */

import type { Agent } from '../../../agent/index';
import type { ToolStore } from '../../store';
import { abortJobWorker } from '../job/job-handles';
import { emitJobEvents, jobRecordToUpdatedEvent } from '../job/job-emit';
import { getJob, listJobs, patchJob, type JobRecord } from '../job/job-ledger';
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

/** queued/running — driver is pursuing the goal again (not held/stalled). */
const PRODUCTIVE_DRIVER_STATUSES = new Set<JobRecord['status']>(['queued', 'running']);

const DRIVER_LIVE_STATUSES = new Set([
  'queued',
  'running',
  'needs_user',
  'blocked',
  'interrupted',
]);

function isDriverSettled(status: JobRecord['status']): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

function driverMatchesBindingObjective(driver: JobRecord, binding: GoalSessionBinding): boolean {
  const objective = binding.objective.trim();
  if (objective.length === 0) return false;
  return (
    driver.goalObjective?.trim() === objective ||
    driver.prompt?.trim() === objective
  );
}

function isDriverBoundToGoalDesk(binding: GoalSessionBinding, driver: JobRecord): boolean {
  if (driver.kind !== 'goal-driver') return false;
  if (binding.driverJobIds.includes(driver.id)) return true;
  if (driver.parentJobId === binding.deskJobId) return true;
  return driverMatchesBindingObjective(driver, binding);
}

/**
 * Drivers for this Goal Desk: bound ids, umbrella children, and same-objective
 * orphans (Conductor JobCreate after CreateGoal conflict / fresh spawn).
 */
export function listDeskGoalDrivers(
  store: ToolStore,
  binding: GoalSessionBinding,
): readonly JobRecord[] {
  const byId = new Map<string, JobRecord>();
  for (const id of binding.driverJobIds) {
    const job = getJob(store, id);
    if (job !== undefined) byId.set(job.id, job);
  }
  for (const job of listJobs(store)) {
    if (job.kind !== 'goal-driver') continue;
    if (byId.has(job.id)) continue;
    if (job.parentJobId === binding.deskJobId || driverMatchesBindingObjective(job, binding)) {
      byId.set(job.id, job);
    }
  }
  return [...byId.values()];
}

function unstickGoalDeskUmbrella(
  store: ToolStore,
  binding: GoalSessionBinding,
  productive: readonly JobRecord[],
  agent?: Agent,
): void {
  const desk = getJob(store, binding.deskJobId);
  if (desk === undefined) return;
  if (
    desk.status !== 'blocked' &&
    desk.status !== 'failed' &&
    desk.status !== 'needs_user'
  ) {
    return;
  }
  const status = productive.some((job) => job.status === 'running') ? 'running' : 'queued';
  const next = patchJob(store, desk.id, {
    status,
    resultSummary: undefined,
    notes: [desk.notes, 'goal-desk: heal — driver live again'].filter(Boolean).join('\n'),
  });
  if (next !== undefined && agent !== undefined) {
    emitJobEvents(agent, [jobRecordToUpdatedEvent(next, { reason: 'goal-desk:driver-live' })]);
  }
}

/**
 * Clear a stuck `blocked` Goal Desk binding when a driver is queued/running again.
 * Adopts orphan driver ids so progress aggregates onto the session Goal.
 */
function reactivateBlockedGoalDeskBinding(
  store: ToolStore,
  binding: GoalSessionBinding,
  productive: readonly JobRecord[],
  agent?: Agent,
): GoalSessionBinding {
  const adoptedIds = new Set(binding.driverJobIds);
  for (const driver of productive) {
    adoptedIds.add(driver.id);
  }
  const next: GoalSessionBinding = {
    ...binding,
    status: 'active',
    terminalReason: undefined,
    driverJobIds: [...adoptedIds],
    updatedAt: new Date().toISOString(),
  };
  writeGoalSessionBinding(store, next);
  unstickGoalDeskUmbrella(store, next, productive, agent);
  return next;
}

/** When a goal-driver child finishes, mirror terminal state onto the desk umbrella. */
export function syncGoalDeskParentFromDriver(
  store: ToolStore,
  driver: JobRecord,
  agent?: Agent,
): void {
  if (driver.kind !== 'goal-driver') return;

  const binding = readGoalSessionBinding(store);

  // Resume / fresh spawn: driver is live again but binding stayed blocked
  // (model probe, JobResume without /goal resume, orphan JobCreate).
  if (
    binding !== undefined &&
    binding.status === 'blocked' &&
    PRODUCTIVE_DRIVER_STATUSES.has(driver.status) &&
    isDriverBoundToGoalDesk(binding, driver)
  ) {
    reactivateBlockedGoalDeskBinding(store, binding, [driver], agent);
    if (agent !== undefined) {
      void import('./goal-desk-facade').then(({ emitGoalDeskSnapshot }) => {
        emitGoalDeskSnapshot(agent, store);
      });
    }
  }

  if (driver.parentJobId === undefined) return;
  const parent = getJob(store, driver.parentJobId);
  if (parent === undefined || parent.kind !== 'goal-desk') return;

  const latest = readGoalSessionBinding(store);
  const shouldEmitGoal =
    latest !== undefined &&
    latest.deskJobId === parent.id &&
    (driver.status === 'done' ||
      driver.status === 'failed' ||
      driver.status === 'blocked' ||
      driver.status === 'cancelled' ||
      driver.status === 'interrupted');

  if (latest !== undefined && latest.deskJobId === parent.id) {
    if (driver.status === 'done') {
      writeGoalSessionBinding(store, {
        ...latest,
        status: 'done',
        terminalReason: driver.resultSummary?.slice(0, 200),
      });
    } else if (driver.status === 'failed' || driver.status === 'blocked') {
      writeGoalSessionBinding(store, {
        ...latest,
        status: 'blocked',
        terminalReason: driver.resultSummary?.slice(0, 200) ?? driver.status,
      });
    } else if (driver.status === 'cancelled' || driver.status === 'interrupted') {
      writeGoalSessionBinding(store, {
        ...latest,
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

/**
 * Heal Goal Desk binding drift:
 * - `blocked` + productive driver → `active` (resume / fresh spawn without /goal resume)
 * - `active` after every driver settled → mirror terminal (zombie close)
 *
 * Safe to call from snapshot / GetGoal / progress heartbeats.
 */
export function healActiveGoalDeskBinding(
  store: ToolStore,
  binding: GoalSessionBinding,
  agent?: Agent,
): GoalSessionBinding {
  const drivers = listDeskGoalDrivers(store, binding);
  const productive = drivers.filter((job) => PRODUCTIVE_DRIVER_STATUSES.has(job.status));

  if (binding.status === 'blocked' && productive.length > 0) {
    return reactivateBlockedGoalDeskBinding(store, binding, productive, agent);
  }

  if (binding.status !== 'active') return binding;

  if (drivers.length === 0) {
    // Spawn race: desk just created and driver card not in ledger yet.
    const desk = getJob(store, binding.deskJobId);
    if (desk !== undefined && (desk.status === 'queued' || desk.status === 'running')) {
      const ageMs = Date.now() - Date.parse(binding.updatedAt);
      if (!Number.isFinite(ageMs) || ageMs < 15_000) return binding;
    }
    const next: GoalSessionBinding = {
      ...binding,
      status: 'blocked',
      terminalReason: 'goal worker missing from ledger',
      updatedAt: new Date().toISOString(),
    };
    writeGoalSessionBinding(store, next);
    if (desk !== undefined && (desk.status === 'queued' || desk.status === 'running')) {
      patchJobAndNotify(
        store,
        desk.id,
        {
          status: 'blocked',
          resultSummary: next.terminalReason,
          notes: [desk.notes, 'goal-desk: heal — driver missing'].filter(Boolean).join('\n'),
        },
        { agent, summary: next.terminalReason },
      );
    }
    return next;
  }

  if (drivers.some((job) => DRIVER_LIVE_STATUSES.has(job.status))) {
    // Adopt orphans discovered under the desk so later progress aggregates.
    const known = new Set(binding.driverJobIds);
    const missing = drivers.filter((job) => !known.has(job.id)).map((job) => job.id);
    if (missing.length === 0) return binding;
    const next: GoalSessionBinding = {
      ...binding,
      driverJobIds: [...binding.driverJobIds, ...missing],
      updatedAt: new Date().toISOString(),
    };
    writeGoalSessionBinding(store, next);
    return next;
  }

  // Prefer a settled driver (done/failed/cancelled); ignore odd leftovers.
  const settled = drivers.filter((job) => isDriverSettled(job.status));
  const byUpdatedDesc = (a: JobRecord, b: JobRecord): number =>
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const primary =
    settled.toSorted(byUpdatedDesc)[0] ?? drivers.toSorted(byUpdatedDesc)[0];
  if (primary === undefined) return binding;

  syncGoalDeskParentFromDriver(store, primary, agent);
  return readGoalSessionBinding(store) ?? binding;
}

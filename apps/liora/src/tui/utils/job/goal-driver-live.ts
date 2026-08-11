/**
 * Resolve the live Goal Desk lane line for Goal Monitor / footer.
 * Pure projection — no SDK calls.
 *
 * Never leave the UI on eternal "spinning up": after a short spawn grace,
 * missing drivers become an honest idle / fleet / missing state.
 */

import type { GoalSnapshot } from '@superliora/sdk';
import type { JobEventKind, JobEventStatus } from '@superliora/protocol';

import type { ConductorJobCard, ConductorJobActivity } from './job-strip';

/** First seconds after /goal where a missing driver card is still a spawn race. */
export const GOAL_DESK_SPAWN_GRACE_MS = 12_000;

export interface GoalDriverLive {
  readonly jobId: string;
  readonly status: JobEventStatus;
  readonly title: string;
  readonly phase?: string;
  readonly recentTools?: readonly string[];
  readonly liveActivity?: ConductorJobActivity;
}

export type GoalDeskLive =
  | { readonly mode: 'driver'; readonly driver: GoalDriverLive }
  | {
      readonly mode: 'fleet';
      readonly jobId: string;
      readonly status: JobEventStatus;
      readonly kind: JobEventKind;
      readonly title: string;
      readonly liveActivity?: ConductorJobActivity;
    }
  | { readonly mode: 'spinning_up' }
  | {
      readonly mode: 'awaiting_conductor';
      readonly lastKind?: JobEventKind;
      readonly lastTitle?: string;
      readonly lastStatus?: JobEventStatus;
    }
  | { readonly mode: 'missing_worker' };

const LIVE_JOB_STATUSES: ReadonlySet<JobEventStatus> = new Set([
  'queued',
  'running',
  'needs_user',
  'blocked',
  'interrupted',
]);

const TERMINAL_JOB_STATUSES: ReadonlySet<JobEventStatus> = new Set([
  'done',
  'failed',
  'cancelled',
]);

/** Pick the most relevant goal-driver card for an active Goal Desk goal. */
export function pickGoalDriverLive(
  goal: GoalSnapshot | null | undefined,
  jobs: readonly ConductorJobCard[] | undefined,
): GoalDriverLive | undefined {
  if (goal === null || goal === undefined || goal.execution !== 'goal-desk') return undefined;
  if (jobs === undefined || jobs.length === 0) return undefined;

  const drivers = jobs.filter((card) => card.kind === 'goal-driver');
  if (drivers.length === 0) return undefined;

  const rank = (status: JobEventStatus): number => {
    switch (status) {
      case 'running':
        return 0;
      case 'needs_user':
        return 1;
      case 'blocked':
        return 2;
      case 'queued':
        return 3;
      case 'interrupted':
        return 4;
      default:
        return 5;
    }
  };

  const sorted = [...drivers].sort((a, b) => {
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    return b.updatedAtMs - a.updatedAtMs;
  });
  const card = sorted[0];
  if (card === undefined) return undefined;

  return {
    jobId: card.id,
    status: card.status,
    title: card.title,
    ...(card.progress?.phase !== undefined ? { phase: card.progress.phase } : {}),
    ...(card.progress?.recentTools !== undefined && card.progress.recentTools.length > 0
      ? { recentTools: card.progress.recentTools }
      : {}),
    ...(card.liveActivity !== undefined ? { liveActivity: card.liveActivity } : {}),
  };
}

function rankFleet(status: JobEventStatus): number {
  switch (status) {
    case 'running':
      return 0;
    case 'needs_user':
      return 1;
    case 'blocked':
      return 2;
    case 'queued':
      return 3;
    case 'interrupted':
      return 4;
    default:
      return 5;
  }
}

/** Full Goal Desk lane projection — honest when the driver card is absent. */
export function resolveGoalDeskLive(
  goal: GoalSnapshot | null | undefined,
  jobs: readonly ConductorJobCard[] | undefined,
  wallClockMs: number,
): GoalDeskLive | undefined {
  if (goal === null || goal === undefined || goal.execution !== 'goal-desk') return undefined;

  const driver = pickGoalDriverLive(goal, jobs);
  if (driver !== undefined) {
    // Settled driver still on the board — surface it; do not pretend to spin up.
    return { mode: 'driver', driver };
  }

  const cards = jobs ?? [];
  const fleet = cards
    .filter(
      (card) =>
        card.kind !== 'goal-desk' &&
        card.kind !== 'goal-driver' &&
        card.kind !== 'desk' &&
        LIVE_JOB_STATUSES.has(card.status),
    )
    .sort((a, b) => {
      const byStatus = rankFleet(a.status) - rankFleet(b.status);
      if (byStatus !== 0) return byStatus;
      return b.updatedAtMs - a.updatedAtMs;
    })[0];

  if (fleet !== undefined) {
    return {
      mode: 'fleet',
      jobId: fleet.id,
      status: fleet.status,
      kind: fleet.kind,
      title: fleet.title,
      ...(fleet.liveActivity !== undefined ? { liveActivity: fleet.liveActivity } : {}),
    };
  }

  const lastTerminal = cards
    .filter(
      (card) =>
        card.kind !== 'goal-desk' &&
        card.kind !== 'desk' &&
        TERMINAL_JOB_STATUSES.has(card.status),
    )
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0];

  if (wallClockMs < GOAL_DESK_SPAWN_GRACE_MS && lastTerminal === undefined) {
    return { mode: 'spinning_up' };
  }

  if (lastTerminal !== undefined) {
    return {
      mode: 'awaiting_conductor',
      lastKind: lastTerminal.kind,
      lastTitle: lastTerminal.title,
      lastStatus: lastTerminal.status,
    };
  }

  if (wallClockMs < GOAL_DESK_SPAWN_GRACE_MS) {
    return { mode: 'spinning_up' };
  }

  return { mode: 'missing_worker' };
}

/** Stable key so the Goal Monitor memo invalidates when the desk lane moves. */
export function goalDeskLiveKey(live: GoalDeskLive | null | undefined): string {
  if (live === null || live === undefined) return '';
  switch (live.mode) {
    case 'driver':
      return `driver|${goalDriverLiveKey(live.driver)}`;
    case 'fleet':
      return [
        'fleet',
        live.jobId,
        live.status,
        live.kind,
        live.liveActivity?.name ?? '',
        live.liveActivity?.status ?? '',
        live.liveActivity?.target ?? '',
      ].join('|');
    case 'spinning_up':
      return 'spinning_up';
    case 'awaiting_conductor':
      return [
        'awaiting_conductor',
        live.lastKind ?? '',
        live.lastStatus ?? '',
        live.lastTitle ?? '',
      ].join('|');
    case 'missing_worker':
      return 'missing_worker';
  }
}

/** @deprecated Prefer {@link goalDeskLiveKey}; kept for existing call sites. */
export function goalDriverLiveKey(live: GoalDriverLive | null | undefined): string {
  if (live === null || live === undefined) return '';
  return [
    live.jobId,
    live.status,
    live.phase ?? '',
    live.liveActivity?.name ?? '',
    live.liveActivity?.status ?? '',
    live.liveActivity?.target ?? '',
    live.recentTools?.at(-1) ?? '',
  ].join('|');
}

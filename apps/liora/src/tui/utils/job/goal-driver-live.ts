/**
 * Resolve the live goal-driver card for a Conductor Goal Desk goal.
 * Pure projection — Goal Monitor / footer read this; no SDK calls.
 */

import type { GoalSnapshot } from '@superliora/sdk';
import type { JobEventStatus } from '@superliora/protocol';

import type { ConductorJobCard, ConductorJobActivity } from './job-strip';

export interface GoalDriverLive {
  readonly jobId: string;
  readonly status: JobEventStatus;
  readonly title: string;
  readonly phase?: string;
  readonly recentTools?: readonly string[];
  readonly liveActivity?: ConductorJobActivity;
}

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

/** Stable key so the Goal Monitor memo invalidates when the driver moves. */
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

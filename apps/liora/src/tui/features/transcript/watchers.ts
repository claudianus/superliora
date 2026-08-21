/**
 * Idle-surviving background work that can wake a new turn after the agent
 * looks idle — process commands, detached questions, and background subagents.
 * Counts-first "still running" copy matches the grok pager cue, using
 * SuperLiora task kinds only (no invented monitor/loop/workflow buckets).
 */

import type { BackgroundTaskInfo } from '@superliora/sdk';

export interface Watchers {
  readonly commands: number;
  readonly questions: number;
  readonly subagents: number;
}

export const EMPTY_WATCHERS: Watchers = {
  commands: 0,
  questions: 0,
  subagents: 0,
};

const TERMINAL_STATUSES = new Set<BackgroundTaskInfo['status']>([
  'completed',
  'failed',
  'timed_out',
  'killed',
  'lost',
]);

export function watcherTotal(watchers: Watchers): number {
  return watchers.commands + watchers.questions + watchers.subagents;
}

export function watchersIdentity(watchers: Watchers): string {
  return `${String(watchers.commands)}:${String(watchers.questions)}:${String(watchers.subagents)}`;
}

export function hasLiveWatchers(
  tasks: ReadonlyMap<string, BackgroundTaskInfo> | undefined,
): boolean {
  if (tasks === undefined) return false;
  return watcherTotal(countWatchers(tasks.values())) > 0;
}

export function countWatchers(tasks: Iterable<BackgroundTaskInfo>): Watchers {
  let commands = 0;
  let questions = 0;
  let subagents = 0;
  for (const info of tasks) {
    if (TERMINAL_STATUSES.has(info.status)) continue;
    if (info.kind === 'agent') {
      subagents += 1;
    } else if (info.kind === 'question') {
      questions += 1;
    } else {
      commands += 1;
    }
  }
  return { commands, questions, subagents };
}

/** Counts-first cue, e.g. `"1 command · 2 subagents still running"`. */
export function formatStillRunning(
  kinds: readonly (readonly [count: number, noun: string])[],
): string | undefined {
  const parts: string[] = [];
  for (const [count, noun] of kinds) {
    if (count === 0) continue;
    parts.push(`${String(count)} ${noun}${count === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return undefined;
  return `${parts.join(' · ')} still running`;
}

export function stillRunningLabel(watchers: Watchers | undefined): string | undefined {
  if (watchers === undefined) return undefined;
  return formatStillRunning([
    [watchers.commands, 'command'],
    [watchers.questions, 'question'],
    [watchers.subagents, 'subagent'],
  ]);
}

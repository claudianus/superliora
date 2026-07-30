import { TERMINAL_STATUSES, type BackgroundTaskInfo, type BackgroundTaskInfoBase } from './task';
import type { ManagedTask } from './managed-types';

export function isDetached(entry: ManagedTask): boolean {
  return entry.foregroundRelease === undefined;
}

export function startedInBackground(entry: ManagedTask): boolean {
  return entry.options.detached !== false;
}

export function activeBackgroundAdmissionCount(tasks: ReadonlyMap<string, ManagedTask>): number {
  let count = 0;
  for (const entry of tasks.values()) {
    if (!TERMINAL_STATUSES.has(entry.status) && startedInBackground(entry)) count++;
  }
  return count;
}

export function shouldListTask(info: BackgroundTaskInfo, activeOnly: boolean): boolean {
  if (!TERMINAL_STATUSES.has(info.status)) return true;
  if (activeOnly) return false;
  return info.detached !== false;
}

export function toManagedTaskInfo(entry: ManagedTask): BackgroundTaskInfo {
  const base: BackgroundTaskInfoBase = {
    taskId: entry.taskId,
    description: entry.task.description,
    status: entry.status,
    detached: isDetached(entry),
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    stopReason: entry.stopReason,
    terminalNotificationSuppressed: entry.terminalNotificationSuppressed,
    timeoutMs: entry.options.timeoutMs,
  };
  return entry.task.toInfo(base);
}

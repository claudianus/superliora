import type { BackgroundManagerHost } from './manager-host';
import { toManagedTaskInfo } from './manager-query';
import { restoreBackgroundTaskNotifications } from './manager-notify-delivery';
import { emitTaskTerminated } from './manager-events';
import { TERMINAL_STATUSES, type BackgroundTaskInfo } from './task';
import type { ManagedTask } from './managed-types';

export async function loadBackgroundTasksFromDisk(host: BackgroundManagerHost): Promise<void> {
  const persistence = host.persistence;
  if (persistence === undefined) return;
  host.ghosts.clear();
  const persisted = await persistence.listTasks();
  for (const t of persisted) {
    if (host.tasks.has(t.taskId)) continue;
    host.ghosts.set(t.taskId, t);
  }
}

async function markLoadedBackgroundTasksLost(
  host: BackgroundManagerHost,
): Promise<readonly BackgroundTaskInfo[]> {
  const lostInfo: BackgroundTaskInfo[] = [];
  const persistence = host.persistence;
  for (const [id, info] of host.ghosts) {
    if (TERMINAL_STATUSES.has(info.status)) continue;
    const updated: BackgroundTaskInfo = {
      ...info,
      status: 'lost',
      endedAt: info.endedAt ?? Date.now(),
    };
    host.ghosts.set(id, updated);
    if (persistence !== undefined) {
      await persistence.writeTask(updated);
    }
    lostInfo.push(updated);
  }
  return lostInfo;
}

export async function reconcileBackgroundTasks(host: BackgroundManagerHost): Promise<void> {
  const lostInfo = await markLoadedBackgroundTasksLost(host);
  for (const info of lostInfo) {
    emitTaskTerminated(host, info);
  }
  await restoreBackgroundTaskNotifications(host);
}

export function persistLiveBackgroundTask(host: BackgroundManagerHost, entry: ManagedTask): Promise<void> {
  const persistence = host.persistence;
  if (persistence === undefined) return Promise.resolve();
  const info = toManagedTaskInfo(entry);
  entry.persistWriteQueue = entry.persistWriteQueue
    .then(() => persistence.writeTask(info))
    .catch(() => { });
  return entry.persistWriteQueue;
}

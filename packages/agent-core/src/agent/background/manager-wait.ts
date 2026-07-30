import { abortRejecter } from './managed-types';
import { normalizeMultiWaitIds } from './multi-wait';
import type { BackgroundManagerHost } from './manager-host';
import { isBackgroundTaskTerminal } from './terminal-status';
import { TERMINAL_STATUSES, type BackgroundTaskInfo } from './task';
import type { ForegroundTaskReleaseReason } from './managed-types';
import { timeoutOutcome } from '../../utils/promise';

export async function waitForActiveBackgroundTasks(
  host: BackgroundManagerHost,
  predicate: (info: BackgroundTaskInfo) => boolean,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const deadline =
    options.timeoutMs !== undefined && options.timeoutMs > 0
      ? Date.now() + options.timeoutMs
      : undefined;
  const signal = options.signal;
  while (true) {
    signal?.throwIfAborted();
    const active = host.list(true).filter(predicate);
    if (active.length === 0) return;
    let perTaskTimeout: number | undefined;
    if (deadline !== undefined) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      perTaskTimeout = remaining;
    }
    const batch = Promise.all(active.map((t) => waitForBackgroundTask(host, t.taskId, perTaskTimeout)));
    if (signal === undefined) {
      await batch;
    } else {
      await Promise.race([batch, abortRejecter(signal)]);
    }
  }
}

export async function waitForBackgroundTask(
  host: BackgroundManagerHost,
  taskId: string,
  timeoutMs = 30_000,
): Promise<BackgroundTaskInfo | undefined> {
  const entry = host.tasks.get(taskId);
  if (!entry) return undefined;
  if (TERMINAL_STATUSES.has(entry.status)) {
    await entry.persistWriteQueue;
    return host.toInfo(entry);
  }

  if (timeoutMs <= 0) {
    return host.toInfo(entry);
  }
  const timeout = timeoutOutcome(timeoutMs, undefined);
  await Promise.race([entry.terminal, timeout]).finally(() => timeout.clear());

  if (TERMINAL_STATUSES.has(entry.status)) {
    await entry.persistWriteQueue;
  }
  return host.toInfo(entry);
}

export async function waitForAllBackgroundTasks(
  host: BackgroundManagerHost,
  taskIds: readonly string[],
  timeoutMs = 30_000,
): Promise<readonly (BackgroundTaskInfo | undefined)[]> {
  const ids = normalizeMultiWaitIds(taskIds);
  return Promise.all(ids.map((id) => waitForBackgroundTask(host, id, timeoutMs)));
}

export async function waitForAnyBackgroundTask(
  host: BackgroundManagerHost,
  taskIds: readonly string[],
  timeoutMs = 30_000,
): Promise<BackgroundTaskInfo | undefined> {
  const ids = normalizeMultiWaitIds(taskIds);
  if (ids.length === 0) return undefined;

  for (const id of ids) {
    const info = host.getTask(id);
    if (info !== undefined && isBackgroundTaskTerminal(info.status)) {
      return info;
    }
  }

  if (timeoutMs <= 0) {
    return undefined;
  }

  type RaceResult = { readonly kind: 'task'; readonly info: BackgroundTaskInfo } | { readonly kind: 'timeout' };
  const timeout = timeoutOutcome(timeoutMs, { kind: 'timeout' } as RaceResult);
  try {
    const raced = await Promise.race<RaceResult>([
      ...ids.map(async (id): Promise<RaceResult> => {
        const info = await waitForBackgroundTask(host, id, timeoutMs);
        if (info !== undefined && isBackgroundTaskTerminal(info.status)) {
          return { kind: 'task', info };
        }
        return timeout;
      }),
      timeout,
    ]);
    return raced.kind === 'task' ? raced.info : undefined;
  } finally {
    timeout.clear();
  }
}

export async function waitForForegroundBackgroundTaskRelease(
  host: BackgroundManagerHost,
  taskId: string,
): Promise<ForegroundTaskReleaseReason | undefined> {
  const entry = host.tasks.get(taskId);
  if (!entry) return undefined;
  if (TERMINAL_STATUSES.has(entry.status)) {
    await entry.persistWriteQueue;
    return 'terminal';
  }
  if (host.isDetached(entry)) return 'detached';

  const foregroundRelease = entry.foregroundRelease;
  const reason = await Promise.race([
    foregroundRelease,
    entry.terminal.then(() => 'terminal' as const),
  ]);
  if (reason === 'terminal') {
    await entry.persistWriteQueue;
  }
  return reason;
}

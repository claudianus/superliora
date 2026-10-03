import { createControlledPromise } from '@antfu/utils';

import type { Agent } from '../..';
import {
  generateTaskId,
  type BackgroundTaskOutputSnapshot,
  type ForegroundTaskReleaseReason,
  type ManagedTask,
  type RegisterBackgroundTaskOptions,
} from './managed-types';
import { emitTaskStarted, fireTerminalEffects } from './manager-events';
import { runBackgroundTaskLifecycle } from './manager-lifecycle';
import type { BackgroundManagerHost } from './manager-host';
import {
  appendBackgroundTaskOutput,
  getBackgroundTaskOutputSnapshot,
  persistBackgroundTaskOutput,
  readBackgroundTaskOutput,
  startBackgroundTaskOutputPersist,
} from './manager-output';
import {
  loadBackgroundTasksFromDisk,
  persistLiveBackgroundTask,
  reconcileBackgroundTasks,
} from './manager-persistence';
import {
  activeBackgroundAdmissionCount,
  isDetached,
  shouldListTask,
  toManagedTaskInfo,
} from './manager-query';
import {
  waitForActiveBackgroundTasks,
  waitForAllBackgroundTasks,
  waitForAnyBackgroundTask,
  waitForBackgroundTask,
  waitForForegroundBackgroundTaskRelease,
} from './manager-wait';
import { type BackgroundTaskPersistence } from './persist';
import { TERMINAL_STATUSES, type BackgroundTask, type BackgroundTaskInfo } from './task';

export class BackgroundManager implements BackgroundManagerHost {
  readonly tasks = new Map<string, ManagedTask>();
  /**
   * Ghosts: tasks loaded from disk during reconcile that have no live
   * KaosProcess. They appear in `list()` / `getTask()` with status
   * `lost` so users see what was running before the crash/restart.
   */
  readonly ghosts = new Map<string, BackgroundTaskInfo>();


  constructor(
    readonly agent: Agent,
    readonly persistence?: BackgroundTaskPersistence,
  ) { }

  assertResourcesSettled(): void {
    const errors: Error[] = [];
    for (const entry of this.tasks.values()) {
      if (entry.task.resourcesSettled === false) errors.push(new Error(`Task resources have not settled: ${entry.taskId}${entry.stopReason === undefined ? '' : ` (${entry.stopReason})`}`));
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Background resources remain owned.');
  }

  private assertCanRegister(startedInBackground: boolean): void {
    const maxRunningTasks = this.agent.kimiConfig?.background?.maxRunningTasks;
    if (maxRunningTasks === undefined) return;
    if (!startedInBackground) return;
    if (activeBackgroundAdmissionCount(this.tasks) < maxRunningTasks) return;
    throw new Error('Too many background tasks are already running.');
  }
  /** Adopt an already-owned failed process without opening a new admission. */
  retainUnsettledTask(task: BackgroundTask): string {
    for (const entry of this.tasks.values()) if (entry.task === task) return entry.taskId;
    return this.registerTask(task, { detached: false });
  }


  registerTask(task: BackgroundTask, options: RegisterBackgroundTaskOptions = {}): string {
    const detached = options.detached ?? true;
    const timeoutMs = options.timeoutMs ?? task.timeoutMs;
    const entryOptions: RegisterBackgroundTaskOptions = {
      detached,
      timeoutMs,
      detachTimeoutMs: options.detachTimeoutMs,
      signal: detached ? undefined : options.signal,
    };
    this.assertCanRegister(detached);
    const taskId = generateTaskId(task.idPrefix);
    const entry: ManagedTask = {
      taskId,
      task,
      outputChunks: [],
      outputSizeBytes: 0,
      status: 'running',
      options: entryOptions,
      startedAt: Date.now(),
      endedAt: null,
      foregroundRelease: detached ? undefined : createControlledPromise(),
      stop: createControlledPromise(),
      terminal: createControlledPromise(),
      abortController: new AbortController(),
      persistWriteQueue: Promise.resolve(),
      outputWriteQueue: Promise.resolve(),
      pendingOutput: [],
      pendingOutputBytes: 0,
      outputPersistStarted: detached,
    };
    this.tasks.set(taskId, entry);
    void runBackgroundTaskLifecycle(this, entry);

    if (this.isDetached(entry)) {
      void this.persistLive(entry);
      emitTaskStarted(this, this.toInfo(entry));
    }

    return taskId;
  }

  getTask(taskId: string): BackgroundTaskInfo | undefined {
    const entry = this.tasks.get(taskId);
    if (entry !== undefined) {
      return this.toInfo(entry);
    }
    return this.ghosts.get(taskId);
  }

  list(activeOnly = true, limit?: number): BackgroundTaskInfo[] {
    const result: BackgroundTaskInfo[] = [];
    for (const entry of this.tasks.values()) {
      const info = this.toInfo(entry);
      if (!shouldListTask(info, activeOnly)) continue;
      result.push(info);
      if (limit !== undefined && result.length >= limit) return result;
    }
    if (!activeOnly) {
      for (const ghost of this.ghosts.values()) {
        if (!shouldListTask(ghost, activeOnly)) continue;
        result.push(ghost);
        if (limit !== undefined && result.length >= limit) return result;
      }
    }
    return result;
  }

  getOutputSnapshot(taskId: string, maxPreviewBytes: number): Promise<BackgroundTaskOutputSnapshot> {
    return getBackgroundTaskOutputSnapshot(this, taskId, maxPreviewBytes);
  }

  readOutput(taskId: string, tail?: number): Promise<string> {
    return readBackgroundTaskOutput(this, taskId, tail);
  }


  detach(taskId: string): BackgroundTaskInfo | undefined {
    const entry = this.tasks.get(taskId);
    if (entry === undefined) return this.ghosts.get(taskId);
    if (TERMINAL_STATUSES.has(entry.status)) return this.toInfo(entry);
    const foregroundRelease = entry.foregroundRelease;
    if (foregroundRelease === undefined) return this.toInfo(entry);

    entry.foregroundRelease = undefined;
    if (entry.options.detachTimeoutMs !== undefined) {
      entry.timeoutHandle?.reset(entry.options.detachTimeoutMs);
    }
    try {
      entry.task.onDetach?.();
    } catch {
      /* detach has already succeeded; hooks must not make RPC fail */
    }
    startBackgroundTaskOutputPersist(this, entry);
    void this.persistLive(entry);
    emitTaskStarted(this, this.toInfo(entry));
    foregroundRelease.resolve('detached');
    return this.toInfo(entry);
  }

  persistOutput(taskId: string): void {
    persistBackgroundTaskOutput(this, taskId);
  }

  async stop(taskId: string, reason?: string): Promise<BackgroundTaskInfo | undefined> {
    const entry = this.tasks.get(taskId);
    if (!entry) return undefined;
    const trimmedReason = reason?.trim();
    const stopReason =
      trimmedReason === undefined || trimmedReason.length === 0 ? undefined : trimmedReason;
    if (TERMINAL_STATUSES.has(entry.status)) {
      if (entry.task.resourcesSettled === false) {
        await entry.task.forceStop?.();
        if (entry.task.resourcesSettled === false) throw new Error(`Task resources have not settled: ${taskId}`);
        entry.endedAt = Date.now();
        await this.persistLive(entry);
        fireTerminalEffects(this, entry);
      }
      await entry.persistWriteQueue;
      return this.toInfo(entry);
    }

    entry.stopReason = stopReason;
    entry.abortController.abort(stopReason);
    entry.stop.resolve({ reason: stopReason });
    await entry.terminal;
    if (entry.task.resourcesSettled === false) throw new Error(`Task resources have not settled: ${taskId}`);
    return this.toInfo(entry);
  }

  async stopAll(reason?: string): Promise<readonly BackgroundTaskInfo[]> {
    const taskIds = Array.from(this.tasks.keys());
    const settled = await Promise.allSettled(taskIds.map((taskId) => this.stop(taskId, reason)));
    const errors = settled.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, 'Background stop failed.');
    const results = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    return results.filter((info): info is BackgroundTaskInfo => info !== undefined);
  }

  waitForActiveTasks(
    predicate: (info: BackgroundTaskInfo) => boolean,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<void> {
    return waitForActiveBackgroundTasks(this, predicate, options);
  }

  wait(taskId: string, timeoutMs = 30_000): Promise<BackgroundTaskInfo | undefined> {
    return waitForBackgroundTask(this, taskId, timeoutMs);
  }

  waitAll(taskIds: readonly string[], timeoutMs = 30_000): Promise<readonly (BackgroundTaskInfo | undefined)[]> {
    return waitForAllBackgroundTasks(this, taskIds, timeoutMs);
  }

  waitAny(taskIds: readonly string[], timeoutMs = 30_000): Promise<BackgroundTaskInfo | undefined> {
    return waitForAnyBackgroundTask(this, taskIds, timeoutMs);
  }

  waitForForegroundRelease(taskId: string): Promise<ForegroundTaskReleaseReason | undefined> {
    return waitForForegroundBackgroundTaskRelease(this, taskId);
  }

  loadFromDisk(): Promise<void> {
    return loadBackgroundTasksFromDisk(this);
  }

  reconcile(): Promise<void> {
    return reconcileBackgroundTasks(this);
  }


  isDetached(entry: ManagedTask): boolean {
    return isDetached(entry);
  }

  persistLive(entry: ManagedTask): Promise<void> {
    return persistLiveBackgroundTask(this, entry);
  }

  appendOutput(entry: ManagedTask, chunk: string): void {
    appendBackgroundTaskOutput(this, entry, chunk);
  }

  startOutputPersist(entry: ManagedTask): void {
    startBackgroundTaskOutputPersist(this, entry);
  }

  toInfo(entry: ManagedTask): BackgroundTaskInfo {
    return toManagedTaskInfo(entry);
  }
}

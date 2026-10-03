/** Process-local native Job host bindings and admitted worker lifecycles. */

import type { SessionSubagentHost } from '../../../session/subagent/subagent-host';
import { registerSessionWorktreeOwnershipGuard, sessionWorktreeContainsPath } from '../../../session/worktree';
import type { ToolStore } from '../../store';
import { abortJobNativeOperations, hasJobNativeResources, jobResourceErrors, retainJobNativeCleanup, settleJobNativeResources } from './job-native-resources';
import { unbindJobWorkerLedger } from './job-worker-ledger-bridge';

export type JobWorkerHost = Pick<SessionSubagentHost, 'spawn' | 'resume' | 'steerChild' | 'stopAndJoin'>;

const workerHosts = new WeakMap<ToolStore, JobWorkerHost>();

/** Session owns the host; Job execution receives it through its runtime context. */
export function bindJobWorkerHost(store: ToolStore, host: JobWorkerHost): void {
  workerHosts.set(store, host);
}

export function getJobWorkerHost(store: ToolStore): JobWorkerHost | undefined {
  return workerHosts.get(store);
}

export function clearJobWorkerHost(store: ToolStore): void {
  workerHosts.delete(store);
}

export interface JobWorkerHandle {
  readonly store: ToolStore;
  readonly jobId: string;
  readonly controller: AbortController;
  readonly worktreePaths: readonly string[];
  workerAgentId?: string;
  resourcesSettled?: () => boolean | undefined;
  stopAndJoin?: () => Promise<unknown>;
  failure?: unknown;
  readonly settled: Promise<void>;
  readonly resolveSettled: () => void;
  readonly executionSettled: Promise<void>;
  readonly resolveExecutionSettled: () => void;
  executionFinished: boolean;
  stoppingStatus?: 'cancelled' | 'interrupted';
}

const handles = new Map<string, JobWorkerHandle>();

registerSessionWorktreeOwnershipGuard((path) => {
  for (const handle of handles.values()) {
    if (handle.worktreePaths.some((held) => sessionWorktreeContainsPath(path, held))) return true;
  }
  return false;
});

export function registerJobWorkerHandle(
  store: ToolStore,
  jobId: string,
  controller: AbortController,
  worktreePaths: readonly string[] = [],
): JobWorkerHandle {
  if (handles.has(jobId)) throw new Error(`Job worker is still active: ${jobId}`);
  const { promise: settled, resolve: resolveSettled } = Promise.withResolvers<void>();
  const { promise: executionSettled, resolve: resolveExecutionSettled } = Promise.withResolvers<void>();
  const handle: JobWorkerHandle = {
    store, jobId, controller, worktreePaths, settled, resolveSettled,
    executionSettled, resolveExecutionSettled, executionFinished: false,
  };
  handles.set(jobId, handle);
  return handle;
}

export function setJobWorkerAgentId(jobId: string, workerAgentId: string): void {
  const handle = handles.get(jobId);
  if (handle) handle.workerAgentId = workerAgentId;
}

export function getJobWorkerHandle(jobId: string): JobWorkerHandle | undefined {
  return handles.get(jobId);
}

/** Release only after execution and every retained physical owner settled. */
export function clearJobWorkerHandle(jobId: string): void {
  const handle = handles.get(jobId);
  if (!handle) return;
  handle.executionFinished = true;
  handle.resolveExecutionSettled();
  if (hasJobNativeResources(handle.store, jobId) ||
      (handle.resourcesSettled && handle.resourcesSettled() !== true)) return;
  handles.delete(jobId);
  if (handle.workerAgentId !== undefined) unbindJobWorkerLedger(handle.workerAgentId);
  handle.resolveSettled();
}

/** Join the existing worker/process cleanup, including failed completion owners. */
export async function joinJobWorkerHandle(jobId: string): Promise<void> {
  const handle = handles.get(jobId);
  if (!handle) return;
  let stopFailure: unknown;
  if (handle.workerAgentId !== undefined && handle.stopAndJoin) {
    try { await handle.stopAndJoin(); }
    catch (error) { stopFailure = error; retainJobNativeCleanup(handle.store, jobId, error); }
  }
  await handle.executionSettled;
  if (handle.resourcesSettled && handle.resourcesSettled() !== true) {
    const original = handle.failure ?? stopFailure;
    const detail = original instanceof Error ? original.message : String(original ?? jobId);
    const failure = new AggregateError([original, stopFailure].filter((error) => error !== undefined),
      `Job worker cleanup failed: ${detail}`);
    Object.defineProperty(failure, 'resourcesSettled', { get: () => handle.resourcesSettled?.() === true });
    retainJobNativeCleanup(handle.store, jobId, failure);
    throw failure;
  }
  await settleJobNativeResources(handle.store, jobId);
  clearJobWorkerHandle(jobId);
  await handle.settled;
  if (stopFailure !== undefined) throw stopFailure instanceof Error ? stopFailure : new Error(String(stopFailure), { cause: stopFailure });
}

/** Stop all actual workers owned by this store before reporting scheduling failures. */
export async function stopAndJoinJobWorkers(store: ToolStore, reason: unknown): Promise<void> {
  const owned = [...handles.values()].filter((handle) => handle.store === store);
  abortJobNativeOperations(store, undefined, reason);
  for (const handle of owned) abortJobWorker(handle.jobId, reason);
  const results = await Promise.allSettled(owned.map((handle) => joinJobWorkerHandle(handle.jobId)));
  const errors: unknown[] = [];
  for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
  if (errors.length > 0) throw jobResourceErrors(errors, 'Job worker drain failed');
}

/** Aborting requests a stop; it is never evidence of physical release. */
export function abortJobWorker(jobId: string, reason: unknown = new Error('job cancelled')): boolean {
  const handle = handles.get(jobId);
  if (handle === undefined) return false;
  abortJobNativeOperations(handle.store, jobId, reason);
  if (!handle.controller.signal.aborted) handle.controller.abort(reason);
  return true;
}

export function __resetJobWorkerHandlesForTests(): void {
  for (const handle of handles.values()) { handle.resolveExecutionSettled(); handle.resolveSettled(); }
  handles.clear();
}

export function __jobWorkerHandleCountForTests(): number {
  return handles.size;
}

import type { ToolStore } from '../../store';
import { registerSessionWorktreeOwnershipGuard, sessionWorktreeContainsPath, sessionWorktreePathsEqual } from '../../../session/worktree';
import { hasUnsettledExecutionResources } from '../../../session/job/git';

interface CleanupResource {
  readonly resourcesSettled: boolean;
  settleResources?: () => Promise<void>;
}

interface NativeJobResources {
  readonly store: ToolStore;
  readonly controller: AbortController;
  readonly jobId: string;
  readonly paths: Set<string>;
  readonly repoRoots: Set<string>;
  readonly operations: Set<Promise<unknown>>;
  readonly failures: Set<unknown>;
}

const stores = new WeakMap<ToolStore, Map<string, NativeJobResources>>();
const owned = new Set<NativeJobResources>();

function cleanupResources(error: unknown, seen = new Set<unknown>()): CleanupResource[] {
  if (error === null || typeof error !== 'object' || seen.has(error)) return [];
  seen.add(error);
  const resource = error as CleanupResource & { cause?: unknown; errors?: unknown[] };
  const nested = [resource.cause, ...(Array.isArray(resource.errors) ? resource.errors : [])];
  const result = nested.flatMap((cause) => cleanupResources(cause, seen));
  if (typeof resource.resourcesSettled === 'boolean' &&
      (typeof resource.settleResources === 'function' || result.length === 0)) result.push(resource);
  return result;
}


export function jobResourceErrors(errors: readonly unknown[], message: string): AggregateError {
  const error = new AggregateError(errors, message);
  Object.defineProperty(error, 'resourcesSettled', {
    get: () => !errors.some(hasUnsettledExecutionResources),
  });
  return error;
}

function scope(store: ToolStore, jobId: string): NativeJobResources {
  let jobs = stores.get(store);
  if (!jobs) { jobs = new Map(); stores.set(store, jobs); }
  let resources = jobs.get(jobId);
  if (!resources) {
    resources = { store, jobId, controller: new AbortController(), paths: new Set(), repoRoots: new Set(), operations: new Set(), failures: new Set() };
    jobs.set(jobId, resources);
  }
  owned.add(resources);
  return resources;
}

function release(resources: NativeJobResources): void {
  for (const failure of resources.failures) {
    if (!hasUnsettledExecutionResources(failure)) resources.failures.delete(failure);
  }
  if (resources.operations.size === 0 && resources.failures.size === 0) {
    owned.delete(resources);
    const jobs = stores.get(resources.store);
    if (jobs?.get(resources.jobId) === resources) jobs.delete(resources.jobId);
  }
}

registerSessionWorktreeOwnershipGuard((path, repoRoot) => {
  for (const resources of owned) {
    let held = resources.operations.size > 0;
    if (!held) for (const failure of resources.failures) if (hasUnsettledExecutionResources(failure)) { held = true; break; }
    if (!held) continue;
    for (const heldPath of resources.paths) if (sessionWorktreeContainsPath(path, heldPath)) return true;
    for (const root of resources.repoRoots) if (sessionWorktreePathsEqual(root, repoRoot)) return true;
  }
  return false;
});

export function retainJobNativeCleanup(store: ToolStore, jobId: string, error: unknown): void {
  if (hasUnsettledExecutionResources(error)) scope(store, jobId).failures.add(error);
}

export function abortJobNativeOperations(store: ToolStore, jobId?: string, reason: unknown = new Error('Job stopped')): void {
  for (const resources of stores.get(store)?.values() ?? []) {
    if (jobId === undefined || resources.jobId === jobId) resources.controller.abort(reason);
  }
}

export function getJobNativeFailure(store: ToolStore, jobId: string): unknown {
  return stores.get(store)?.get(jobId)?.failures.values().next().value;
}

/** Own preparation/execution until its native operation, not its abort signal, settles. */
export function runJobNativeOperation<T>(
  store: ToolStore,
  jobId: string,
  input: { readonly paths?: readonly (string | undefined)[]; readonly repoRoots?: readonly (string | undefined)[] },
  run: (holdPath: (path: string) => void, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const resources = scope(store, jobId);
  for (const path of input.paths ?? []) if (path) resources.paths.add(path);
  for (const root of input.repoRoots ?? []) if (root) resources.repoRoots.add(root);
  const operation = Promise.resolve().then(() => {
    resources.controller.signal.throwIfAborted();
    return run((path) => resources.paths.add(path), resources.controller.signal);
  });
  resources.operations.add(operation);
  void operation.then(() => {
    resources.operations.delete(operation);
    release(resources);
  }, (error: unknown) => {
    retainJobNativeCleanup(store, jobId, error);
    resources.operations.delete(operation);
    release(resources);
  });
  return operation;
}
/** Own a queued native admission until it runs or is explicitly discarded. */
export function holdJobNativeAdmission(
  store: ToolStore, jobId: string, paths: readonly (string | undefined)[],
): () => void {
  const resources = scope(store, jobId);
  for (const path of paths) if (path) resources.paths.add(path);
  const pending = Promise.withResolvers<void>();
  resources.operations.add(pending.promise);
  return () => {
    resources.operations.delete(pending.promise);
    pending.resolve();
    release(resources);
  };
}

export function hasJobNativeResources(store: ToolStore, jobId: string): boolean {
  const resources = stores.get(store)?.get(jobId);
  if (!resources) return false;
  if (resources.operations.size > 0) return true;
  for (const failure of resources.failures) if (hasUnsettledExecutionResources(failure)) return true;
  return false;
}

export function listJobNativeResourceIds(store: ToolStore): readonly string[] {
  return [...(stores.get(store)?.keys() ?? [])];
}

/** Join every admitted operation before reporting any execution failure. */
async function waitForJobNativeOperations(store: ToolStore, jobId?: string): Promise<void> {
  const errors: unknown[] = [];
  for (;;) {
    const jobs = stores.get(store);
    const owners = [...(jobs?.values() ?? [])]
      .filter((resources) => jobId === undefined || resources.jobId === jobId);
    const operations = owners.flatMap((resources) => [...resources.operations]);
    if (operations.length === 0) break;
    for (const result of await Promise.allSettled(operations)) {
      if (result.status === 'rejected' &&
          (hasUnsettledExecutionResources(result.reason) ||
           !owners.some((owner) => owner.controller.signal.aborted && owner.controller.signal.reason === result.reason))) {
        errors.push(result.reason);
      }
    }
  }
  if (errors.length > 0) throw jobResourceErrors(errors, 'Native Job execution failed');
}

/** Explicit cleanup only: settle existing processes, never replay their commands. */
export async function settleJobNativeResources(store: ToolStore, jobId?: string): Promise<void> {
  const errors: unknown[] = [];
  try { await waitForJobNativeOperations(store, jobId); } catch (error) { errors.push(error); }
  for (const resources of stores.get(store)?.values() ?? []) {
    if (jobId !== undefined && resources.jobId !== jobId) continue;
    for (const failure of resources.failures) {
      for (const resource of cleanupResources(failure)) {
        if (resource.resourcesSettled !== false) continue;
        try { await resource.settleResources?.(); } catch (error) { errors.push(error); }
      }
      if (hasUnsettledExecutionResources(failure)) errors.push(failure);
    }
    release(resources);
  }
  if (errors.length > 0) throw jobResourceErrors(errors, 'Native Job resources failed to settle');
}

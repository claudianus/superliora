import type { Kaos } from '@superliora/kaos';

import type { WorkspaceConfig } from '../../tools/support/workspace';
import { buildWorkspaceIndex, getIndexStatus } from './builder';

export interface EnsureWorkspaceIndexResult {
  readonly built: boolean;
  readonly ready: boolean;
  /**
   * True when the build did not finish within the requested budget. The build
   * keeps running in the background (deduped via `inFlight`), so a later call
   * will see it ready. Callers should fall back to direct discovery in the
   * meantime instead of blocking the agent.
   */
  readonly timedOut?: boolean | undefined;
}

const BUILD_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_BUILD_BUDGET_MS = 15_000;

const inFlight = new Map<string, Promise<void>>();
const buildFailureUntil = new Map<string, number>();

function workspaceKey(workspace: WorkspaceConfig): string {
  return workspace.workspaceDir;
}

function isBuildCoolingDown(key: string, now = Date.now()): boolean {
  const until = buildFailureUntil.get(key);
  return until !== undefined && now < until;
}

function recordBuildFailure(key: string, now = Date.now()): void {
  buildFailureUntil.set(key, now + BUILD_FAILURE_COOLDOWN_MS);
}

function clearBuildFailure(key: string): void {
  buildFailureUntil.delete(key);
}

export function resetBuildFailureCooldownForTests(): void {
  buildFailureUntil.clear();
}

/**
 * Best-effort background build. Auto/warm builds always run incrementally: a
 * destructive `full` rebuild is only valid from an explicit `LioraIndex
 * action=build full=true`. Running `full` from ensure deletes rows first,
 * which — combined with the swallowed error at the call site — left an empty
 * committed index that forced every subsequent call into another full
 * rebuild. Incremental inserts missing rows without deleting the existing
 * ones, so an interrupted build can never shrink the index.
 */
async function runIncrementalBuild(kaos: Kaos, workspace: WorkspaceConfig): Promise<void> {
  const current = await getIndexStatus(kaos, workspace);
  if (current.ready && !current.stale) return;
  await buildWorkspaceIndex({ kaos, workspace, incremental: true });
}

export async function ensureWorkspaceIndex(
  kaos: Kaos,
  workspace: WorkspaceConfig,
): Promise<EnsureWorkspaceIndexResult> {
  const key = workspaceKey(workspace);
  const initial = await getIndexStatus(kaos, workspace);
  if (initial.ready && !initial.stale) {
    clearBuildFailure(key);
    return { built: false, ready: true };
  }

  if (isBuildCoolingDown(key)) {
    return { built: false, ready: initial.ready };
  }

  let pending = inFlight.get(key);
  if (pending === undefined) {
    pending = (async () => {
      try {
        await runIncrementalBuild(kaos, workspace);
      } catch {
        recordBuildFailure(key);
        // Best-effort: callers fall back to direct workspace scans when indexing is unavailable.
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
  }
  await pending;

  const finalStatus = await getIndexStatus(kaos, workspace);
  if (finalStatus.ready && !finalStatus.stale) {
    clearBuildFailure(key);
    return { built: true, ready: true };
  }

  if (!finalStatus.ready) {
    recordBuildFailure(key);
  }
  return { built: true, ready: finalStatus.ready };
}

/**
 * Same as {@link ensureWorkspaceIndex}, but gives up waiting after `budgetMs`
 * and returns `{ timedOut: true }`. The underlying build is not cancelled —
 * it keeps running (deduped via `inFlight`) and will be ready for the next
 * call. This keeps compose/search from blocking the agent on a long build.
 */
export async function ensureWorkspaceIndexBudgeted(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  budgetMs: number = DEFAULT_BUILD_BUDGET_MS,
): Promise<EnsureWorkspaceIndexResult> {
  const key = workspaceKey(workspace);
  const initial = await getIndexStatus(kaos, workspace);
  if (initial.ready && !initial.stale) {
    clearBuildFailure(key);
    return { built: false, ready: true };
  }

  if (isBuildCoolingDown(key)) {
    return { built: false, ready: initial.ready };
  }

  let pending = inFlight.get(key);
  if (pending === undefined) {
    pending = (async () => {
      try {
        await runIncrementalBuild(kaos, workspace);
      } catch {
        recordBuildFailure(key);
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
  }

  let timedOut = false;
  try {
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, budgetMs);
      }),
    ]);
  } catch {
    // pending is best-effort and swallows its own errors; reaching here is unexpected.
  }

  if (timedOut) {
    return { built: false, ready: initial.ready, timedOut: true };
  }

  const finalStatus = await getIndexStatus(kaos, workspace);
  if (finalStatus.ready && !finalStatus.stale) {
    clearBuildFailure(key);
    return { built: true, ready: true };
  }

  if (!finalStatus.ready) {
    recordBuildFailure(key);
  }
  return { built: true, ready: finalStatus.ready };
}

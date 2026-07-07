import type { Kaos } from '@superliora/kaos';

import type { WorkspaceConfig } from '../../tools/support/workspace';
import { buildWorkspaceIndex, getIndexStatus } from './builder';

export interface EnsureWorkspaceIndexResult {
  readonly built: boolean;
  readonly ready: boolean;
}

const BUILD_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

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
        const current = await getIndexStatus(kaos, workspace);
        if (current.ready && !current.stale) return;
        await buildWorkspaceIndex({
          kaos,
          workspace,
          incremental: current.ready,
        });
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

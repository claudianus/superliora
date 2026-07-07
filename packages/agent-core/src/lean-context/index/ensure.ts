import type { Kaos } from '@superliora/kaos';

import type { WorkspaceConfig } from '../../tools/support/workspace';
import { buildWorkspaceIndex, getIndexStatus } from './builder';

export interface EnsureWorkspaceIndexResult {
  readonly built: boolean;
  readonly ready: boolean;
}

const inFlight = new Map<string, Promise<void>>();

export async function ensureWorkspaceIndex(
  kaos: Kaos,
  workspace: WorkspaceConfig,
): Promise<EnsureWorkspaceIndexResult> {
  const initial = await getIndexStatus(kaos, workspace);
  if (initial.ready && !initial.stale) {
    return { built: false, ready: true };
  }

  const key = workspace.workspaceDir;
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
        // Best-effort: callers fall back to direct workspace scans when indexing is unavailable.
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, pending);
  }
  await pending;

  const finalStatus = await getIndexStatus(kaos, workspace);
  return { built: true, ready: finalStatus.ready };
}

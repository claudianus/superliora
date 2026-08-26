/**
 * Bind a main-agent tool store to the workspace session catalog.
 * Ledger writes upsert the repo catalog so a new TUI chat can see yesterday's jobs.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'pathe';

import { resolveLioraHome } from '../../../config/path';
import type { ToolStore } from '../../store';
import { readJobLedger } from './job-ledger';
import { upsertWorkspaceCatalogJobs } from './job-workspace-catalog';

interface WorkspaceCatalogBinding {
  readonly homeDir: string;
  readonly workDir: string;
  readonly sourceAgentDir?: string;
  timer?: ReturnType<typeof setTimeout>;
}

const bindings = new WeakMap<ToolStore, WorkspaceCatalogBinding>();

const DEBOUNCE_MS = 80;

export function bindWorkspaceSessionCatalog(
  store: ToolStore,
  input: {
    readonly workDir?: string;
    readonly sourceAgentDir?: string;
    readonly homeDir?: string;
  },
): void {
  const workDir = input.workDir?.trim();
  if (workDir === undefined || workDir.length === 0) return;
  bindings.set(store, {
    homeDir: input.homeDir ?? resolveLioraHome(),
    workDir,
    sourceAgentDir: input.sourceAgentDir?.trim() || undefined,
  });
}

export function unbindWorkspaceSessionCatalog(store: ToolStore): void {
  const binding = bindings.get(store);
  if (binding?.timer !== undefined) clearTimeout(binding.timer);
  bindings.delete(store);
}

export function scheduleWorkspaceCatalogSync(store: ToolStore): void {
  const binding = bindings.get(store);
  if (binding === undefined) return;
  if (binding.timer !== undefined) clearTimeout(binding.timer);
  binding.timer = setTimeout(() => {
    binding.timer = undefined;
    flushWorkspaceCatalogSync(store);
  }, DEBOUNCE_MS);
  binding.timer.unref?.();
}

function flushWorkspaceCatalogSync(store: ToolStore): void {
  const binding = bindings.get(store);
  if (binding === undefined) return;
  try {
    upsertWorkspaceCatalogJobs({
      workDir: binding.workDir,
      homeDir: binding.homeDir,
      sourceAgentDir: binding.sourceAgentDir,
      jobs: readJobLedger(store).jobs,
    });
  } catch {
    // Catalog is best-effort — never break the ledger write.
  }
}

export function siblingWorkerHomedir(
  sourceAgentDir: string,
  workerId: string,
): string {
  return join(dirname(sourceAgentDir), workerId);
}

interface ImportWorkerHomedirResult {
  readonly ok: boolean;
  readonly dest: string;
  readonly copied: boolean;
  readonly error?: string;
}

/**
 * Copy a worker agent dir into another TUI session so `host.resume` can
 * reattach the transcript instead of cold-spawning.
 */
export function importWorkerHomedir(input: {
  readonly sessionHomedir: string;
  readonly workerId: string;
  readonly sourceHomedir: string;
}): ImportWorkerHomedirResult {
  const dest = join(input.sessionHomedir, 'agents', input.workerId);
  if (existsSync(dest)) return { ok: true, dest, copied: false };
  if (!existsSync(input.sourceHomedir)) {
    return { ok: false, dest, copied: false, error: 'source worker homedir missing' };
  }
  try {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(input.sourceHomedir, dest, { recursive: true });
    return { ok: true, dest, copied: true };
  } catch (error) {
    return {
      ok: false,
      dest,
      copied: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

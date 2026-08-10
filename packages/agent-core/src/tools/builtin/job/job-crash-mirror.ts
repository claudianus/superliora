/**
 * Durable job-ledger crash mirror.
 *
 * Wire `tools.update_store` appends are async-buffered; a hard kill can lose
 * the last ledger patch. This mirror writes `<agentHomedir>/job-ledger.crash.json`
 * (debounced) and can fsync synchronously on emergency flush paths so resume
 * can merge a fresher ledger than the wire replay.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Agent } from '../../../agent/index';
import type { ToolStore } from '../../store';
import { readJobLedger, writeJobLedger } from './job-ledger';
import { emptyJobLedger, type JobLedger, type JobRecord } from './job-store-key';

export const JOB_LEDGER_CRASH_MIRROR_FILE = 'job-ledger.crash.json';
const MIRROR_VERSION = 1 as const;
const MIRROR_DEBOUNCE_MS = 100;

interface CrashMirrorFile {
  readonly version: typeof MIRROR_VERSION;
  readonly updatedAt: string;
  readonly ledger: JobLedger;
}

interface MirrorBinding {
  readonly agentDir: string;
  timer?: ReturnType<typeof setTimeout>;
  pending?: JobLedger;
}

const bindings = new WeakMap<ToolStore, MirrorBinding>();
const boundStores = new Set<ToolStore>();

export function jobLedgerCrashMirrorPath(agentDir: string): string {
  return join(agentDir.replace(/\/+$/, ''), JOB_LEDGER_CRASH_MIRROR_FILE);
}

/** Bind a main-agent tool store to a durable crash mirror under `agentDir`. */
export function bindJobLedgerCrashMirror(store: ToolStore, agentDir: string): void {
  const trimmed = agentDir.trim();
  if (trimmed.length === 0) return;
  bindings.set(store, { agentDir: trimmed.replace(/\/+$/, '') });
  boundStores.add(store);
}

export function unbindJobLedgerCrashMirror(store: ToolStore): void {
  const binding = bindings.get(store);
  if (binding?.timer !== undefined) clearTimeout(binding.timer);
  bindings.delete(store);
  boundStores.delete(store);
}

/** Schedule a debounced async mirror write after a ledger mutation. */
export function scheduleJobLedgerCrashMirror(store: ToolStore): void {
  const binding = bindings.get(store);
  if (binding === undefined) return;
  binding.pending = readJobLedger(store);
  if (binding.timer !== undefined) clearTimeout(binding.timer);
  binding.timer = setTimeout(() => {
    binding.timer = undefined;
    const ledger = binding.pending;
    binding.pending = undefined;
    if (ledger === undefined) return;
    try {
      writeCrashMirrorFile(binding.agentDir, ledger);
    } catch {
      // Best-effort — never break the tool-store write path.
    }
  }, MIRROR_DEBOUNCE_MS);
  binding.timer.unref?.();
}

/** Synchronous fsync-style write for signal / uncaughtExceptionMonitor paths. */
export function flushJobLedgerCrashMirrorSync(store?: ToolStore): void {
  const targets = store !== undefined ? [store] : [...boundStores];
  for (const target of targets) {
    const binding = bindings.get(target);
    if (binding === undefined) continue;
    if (binding.timer !== undefined) {
      clearTimeout(binding.timer);
      binding.timer = undefined;
    }
    const ledger = binding.pending ?? readJobLedger(target);
    binding.pending = undefined;
    try {
      writeCrashMirrorFile(binding.agentDir, ledger);
    } catch {
      // Crash path must not throw.
    }
  }
}

export function flushAgentJobLedgerCrashMirrorSync(agent: Agent): void {
  if (agent.type !== 'main' || agent.homedir === undefined) return;
  try {
    bindJobLedgerCrashMirror(agent.tools.getStore(), agent.homedir);
    flushJobLedgerCrashMirrorSync(agent.tools.getStore());
  } catch {
    // Crash path must not throw.
  }
}

/**
 * After wire replay, merge a fresher crash mirror into the store.
 * Per-job: take the side with the newer `updatedAt` (ISO lexical order).
 */
export function mergeCrashMirrorIntoStore(store: ToolStore, agentDir?: string): boolean {
  const dir = agentDir?.trim() || bindings.get(store)?.agentDir;
  if (dir === undefined || dir.length === 0) return false;
  const mirror = readCrashMirrorFile(dir);
  if (mirror === undefined) return false;

  const wire = readJobLedger(store);
  const byId = new Map<string, JobRecord>();
  for (const job of wire.jobs) byId.set(job.id, job);

  let changed = false;
  for (const mirrored of mirror.ledger.jobs) {
    const existing = byId.get(mirrored.id);
    if (existing === undefined || mirrored.updatedAt > existing.updatedAt) {
      byId.set(mirrored.id, mirrored);
      changed = true;
    }
  }

  if (!changed) return false;
  writeJobLedger(store, {
    schemaVersion: 1,
    jobs: [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  });
  // Avoid re-writing the same mirror from this merge.
  return true;
}

export function readCrashMirrorFile(agentDir: string): CrashMirrorFile | undefined {
  try {
    const raw = readFileSync(jobLedgerCrashMirrorPath(agentDir), 'utf8');
    const parsed = JSON.parse(raw) as CrashMirrorFile;
    if (parsed?.version !== MIRROR_VERSION || parsed.ledger?.schemaVersion !== 1) {
      return undefined;
    }
    if (!Array.isArray(parsed.ledger.jobs)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeCrashMirrorFile(agentDir: string, ledger: JobLedger): void {
  const path = jobLedgerCrashMirrorPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  const payload: CrashMirrorFile = {
    version: MIRROR_VERSION,
    updatedAt: new Date().toISOString(),
    ledger: {
      schemaVersion: 1,
      jobs: ledger.jobs.map((j) => ({ ...j })),
    },
  };
  writeFileSync(path, `${JSON.stringify(payload)}\n`, { encoding: 'utf8' });
}

/** Test helper — empty ledger shape. */
export function emptyCrashMirrorLedger(): JobLedger {
  return emptyJobLedger();
}

/** Test helper — force an immediate mirror write of the current store. */
export function flushJobLedgerCrashMirrorNow(store: ToolStore): void {
  const binding = bindings.get(store);
  if (binding === undefined) return;
  if (binding.timer !== undefined) {
    clearTimeout(binding.timer);
    binding.timer = undefined;
  }
  binding.pending = undefined;
  writeCrashMirrorFile(binding.agentDir, readJobLedger(store));
}

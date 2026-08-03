/**
 * Fleet / SpawnWorker → Conductor Job bridge.
 * Prefer JobCreate for new work; SpawnWorker remains as a compat shim that
 * registers a Job ledger entry when a ToolStore is available.
 */

import type { ToolStore } from '../../store';
import { createJob, type JobRecord } from './job-ledger';

export interface SpawnWorkerBridgeInput {
  readonly title?: string;
  readonly prompt: string;
  readonly profileName?: string;
  readonly ownershipPaths?: readonly string[];
}

/**
 * Register a SpawnWorker-style task as a Conductor Job (kind implement/task).
 * Does not launch the worker by itself — caller may still spawn or schedule.
 */
export function registerSpawnWorkerAsJob(
  store: ToolStore,
  input: SpawnWorkerBridgeInput,
): JobRecord {
  const title =
    input.title?.trim() ||
    input.prompt.replace(/\s+/g, ' ').trim().slice(0, 72) ||
    'Fleet worker';
  return createJob(store, {
    title,
    kind: input.profileName === 'explore' ? 'explore' : 'implement',
    priority: 1,
    prompt: input.prompt,
    ownershipPaths: input.ownershipPaths ? [...input.ownershipPaths] : undefined,
  });
}

export function fleetBridgeNotice(job: JobRecord): string {
  return [
    `Conductor bridge: registered ${job.id} [${job.status}] ${job.title}.`,
    'Prefer JobCreate for new work; SpawnWorker is a compat path under Fleet.',
  ].join(' ');
}

import type { Kaos } from '@superliora/kaos';

import type { Logger } from '#/logging/types';
import {
  createSessionWorktree,
  type CreateSessionWorktreeResult,
} from '../session/worktree';
import type { QueuedSubagentTask } from '../session/subagent/subagent-batch-types';

export const FLEET_WORKTREE_ENV = 'SUPERLIORA_FLEET_WORKTREE';

export const FLEET_WORKTREE_FALLBACK_TIP =
  'Fleet worktree: create failed — worker uses shared session workDir (set SUPERLIORA_FLEET_WORKTREE=0 to silence).';

export interface FleetWorktreeEnv {
  readonly [key: string]: string | undefined;
}

export interface FleetWorktreeDeps {
  readonly env?: FleetWorktreeEnv;
  readonly createWorktree?: (
    kaos: Kaos,
    input: { readonly repoPath: string; readonly name: string },
  ) => Promise<CreateSessionWorktreeResult>;
}

export function isFleetWorktreeEnvEnabled(
  env: FleetWorktreeEnv = process.env,
): boolean {
  const normalized = env[FLEET_WORKTREE_ENV]?.trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

export interface ResolveFleetWorkerWorktreeInput {
  readonly kaos: Kaos;
  readonly repoPath: string;
  readonly workerKey: string;
  readonly log?: Logger;
}

export interface ResolveFleetWorkerWorktreeResult {
  readonly worktreeDir?: string;
  readonly fallbackTip?: string;
}

/** Attempt a per-worker git worktree when fleet env opt-in is enabled. */
export async function resolveFleetWorkerWorktreeDir(
  input: ResolveFleetWorkerWorktreeInput,
  deps: FleetWorktreeDeps = {},
): Promise<ResolveFleetWorkerWorktreeResult> {
  const env = deps.env ?? process.env;
  if (!isFleetWorktreeEnvEnabled(env)) {
    return {};
  }

  const createWorktree = deps.createWorktree ?? createSessionWorktree;
  try {
    const worktree = await createWorktree(input.kaos, {
      repoPath: input.repoPath,
      name: input.workerKey,
    });
    return { worktreeDir: worktree.workDir };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    input.log?.warn('Fleet worktree create failed; falling back to shared workDir', {
      workerKey: input.workerKey,
      repoPath: input.repoPath,
      error: detail,
    });
    return {
      fallbackTip: `${FLEET_WORKTREE_FALLBACK_TIP} (${input.workerKey}: ${detail})`,
    };
  }
}

export interface ApplyFleetWorktreeToSpawnTasksInput {
  readonly kaos: Kaos;
  readonly repoPath: string;
  readonly parentToolCallId: string;
  readonly log?: Logger;
}

export interface ApplyFleetWorktreeToSpawnTasksResult<T> {
  readonly tasks: QueuedSubagentTask<T>[];
  readonly tips: readonly string[];
}

function fleetWorkerKey(parentToolCallId: string, task: QueuedSubagentTask): string {
  const index = task.swarmIndex ?? task.description;
  return `fleet-${parentToolCallId.slice(0, 8)}-${String(index)}`;
}

/** Enrich spawn (non-resume) queued tasks with optional per-worker worktreeDir. */
export async function applyFleetWorktreeToSpawnTasks<T>(
  tasks: readonly QueuedSubagentTask<T>[],
  input: ApplyFleetWorktreeToSpawnTasksInput,
  deps: FleetWorktreeDeps = {},
): Promise<ApplyFleetWorktreeToSpawnTasksResult<T>> {
  const env = deps.env ?? process.env;
  if (!isFleetWorktreeEnvEnabled(env)) {
    return { tasks: [...tasks], tips: [] };
  }

  const tips: string[] = [];
  const enriched: QueuedSubagentTask<T>[] = [];
  for (const task of tasks) {
    if (task.kind === 'resume') {
      enriched.push(task);
      continue;
    }

    const resolved = await resolveFleetWorkerWorktreeDir(
      {
        kaos: input.kaos,
        repoPath: input.repoPath,
        workerKey: fleetWorkerKey(input.parentToolCallId, task),
        log: input.log,
      },
      deps,
    );
    if (resolved.fallbackTip !== undefined) {
      tips.push(resolved.fallbackTip);
    }
    enriched.push(
      resolved.worktreeDir === undefined
        ? task
        : { ...task, worktreeDir: resolved.worktreeDir },
    );
  }

  return { tasks: enriched, tips: [...new Set(tips)] };
}

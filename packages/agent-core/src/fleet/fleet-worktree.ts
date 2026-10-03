import type { Kaos } from '@superliora/kaos';

import type { Logger } from '#/logging/types';
import {
  createSessionWorktree,
  type CreateSessionWorktreeResult,
} from '../session/worktree';
import { hasUnsettledExecutionResources } from '../session/job/git';

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
    input: {
      readonly repoPath: string;
      readonly name: string;
      readonly signal?: AbortSignal;
      readonly onWorktreePath?: (path: string) => void;
    },
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
  readonly signal?: AbortSignal;
  readonly onWorktreePath?: (path: string) => void;
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
    input.signal?.throwIfAborted();
    const worktree = await createWorktree(input.kaos, {
      repoPath: input.repoPath,
      name: input.workerKey,
      signal: input.signal,
      onWorktreePath: input.onWorktreePath,
    });
    return { worktreeDir: worktree.workDir };
  } catch (error) {
    if (input.signal?.aborted || hasUnsettledExecutionResources(error)) {
      throw error;
    }
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


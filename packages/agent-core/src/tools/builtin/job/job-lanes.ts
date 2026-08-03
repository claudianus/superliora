/**
 * Conductor interactive vs execution lane (product contract).
 *
 * Interactive lane: user ↔ meta (Conductor). Always accepts input; may do
 * trivial Q&A / 1–2 step edits in the main workspace.
 * Execution lane: Jobs run on workers in worktrees; completions → Job inbox.
 * Meta tools that touch the execution lane must ACK and return without
 * awaiting worker completion.
 */

import type { JobKind, JobStatus } from './job-store-key';

export type ConductorLane = 'interactive' | 'execution';

export interface LaneClassification {
  readonly lane: ConductorLane;
  readonly reason: string;
  /** When true, prefer JobCreate over inline meta work. */
  readonly shouldCreateJob: boolean;
}

/**
 * Heuristic for prompts/tools: when should work become an execution Job?
 * Not a hard gate — Conductor may still choose JobCreate explicitly.
 */
export function classifyConductorLane(input: {
  readonly text: string;
  readonly hasMultiIntent?: boolean;
  readonly kind?: JobKind;
}): LaneClassification {
  if (input.kind === 'mission' || input.kind === 'implement' || input.kind === 'merge') {
    return {
      lane: 'execution',
      reason: `kind=${input.kind}`,
      shouldCreateJob: true,
    };
  }
  if (input.hasMultiIntent === true) {
    return {
      lane: 'execution',
      reason: 'multi-intent burst',
      shouldCreateJob: true,
    };
  }
  const text = input.text.trim();
  if (text.length === 0) {
    return { lane: 'interactive', reason: 'empty', shouldCreateJob: false };
  }
  // Short Q&A / status — stay interactive.
  if (text.length < 40 && /\?$|^(what|why|how|who|where|when|status|help)\b/i.test(text)) {
    return { lane: 'interactive', reason: 'short Q&A', shouldCreateJob: false };
  }
  if (
    /\b(implement|refactor|fix|add tests?|write|build|migrate|ship|port)\b/i.test(text) ||
    /\b(구현|수정|추가|리팩터|테스트|마이그레이션)\b/.test(text)
  ) {
    return {
      lane: 'execution',
      reason: 'implementation-shaped request',
      shouldCreateJob: true,
    };
  }
  return {
    lane: 'interactive',
    reason: 'default meta handling',
    shouldCreateJob: false,
  };
}

/** Statuses that mean work is still on the execution lane. */
export function isExecutionInFlight(status: JobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'blocked' || status === 'needs_user';
}

/**
 * Meta ACK contract: JobCreate/JobSchedule must not block the interactive turn
 * on worker lifetime. launchWorker may start work but must not be awaited for completion.
 */
export function assertNonBlockingLaunchContract(launchIsFireAndForget: boolean): void {
  if (!launchIsFireAndForget) {
    throw new Error(
      'Conductor execution-lane launch must be fire-and-forget (do not await worker completion on the meta turn).',
    );
  }
}

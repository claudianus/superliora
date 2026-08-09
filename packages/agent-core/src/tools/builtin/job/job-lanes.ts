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
  if (
    input.kind === 'mission' ||
    input.kind === 'implement' ||
    input.kind === 'merge' ||
    input.kind === 'push' ||
    input.kind === 'goal-driver'
  ) {
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
 * Meta ACK contract — non-blocking launch (checklist V2-3, G4-1).
 *
 * JobCreate/JobSchedule must not block the interactive turn on worker
 * lifetime: launch may start work but must never await worker completion.
 *
 * The legacy helper took a caller-supplied boolean (`launchIsFireAndForget`)
 * and therefore proved nothing. The replacement observes the real worker
 * completion promise at runtime: a probe flips only when the promise
 * actually settles, and the assertion reads that observation. The contract
 * test injects a fake spawn (`spawnOne`) and passes if — and only if — the
 * completion is still pending when `launchJobWorker` returns.
 */

/** Runtime observer for a worker completion promise. */
export interface CompletionProbe {
  /** Flips to true only once the observed completion promise settles. */
  settled: boolean;
}

/**
 * Attach a runtime observer to a worker completion promise. The probe flips
 * when the promise settles (fulfilled or rejected) — never on caller claims.
 */
export function observeCompletion(completion: PromiseLike<unknown>): CompletionProbe {
  const probe: CompletionProbe = { settled: false };
  void Promise.resolve(completion).then(
    () => {
      probe.settled = true;
    },
    () => {
      probe.settled = true;
    },
  );
  return probe;
}

/**
 * Assert the observed launch contract: the worker completion must still be
 * pending when the launch call returns. Call after draining microtasks so a
 * completion that settled before/at return is visible to the probe.
 */
export function assertNonBlockingLaunch(probe: Readonly<CompletionProbe>): void {
  if (probe.settled) {
    throw new Error(
      'Conductor execution-lane launch blocked on worker completion: completion settled before launch returned (the meta turn must stay fire-and-forget).',
    );
  }
}

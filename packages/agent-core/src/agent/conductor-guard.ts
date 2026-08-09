/**
 * Conductor delegation-only runtime guard (meta-orchestrator v2 contract S0).
 *
 * Second defense line for invariant 1 ("delegation-only conductor") and
 * invariant 2 ("no synchronous waiting on workers") from
 * `docs/specs/2026-08-03-meta-orchestrator-v2-contract.md`:
 *
 * - Stage 1 (name-based, pre-execution): file-mutation tools
 *   (Write/Edit/ApplyPatch) and worker-lifecycle-awaiting tools
 *   (Agent/TaskOutput) are rejected with a fixed routing phrase
 *   plus a suggested Job draft, so the model flows
 *   "reject → delegate via JobCreate" instead of "reject → retry" (§2.2 b-2).
 * - Stage 2 (access-based, post-resolveExecution): tools outside the known
 *   delegation/lifecycle/read surface are judged by declared `ToolAccesses`
 *   (write/readwrite/all rejected) with a conservative write default for
 *   third-party/MCP tools that declare nothing. This blocks prompt-level
 *   bypasses via plugin or newly added tools.
 * - Bash stays on the lane for read-only inspection only (V1-5): stage 1
 *   classifies the command via `conductor-bash-policy` and hard-denies
 *   anything that can mutate files, packages, or git state.
 * - Tripwire recorder: every block attempt and wall-clock budget overrun is
 *   recorded as a {@link ConductorGuardEvent} (§3.2 G3-lite). Hard-budget
 *   overruns also abort the running call through the per-call budget signal
 *   returned by {@link ConductorDirectWorkGuard.beginToolBudget} (V1-4).
 *   Interactive question waits are exempt so the operator can answer them
 *   without racing the conductor's direct-work timer.
 * - Violations are counted per turn. On the second violation the guard
 *   records the suggested Job draft straight into the ledger through the
 *   injected {@link ConductorJobDraftRecorder} and ACKs the recorded job in
 *   the rejection output; the third violation in one turn requests a forced
 *   turn stop (contract §2.2 b-2, checklist V1-3).
 */

import type { Logger } from '#/logging/types';

import type { ToolResourceAccess } from '../loop/tool-access';
import type { RunnableToolExecution } from '../loop/types';
import { isConductorBashCommandReadOnly } from './conductor-bash-policy';

export const CONDUCTOR_GUARD_CODES = {
  /** File-mutation / write tool rejected on the conductor lane (§2.1). */
  directWorkBlocked: 'CONDUCTOR_DIRECT_WORK_BLOCKED',
  /** Worker-lifecycle-awaiting tool rejected on the conductor lane (§2.1/§3.1). */
  workerWaitBlocked: 'CONDUCTOR_WORKER_WAIT_BLOCKED',
  /** Unknown/third-party tool judged write-like by declared accesses (§2.2 b-2). */
  accessBlocked: 'CONDUCTOR_ACCESS_BLOCKED',
  /** Bash write command rejected on the conductor lane (§2.1 item 3, V1-5). */
  bashWriteBlocked: 'CONDUCTOR_BASH_WRITE_BLOCKED',
  /** Tool wall-clock exceeded the soft budget (§3.2 G3 soft 5s). */
  toolBudgetSoft: 'CONDUCTOR_TOOL_BUDGET_SOFT',
  /** Tool wall-clock exceeded the hard budget (§3.2 G3 hard 15s). */
  toolBudgetHard: 'CONDUCTOR_TOOL_BUDGET_HARD',
  /**
   * Consecutive hard-budget trips reached the turn-stop threshold — the turn
   * is force-stopped with a diagnostic report (checklist V1-4).
   */
  toolBudgetTripStop: 'CONDUCTOR_TOOL_BUDGET_TRIP_STOP',
} as const;

export type ConductorGuardCode =
  (typeof CONDUCTOR_GUARD_CODES)[keyof typeof CONDUCTOR_GUARD_CODES];

export interface ConductorGuardEvent {
  readonly code: ConductorGuardCode;
  readonly toolName?: string | undefined;
  readonly turnId?: string | undefined;
  readonly stepNumber?: number | undefined;
  readonly detail?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly at: number;
}

export interface ConductorGuardOptions {
  /** Soft wall-clock budget per tool call (§3.2 G3 default 5s). */
  readonly softBudgetMs?: number | undefined;
  /** Hard wall-clock budget per tool call (§3.2 G3 default 15s). */
  readonly hardBudgetMs?: number | undefined;
  readonly log?: Logger | undefined;
  readonly now?: () => number;
  /** External tripwire sink (journal/TUI wiring, added later by S1/S2). */
  readonly onEvent?: ((event: ConductorGuardEvent) => void) | undefined;
  /**
   * Ledger sink for the second-violation escalation (V1-3). Late wiring via
   * {@link ConductorDirectWorkGuard.setJobDraftRecorder} is also supported.
   */
  readonly recordJobDraft?: ConductorJobDraftRecorder | undefined;
}

export interface ConductorGuardCallContext {
  readonly toolName: string;
  readonly args?: unknown;
  readonly turnId?: string | undefined;
  readonly stepNumber?: number | undefined;
}

export interface ConductorGuardExecutionContext {
  readonly toolName: string;
  readonly execution: Pick<RunnableToolExecution, 'accesses' | 'readOnly'>;
  readonly turnId?: string | undefined;
  readonly stepNumber?: number | undefined;
}

export interface ConductorJobDraft {
  readonly title: string;
  readonly prompt: string;
  readonly ownership: string;
}

/**
 * What the guard hands to the ledger recorder on the second violation of a
 * turn (checklist V1-3): the draft plus enough context to trace the record
 * back to the blocked call.
 */
export interface ConductorJobDraftRecord {
  readonly draft: ConductorJobDraft;
  readonly code: ConductorGuardCode;
  readonly toolName: string;
  readonly turnId?: string | undefined;
  readonly stepNumber?: number | undefined;
  readonly violationCount: number;
}

/** Recorder acknowledgement — the recorded job id when the ledger assigned one. */
export interface ConductorJobDraftAck {
  readonly jobId?: string | undefined;
}

/**
 * Ledger sink for escalation recording (V1-3). Implementations upsert the
 * draft as a `queued` Job; the conductor Job scheduler picks it up. Kept
 * synchronous because the ledger store mutation is synchronous.
 */
export type ConductorJobDraftRecorder = (
  record: ConductorJobDraftRecord,
) => ConductorJobDraftAck | undefined;

export type ConductorGuardVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: ConductorGuardCode;
      readonly output: string;
      readonly jobDraft?: ConductorJobDraft | undefined;
      /** True from the third violation in the same turn: force turn stop. */
      readonly stopTurn?: boolean | undefined;
    };

/** Fixed routing phrase for direct-work rejection (contract §2.2 b-2). */
export const CONDUCTOR_DIRECT_WORK_REJECTION_PHRASE =
  'Direct work is not allowed on the Conductor lane. This became a Job draft — call JobCreate to delegate (suggested title/prompt attached).';

/** Routing phrase for worker-lifecycle waiting rejection (contract §3.1). */
export const CONDUCTOR_WORKER_WAIT_REJECTION_PHRASE =
  'Blocking on worker lifecycle is not allowed on the Conductor lane. Delegate via JobCreate/Job* tools; worker results arrive through JobInbox — never wait for them in this turn.';

/** Stop-the-turn notice attached from the third violation onward. */
export const CONDUCTOR_TURN_STOP_PHRASE =
  'Repeated direct-work attempts blocked (3 in this turn) — ending the turn. Route the work through JobCreate.';

/**
 * Ledger ACK attached when the second violation escalates to a direct ledger
 * record (V1-3). The draft is already queued — calling JobCreate again for it
 * would duplicate the job, so the ACK replaces the "call JobCreate" hint.
 */
export function formatConductorJobDraftRecordedAck(jobId: string | undefined): string {
  const reference = jobId !== undefined ? ` (job_id: ${jobId})` : '';
  return (
    `Recorded the blocked work as a queued Job in the ledger${reference}. ` +
    'The Job scheduler will pick it up — do not retry the blocked tool and ' +
    'do not call JobCreate again for this draft.'
  );
}

/** File-mutation tools — always rejected on the conductor lane (§2.1). */
export const CONDUCTOR_DIRECT_WORK_TOOLS = ['Write', 'Edit', 'ApplyPatch'] as const;

/**
 * Tools whose execution awaits worker lifecycle/results — rejected on the
 * conductor lane (contract §2.1 "foregound spawn waiting for subagent
 * results", §3.1; inventory A-4/A-5/A-6/A-7/A-8).
 */
export const CONDUCTOR_WORKER_WAIT_TOOLS = ['Agent', 'TaskOutput'] as const;

/**
 * Known-safe builtin surface for the conductor lane (contract §2.1 items 2–6
 * plus the read-only query waist). These keep passing stage 2 even when they
 * declare `all` accesses (ledger mutations such as JobCreate are delegation
 * itself, not direct work). Bash passes stage 2 by name because stage 1 owns
 * its command-level read-only classification (V1-5); long-running shells are
 * caught by the wall-clock tripwire below.
 */
const CONDUCTOR_DELEGATION_SAFE_TOOLS: ReadonlySet<string> = new Set([
  // Job ledger desk — the only delegation means (§2.1 item 2)
  'JobCreate',
  'JobList',
  'JobInspect',
  'JobSteer',
  'JobCancel',
  'JobResume',
  'JobInbox',
  'JobSchedule',
  'MergeJob',
  // Plan/goal lifecycle management (§2.1 item 5)
  'EnterPlanMode',
  'NextPhase',
  'ExitPlanMode',
  'RecordInterviewFinding',
  'CreateGoal',
  'GetGoal',
  'UpdateGoal',
  'SetGoalBudget',
  // Clarification + skill lookup (§2.1 items 4, 6)
  'AskUserQuestion',
  'Skill',
  'SearchSkill',
  'SearchTools',
  // Main-lane harness edits (conductor.yaml) — not product-code work.
  // SkillCreate writes `.agents/skills/auto/`; Refine mutates harness notes.
  // Both declare write/all accesses, so they need an explicit safe-list bypass
  // or stage 2 treats them as direct work.
  'SkillCreate',
  'Refine',
  // Read-only status/query waist (§2.1 item 3)
  'Read',
  'Grep',
  'Glob',
  'RepoQuery',
  'WebSearch',
  'FetchURL',
  'GetCurrentTime',
  'TodoList',
  'Bash',
]);

/** Tools that intentionally wait for operator input instead of doing work. */
export const CONDUCTOR_INTERACTIVE_WAIT_TOOLS = ['AskUserQuestion'] as const;

const DIRECT_WORK_TOOL_SET: ReadonlySet<string> = new Set(CONDUCTOR_DIRECT_WORK_TOOLS);
const WORKER_WAIT_TOOL_SET: ReadonlySet<string> = new Set(CONDUCTOR_WORKER_WAIT_TOOLS);
const INTERACTIVE_WAIT_TOOL_SET: ReadonlySet<string> = new Set(CONDUCTOR_INTERACTIVE_WAIT_TOOLS);

/** Cap for the in-memory tripwire buffer (bounded memory for long sessions). */
const MAX_TRIPWIRE_EVENTS = 500;

/** Violations within one turn that force a turn stop (§2.2 b-2). */
export const CONDUCTOR_TURN_STOP_VIOLATIONS = 3;

/**
 * Consecutive hard-budget trips within one turn that force a turn stop
 * (checklist V1-4). A call settling within the hard budget resets the streak.
 */
export const CONDUCTOR_BUDGET_TRIP_TURN_STOP = 3;

const DEFAULT_SOFT_BUDGET_MS = 5_000;
const DEFAULT_HARD_BUDGET_MS = 15_000;
const NEVER_ABORT_SIGNAL = new AbortController().signal;

interface ToolBudgetEntry {
  readonly toolName: string;
  readonly turnId?: string | undefined;
  readonly startMs: number;
  /** Per-call abort controller — force-stops the call on the hard budget. */
  readonly controller: AbortController;
  /** Set once the hard timer fired; the streak survives until settle. */
  hardTripped?: boolean;
  hardTimer?: ReturnType<typeof setTimeout> | undefined;
}

export class ConductorDirectWorkGuard {
  private readonly softBudgetMs: number;
  private readonly hardBudgetMs: number;
  private readonly now: () => number;
  private readonly log?: Logger | undefined;
  private readonly onEvent?: ((event: ConductorGuardEvent) => void) | undefined;

  private readonly tripwireEvents: ConductorGuardEvent[] = [];
  private readonly violationsByTurn = new Map<string, number>();
  private readonly budgets = new Map<string, ToolBudgetEntry>();
  /** Consecutive hard-budget trips per turn key (V1-4 turn-stop streak). */
  private readonly hardTripStreakByTurn = new Map<string, number>();
  /** Pending turn-stop request per turn key → diagnostic report text. */
  private readonly pendingBudgetTurnStop = new Map<string, string>();
  private jobDraftRecorder: ConductorJobDraftRecorder | undefined;

  constructor(options: ConductorGuardOptions = {}) {
    this.softBudgetMs = options.softBudgetMs ?? DEFAULT_SOFT_BUDGET_MS;
    this.hardBudgetMs = options.hardBudgetMs ?? DEFAULT_HARD_BUDGET_MS;
    this.now = options.now ?? Date.now;
    this.log = options.log;
    this.onEvent = options.onEvent;
    this.jobDraftRecorder = options.recordJobDraft;
  }

  /**
   * Late-wire the ledger sink (V1-3). Tool stores only exist once builtin
   * tools are built, which happens after the guard can first be constructed.
   */
  setJobDraftRecorder(recorder: ConductorJobDraftRecorder): void {
    this.jobDraftRecorder = recorder;
  }

  /**
   * Stage 1 — name-based verdict, run before `resolveExecution` (loop
   * `prepareToolExecution` hook). Rejects the static direct-work and
   * worker-wait sets; everything else proceeds to stage 2.
   */
  evaluateToolCall(ctx: ConductorGuardCallContext): ConductorGuardVerdict {
    if (DIRECT_WORK_TOOL_SET.has(ctx.toolName)) {
      return this.rejectDirectWork(ctx, CONDUCTOR_GUARD_CODES.directWorkBlocked, {
        detail: `file-mutation tool "${ctx.toolName}" invoked on conductor lane`,
        draft: suggestJobDraft(ctx.toolName, ctx.args),
      });
    }
    if (WORKER_WAIT_TOOL_SET.has(ctx.toolName)) {
      return this.rejectDirectWork(ctx, CONDUCTOR_GUARD_CODES.workerWaitBlocked, {
        detail: `worker-lifecycle tool "${ctx.toolName}" invoked on conductor lane`,
      });
    }
    if (ctx.toolName === 'Bash') {
      // V1-5: the conductor lane keeps Bash read-only. Anything not on the
      // inspection allowlist (installs, builds, migrations, git writes, shell
      // redirection/chaining tricks) is direct work and becomes a Job.
      const command = pickStringField(ctx.args, ['command']);
      if (!isConductorBashCommandReadOnly(command)) {
        return this.rejectDirectWork(ctx, CONDUCTOR_GUARD_CODES.bashWriteBlocked, {
          detail: `Bash command classified as write on conductor lane: ${truncateMiddle(command ?? '<missing>', 120)}`,
          draft: suggestJobDraft(ctx.toolName, ctx.args),
        });
      }
    }
    return { allowed: true };
  }

  /**
   * Stage 2 — access-based verdict, run after `resolveExecution` (loop
   * `authorizeToolExecution` hook). Known-safe builtins and declared
   * read-only tools pass; declared write/unrestricted accesses and silent
   * third-party tools are rejected (conservative default = write).
   */
  authorizeExecution(ctx: ConductorGuardExecutionContext): ConductorGuardVerdict {
    const { toolName, execution } = ctx;
    if (CONDUCTOR_DELEGATION_SAFE_TOOLS.has(toolName)) return { allowed: true };
    if (execution.readOnly === true) return { allowed: true };

    const accesses = execution.accesses;
    if (accesses === undefined) {
      return this.rejectDirectWork(ctx, CONDUCTOR_GUARD_CODES.accessBlocked, {
        detail: `tool "${toolName}" declares no accesses; treated as write (conservative default)`,
        draft: suggestJobDraft(toolName, undefined),
      });
    }
    if (accesses.some((access) => declaresFileWrite(access))) {
      return this.rejectDirectWork(ctx, CONDUCTOR_GUARD_CODES.accessBlocked, {
        detail: `tool "${toolName}" declares file write access`,
        draft: suggestJobDraft(toolName, undefined),
      });
    }
    if (accesses.some((access) => access.kind === 'all')) {
      return this.rejectDirectWork(ctx, CONDUCTOR_GUARD_CODES.accessBlocked, {
        detail: `tool "${toolName}" declares unrestricted (execute-large) access`,
        draft: suggestJobDraft(toolName, undefined),
      });
    }
    return { allowed: true };
  }

  /**
   * Arm the wall-clock tripwire for one tool call (§3.2 G3 budgets).
   * Returns the per-call abort signal: the loop feeds it to the running
   * execution, so a hard-budget overrun force-stops the call instead of only
   * recording an observation (checklist V1-4). Re-arming an already armed
   * call returns the same signal. Interactive question waits return a
   * non-aborting signal and are intentionally not subject to this wall-clock
   * budget.
   */
  beginToolBudget(toolCallId: string, toolName: string, turnId?: string): AbortSignal {
    const armed = this.budgets.get(toolCallId);
    if (armed !== undefined) return armed.controller.signal;
    if (INTERACTIVE_WAIT_TOOL_SET.has(toolName)) return NEVER_ABORT_SIGNAL;
    const controller = new AbortController();
    const entry: ToolBudgetEntry = { toolName, turnId, startMs: this.now(), controller };
    const timer = setTimeout(() => {
      entry.hardTimer = undefined;
      entry.hardTripped = true;
      const tripCount = this.noteHardTrip(turnId);
      this.record({
        code: CONDUCTOR_GUARD_CODES.toolBudgetHard,
        toolName,
        ...(turnId !== undefined ? { turnId } : {}),
        durationMs: this.now() - entry.startMs,
        detail: `tool "${toolName}" exceeded hard budget (${String(this.hardBudgetMs)}ms); call force-stopped (trip ${String(tripCount)} in turn) — delegate via JobCreate`,
      });
      this.log?.warn('conductor tool hard budget exceeded — aborting the call', {
        toolName,
        toolCallId,
        hardBudgetMs: this.hardBudgetMs,
        tripCount,
        code: CONDUCTOR_GUARD_CODES.toolBudgetHard,
      });
      if (
        tripCount >= CONDUCTOR_BUDGET_TRIP_TURN_STOP &&
        !this.pendingBudgetTurnStop.has(turnId ?? 'unknown')
      ) {
        const report = this.formatBudgetTripDiagnostic(turnId, toolName);
        this.pendingBudgetTurnStop.set(turnId ?? 'unknown', report);
        this.record({
          code: CONDUCTOR_GUARD_CODES.toolBudgetTripStop,
          toolName,
          ...(turnId !== undefined ? { turnId } : {}),
          detail: report,
        });
        this.log?.warn('conductor hard-budget tripwire stopping the turn', {
          turnId,
          tripCount,
          code: CONDUCTOR_GUARD_CODES.toolBudgetTripStop,
        });
      }
      controller.abort(
        `exceeded the conductor wall-clock hard budget (${String(this.hardBudgetMs)}ms) and was force-stopped. Delegate long-running work via JobCreate instead of running it on the Conductor lane.`,
      );
    }, this.hardBudgetMs);
    // Never keep the process alive for a budget timer.
    timer.unref?.();
    entry.hardTimer = timer;
    this.budgets.set(toolCallId, entry);
    return controller.signal;
  }

  /**
   * Settle the wall-clock tripwire when the call finishes. Returns the
   * measured duration, or `undefined` when no budget was armed.
   */
  endToolBudget(toolCallId: string): number | undefined {
    const entry = this.budgets.get(toolCallId);
    if (entry === undefined) return undefined;
    this.budgets.delete(toolCallId);
    if (entry.hardTimer !== undefined) clearTimeout(entry.hardTimer);
    if (entry.hardTripped !== true) {
      // A call that settled without hitting the hard budget breaks the
      // consecutive-trip streak (checklist V1-4 "3 consecutive trips").
      this.hardTripStreakByTurn.delete(entry.turnId ?? 'unknown');
    }
    const durationMs = this.now() - entry.startMs;
    if (durationMs > this.softBudgetMs) {
      this.record({
        code: CONDUCTOR_GUARD_CODES.toolBudgetSoft,
        toolName: entry.toolName,
        ...(entry.turnId !== undefined ? { turnId: entry.turnId } : {}),
        durationMs,
        detail: `tool "${entry.toolName}" exceeded soft budget (${String(this.softBudgetMs)}ms)`,
      });
      this.log?.warn('conductor tool soft budget exceeded', {
        toolName: entry.toolName,
        toolCallId,
        durationMs,
        softBudgetMs: this.softBudgetMs,
        code: CONDUCTOR_GUARD_CODES.toolBudgetSoft,
      });
    }
    return durationMs;
  }

  /** Tripwire buffer snapshot (observable/testable rejection history). */
  events(): readonly ConductorGuardEvent[] {
    return this.tripwireEvents;
  }

  /** Violation count recorded for one turn. */
  violationsInTurn(turnId: string): number {
    return this.violationsByTurn.get(turnId) ?? 0;
  }

  /**
   * Consume a pending hard-budget turn-stop request for one turn (V1-4).
   * Returns the diagnostic report text exactly once, or `undefined` when the
   * turn has not reached the consecutive-trip threshold.
   */
  consumeBudgetTurnStop(turnId?: string): string | undefined {
    const key = turnId ?? 'unknown';
    const report = this.pendingBudgetTurnStop.get(key);
    if (report === undefined) return undefined;
    this.pendingBudgetTurnStop.delete(key);
    return report;
  }

  /** Consecutive hard-budget trips recorded so far for one turn (V1-4). */
  hardTripsInTurn(turnId?: string): number {
    return this.hardTripStreakByTurn.get(turnId ?? 'unknown') ?? 0;
  }

  /** Reset per-turn state (violation counts, trip streaks, pending budgets). */
  resetTurnState(): void {
    this.violationsByTurn.clear();
    this.hardTripStreakByTurn.clear();
    this.pendingBudgetTurnStop.clear();
    for (const entry of this.budgets.values()) {
      if (entry.hardTimer !== undefined) clearTimeout(entry.hardTimer);
    }
    this.budgets.clear();
  }

  private noteHardTrip(turnId?: string): number {
    const key = turnId ?? 'unknown';
    const count = (this.hardTripStreakByTurn.get(key) ?? 0) + 1;
    this.hardTripStreakByTurn.set(key, count);
    return count;
  }

  /** Diagnostic report attached to the turn-stop result (checklist V1-4). */
  private formatBudgetTripDiagnostic(turnId: string | undefined, latestToolName: string): string {
    const key = turnId ?? 'unknown';
    const hardTrips = this.tripwireEvents.filter(
      (event) =>
        event.code === CONDUCTOR_GUARD_CODES.toolBudgetHard &&
        (event.turnId ?? 'unknown') === key,
    );
    const recent = hardTrips.slice(-CONDUCTOR_BUDGET_TRIP_TURN_STOP);
    const summary = recent
      .map((event) => `${event.toolName ?? latestToolName} (${String(event.durationMs ?? 0)}ms)`)
      .join(', ');
    return (
      `Conductor wall-clock tripwire: ${String(recent.length)} consecutive hard-budget ` +
      `overruns in this turn — ${summary}. Ending the turn; delegate long-running ` +
      'work via JobCreate instead of running it on the Conductor lane.'
    );
  }

  private rejectDirectWork(
    ctx: ConductorGuardCallContext,
    code: ConductorGuardCode,
    info: { readonly detail: string; readonly draft?: ConductorJobDraft | undefined },
  ): ConductorGuardVerdict {
    const turnKey = ctx.turnId ?? 'unknown';
    const count = (this.violationsByTurn.get(turnKey) ?? 0) + 1;
    this.violationsByTurn.set(turnKey, count);
    this.record({
      code,
      toolName: ctx.toolName,
      ...(ctx.turnId !== undefined ? { turnId: ctx.turnId } : {}),
      ...(ctx.stepNumber !== undefined ? { stepNumber: ctx.stepNumber } : {}),
      detail: `${info.detail} (violation ${String(count)} in turn)`,
    });
    this.log?.warn('conductor guard rejected tool call', {
      code,
      toolName: ctx.toolName,
      turnId: ctx.turnId,
      stepNumber: ctx.stepNumber,
      violationCount: count,
    });

    // V1-3 escalation: on the second violation of the turn the guard records
    // the draft as a queued Job straight into the ledger instead of only
    // suggesting it. The third violation stops the turn; nothing is recorded
    // after that point.
    const escalatesToLedger = count === CONDUCTOR_TURN_STOP_VIOLATIONS - 1;
    const draft = info.draft ?? suggestJobDraft(ctx.toolName, ctx.args);
    const recordedAck = escalatesToLedger
      ? this.recordQueuedJobDraft(ctx, code, draft)
      : undefined;

    const basePhrase =
      code === CONDUCTOR_GUARD_CODES.workerWaitBlocked
        ? CONDUCTOR_WORKER_WAIT_REJECTION_PHRASE
        : CONDUCTOR_DIRECT_WORK_REJECTION_PHRASE;
    const parts: string[] = [basePhrase];
    if (info.draft !== undefined) {
      parts.push(
        `Suggested Job draft:\n  title: ${info.draft.title}\n  prompt: ${info.draft.prompt}\n  ownership: ${info.draft.ownership}`,
      );
    }
    if (recordedAck !== undefined) {
      parts.push(formatConductorJobDraftRecordedAck(recordedAck.jobId));
    } else {
      parts.push(
        `Call JobCreate with this draft instead of retrying "${ctx.toolName}" on the Conductor lane.`,
      );
    }
    const stopTurn = count >= CONDUCTOR_TURN_STOP_VIOLATIONS;
    if (stopTurn) parts.push(CONDUCTOR_TURN_STOP_PHRASE);
    else if (escalatesToLedger) {
      parts.push('Second violation this turn — one more blocked attempt ends the turn.');
    }
    return {
      allowed: false,
      code,
      output: parts.join('\n\n'),
      ...(info.draft !== undefined || recordedAck !== undefined ? { jobDraft: draft } : {}),
      ...(stopTurn ? { stopTurn: true } : {}),
    };
  }

  /**
   * V1-3 escalation sink: record the draft as a `queued` Job through the
   * injected ledger recorder. Recorder failures never break the rejection —
   * the verdict falls back to the plain "call JobCreate" hint.
   */
  private recordQueuedJobDraft(
    ctx: ConductorGuardCallContext,
    code: ConductorGuardCode,
    draft: ConductorJobDraft,
  ): ConductorJobDraftAck | undefined {
    const recorder = this.jobDraftRecorder;
    if (recorder === undefined) return undefined;
    try {
      const ack = recorder({
        draft,
        code,
        toolName: ctx.toolName,
        ...(ctx.turnId !== undefined ? { turnId: ctx.turnId } : {}),
        ...(ctx.stepNumber !== undefined ? { stepNumber: ctx.stepNumber } : {}),
        violationCount: CONDUCTOR_TURN_STOP_VIOLATIONS - 1,
      });
      this.log?.info('conductor guard recorded a queued Job draft into the ledger', {
        toolName: ctx.toolName,
        turnId: ctx.turnId,
        jobId: ack?.jobId,
      });
      return ack ?? {};
    } catch (error) {
      this.log?.warn('conductor guard failed to record a queued Job draft', {
        toolName: ctx.toolName,
        turnId: ctx.turnId,
        error,
      });
      return undefined;
    }
  }

  private record(event: Omit<ConductorGuardEvent, 'at'>): void {
    const full: ConductorGuardEvent = { ...event, at: this.now() };
    this.tripwireEvents.push(full);
    if (this.tripwireEvents.length > MAX_TRIPWIRE_EVENTS) {
      this.tripwireEvents.splice(0, this.tripwireEvents.length - MAX_TRIPWIRE_EVENTS);
    }
    try {
      this.onEvent?.(full);
    } catch {
      // Tripwire sinks must never break the turn.
    }
  }
}

function declaresFileWrite(access: ToolResourceAccess): boolean {
  return (
    access.kind === 'file' && (access.operation === 'write' || access.operation === 'readwrite')
  );
}

function suggestJobDraft(toolName: string, args: unknown): ConductorJobDraft {
  const target = pickStringField(args, [
    'file_path',
    'path',
    'notebook_path',
    'directory',
    'command',
  ]);
  const title = target !== undefined
    ? `${toolName}: ${truncateMiddle(target, 80)}`
    : `${toolName} work blocked on Conductor — delegate`;
  const prompt =
    `Perform the work that was blocked on the Conductor lane: use ${toolName}` +
    (target !== undefined ? ` on ${target}` : '') +
    '. Complete it in a worker worktree, verify the result, and report back. ' +
    'When calling JobCreate, set success_criteria to a verifiable finish line for this work.';
  return {
    title,
    prompt,
    ownership: target !== undefined ? target : 'worker',
  };
}

function pickStringField(
  args: unknown,
  fields: readonly string[],
): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const record = args as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(text.length - half)}`;
}

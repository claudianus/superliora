/**
 * Conductor delegation-only runtime guard (meta-orchestrator v2 contract S0).
 *
 * Second defense line for invariant 1 ("delegation-only conductor") and
 * invariant 2 ("no synchronous waiting on workers") from
 * `docs/specs/2026-08-03-meta-orchestrator-v2-contract.md`:
 *
 * - Stage 1 (name-based, pre-execution): file-mutation tools
 *   (Write/Edit/ApplyPatch) and worker-lifecycle-awaiting tools
 *   (Agent/Fleet/TaskOutput/swarm) are rejected with a fixed routing phrase
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
 *   recorded as a {@link ConductorGuardEvent} (§3.2 G3-lite; hard interruption
 *   of a running tool belongs to the S1 loop redesign).
 * - Violations are counted per turn; the third violation in one turn requests
 *   a forced turn stop (contract §2.2 b-2 third-violation rule).
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

/** File-mutation tools — always rejected on the conductor lane (§2.1). */
export const CONDUCTOR_DIRECT_WORK_TOOLS = ['Write', 'Edit', 'ApplyPatch'] as const;

/**
 * Tools whose execution awaits worker lifecycle/results — rejected on the
 * conductor lane (contract §2.1 "foregound spawn waiting for subagent
 * results", §3.1; inventory A-4/A-5/A-6/A-7/A-8).
 */
export const CONDUCTOR_WORKER_WAIT_TOOLS = [
  'Agent',
  'Fleet',
  'TaskOutput',
  'UltraSwarm',
  'AgentSwarm',
] as const;

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

const DIRECT_WORK_TOOL_SET: ReadonlySet<string> = new Set(CONDUCTOR_DIRECT_WORK_TOOLS);
const WORKER_WAIT_TOOL_SET: ReadonlySet<string> = new Set(CONDUCTOR_WORKER_WAIT_TOOLS);

/** Cap for the in-memory tripwire buffer (bounded memory for long sessions). */
const MAX_TRIPWIRE_EVENTS = 500;

/** Violations within one turn that force a turn stop (§2.2 b-2). */
export const CONDUCTOR_TURN_STOP_VIOLATIONS = 3;

const DEFAULT_SOFT_BUDGET_MS = 5_000;
const DEFAULT_HARD_BUDGET_MS = 15_000;

interface ToolBudgetEntry {
  readonly toolName: string;
  readonly turnId?: string | undefined;
  readonly startMs: number;
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

  constructor(options: ConductorGuardOptions = {}) {
    this.softBudgetMs = options.softBudgetMs ?? DEFAULT_SOFT_BUDGET_MS;
    this.hardBudgetMs = options.hardBudgetMs ?? DEFAULT_HARD_BUDGET_MS;
    this.now = options.now ?? Date.now;
    this.log = options.log;
    this.onEvent = options.onEvent;
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

  /** Arm the wall-clock tripwire for one tool call (§3.2 G3 budgets). */
  beginToolBudget(toolCallId: string, toolName: string, turnId?: string): void {
    const entry: ToolBudgetEntry = { toolName, turnId, startMs: this.now() };
    const timer = setTimeout(() => {
      entry.hardTimer = undefined;
      this.record({
        code: CONDUCTOR_GUARD_CODES.toolBudgetHard,
        toolName,
        ...(turnId !== undefined ? { turnId } : {}),
        durationMs: this.now() - entry.startMs,
        detail: `tool "${toolName}" exceeded hard budget (${String(this.hardBudgetMs)}ms); likely direct work — delegate via JobCreate`,
      });
      this.log?.warn('conductor tool hard budget exceeded', {
        toolName,
        toolCallId,
        hardBudgetMs: this.hardBudgetMs,
        code: CONDUCTOR_GUARD_CODES.toolBudgetHard,
      });
    }, this.hardBudgetMs);
    // Never keep the process alive for a budget timer.
    timer.unref?.();
    entry.hardTimer = timer;
    this.budgets.set(toolCallId, entry);
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

  /** Reset per-turn state (violation counts, pending budgets). */
  resetTurnState(): void {
    this.violationsByTurn.clear();
    for (const entry of this.budgets.values()) {
      if (entry.hardTimer !== undefined) clearTimeout(entry.hardTimer);
    }
    this.budgets.clear();
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
    parts.push(
      `Call JobCreate with this draft instead of retrying "${ctx.toolName}" on the Conductor lane.`,
    );
    const stopTurn = count >= CONDUCTOR_TURN_STOP_VIOLATIONS;
    if (stopTurn) parts.push(CONDUCTOR_TURN_STOP_PHRASE);
    else if (count === CONDUCTOR_TURN_STOP_VIOLATIONS - 1) {
      parts.push('Second violation this turn — one more blocked attempt ends the turn.');
    }
    return {
      allowed: false,
      code,
      output: parts.join('\n\n'),
      ...(info.draft !== undefined ? { jobDraft: info.draft } : {}),
      ...(stopTurn ? { stopTurn: true } : {}),
    };
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
    '. Complete it in a worker worktree, verify the result, and report back.';
  return { title, prompt, ownership: 'worker' };
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

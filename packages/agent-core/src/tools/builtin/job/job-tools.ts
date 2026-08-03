/**
 * Conductor Job* tools — meta-orchestrator ledger control plane (P0–P1.75).
 * Ledger, schedule, worker launch, inbox, resume.
 */

import { z } from 'zod';

import type { Agent } from '../../../agent';
import type {
  ConductorJobDraftRecorder,
} from '../../../agent/conductor-guard';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import {
  JOB_CREATE_ACK_SPAWN_GRACE_MS,
  getJobWorkerSpawner,
  requestJobSchedulePump,
} from '../../../session/job/job-offload';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import {
  listUnreadJobInbox,
  markJobInboxRead,
  readJobInbox,
  renderJobInboxBrief,
} from './job-inbox';
import {
  createJob,
  getJob,
  listJobs,
  patchJob,
  renderJobLedger,
  renderJobLine,
  type JobKind,
  type JobStatus,
} from './job-ledger';
import {
  countJobsWithStatus,
  formatJobStripLine,
  resolveConductorPoolConfig,
  summarizeJobStrip,
} from './job-runtime';
import { dispatchMergeLand, type LandJobToMainInput } from './job-land';
import { evaluateMergeTrust } from './job-merge-trust';
import { splitUserMessageIntoJobIntents } from './job-split';
import { ensureWarmPool, warmPoolSpawner, type WarmPoolSpawner } from './job-warm-pool';
import { cancelJobWorker, resumeJobs, steerJobWorker } from './job-worker';

const JobKindSchema = z.enum(['task', 'explore', 'implement', 'mission', 'merge', 'desk']);
const JobStatusSchema = z.enum([
  'queued',
  'running',
  'blocked',
  'needs_user',
  'done',
  'failed',
  'cancelled',
  'interrupted',
]);

const JobCreateInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Short outcome-shaped title for the ledger and ACK (verb + deliverable, e.g. "Fix auth token refresh race").',
      ),
    kind: JobKindSchema.optional().describe(
      'Job kind. task/implement = code work (default task), explore = read-only research, mission = long-running spine, merge = landing worker, desk = digest. Defaults to task.',
    ),
    priority: z
      .number()
      .int()
      .optional()
      .describe(
        'Higher runs sooner when scheduled. Default 0. Raise only when the user signals urgency — the queue is the honest order.',
      ),
    prompt: z
      .string()
      .optional()
      .describe(
        'Self-sufficient worker brief: goal as a verifiable outcome, success criteria (commands/tests that prove it), scope fence (what NOT to touch), starting paths, repo constraints (AGENTS.md rules, no push, no secrets), and the user context quoted verbatim. The worker sees nothing else.',
      ),
    ownership_paths: z
      .array(z.string().trim().min(1))
      .optional()
      .describe(
        'Paths this job intends to touch — the scheduler conflict hint. Overlapping ownership between parallel jobs risks racing; keep siblings disjoint or chain them via parent_job_id.',
      ),
    context_paths: z
      .array(z.string().trim().min(1))
      .optional()
      .describe(
        'Read-first hints for the worker: files/dirs it should inspect before exploring on its own (entry points, failing tests, referenced specs). Saves cold-start discovery turns; keep it short (≤6).',
      ),
    parent_job_id: z
      .string()
      .optional()
      .describe('Parent job id for subtasks of an existing Job (decomposition chains).'),
    mission_run_id: z.string().optional(),
    /**
     * When true, split `prompt` (or title) into multiple Jobs via multi-intent heuristic
     * and return one summary ACK. Falls back to a single Job if split fails.
     */
    auto_split: z
      .boolean()
      .optional()
      .describe(
        'Split a multi-intent prompt into one Job per intent (user asked several independent things at once). Prefer explicit separate JobCreate calls when intents need different kinds/ownership; falls back to a single Job when splitting fails.',
      ),
  })
  .strict();

const JobListInputSchema = z
  .object({
    status: JobStatusSchema.optional().describe('Filter by status.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows. Default 50.'),
  })
  .strict();

const JobIdInputSchema = z
  .object({
    job_id: z.string().trim().min(1).describe('Job id (job_<shortulid>).'),
  })
  .strict();

const JobSteerInputSchema = z
  .object({
    job_id: z.string().trim().min(1),
    message: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Steering instruction for the worker / meta notes. State the delta precisely (what changed, what stays); quote the user when relevant.',
      ),
    status: JobStatusSchema.optional().describe('Optional status update while steering.'),
  })
  .strict();

const JobCancelInputSchema = z
  .object({
    job_id: z.string().trim().min(1),
    reason: z.string().optional(),
  })
  .strict();

const MergeJobInputSchema = z
  .object({
    job_id: z.string().trim().min(1),
    approve: z
      .boolean()
      .describe('true to approve land-to-main under trust rules; false to reject/hold.'),
    summary: z.string().optional().describe('Review summary recorded on the job.'),
    diff_lines: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Approx diff size in lines (trust: small ≤200 for meta auto).'),
    has_conflict: z.boolean().optional().describe('True if merge conflict exists.'),
    checks_green: z
      .boolean()
      .optional()
      .describe('True only if project checks passed. Required for auto; never sufficient alone.'),
    force_user_confirm: z
      .boolean()
      .optional()
      .describe('When true, treat as explicit user approval (large/risky still OK if approve).'),
    paths: z
      .array(z.string())
      .optional()
      .describe('Paths in the merge; dangerous paths block meta auto.'),
  })
  .strict();

function ack(jobId: string, status: JobStatus, extra?: string): string {
  const line = `ACK ${jobId} state=${status}`;
  return extra ? `${line}\n${extra}` : line;
}

export class JobCreateTool implements BuiltinTool<z.infer<typeof JobCreateInputSchema>> {
  readonly name = 'JobCreate' as const;
  readonly description =
    'Delegate work: create a Conductor Job on the meta ledger and return an immediate ACK (job_id + state). ' +
    'The ONLY path for any file mutation, build, test, install, or verification loop on the Conductor lane — even a one-line fix. ' +
    'Route every task-like user request here first so nothing is lost while workers run; write a self-sufficient brief (goal, success criteria, scope fence, paths, constraints), pass ownership_paths, and add context_paths for files the worker should read first. ' +
    'Multi-intent messages: auto_split=true or several calls in one turn, then one summary ACK. Scheduling is offloaded — the ACK never waits for the worker.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(JobCreateInputSchema);

  constructor(
    private readonly store: ToolStore,
    private readonly agent?: Agent,
  ) {}

  resolveExecution(args: z.infer<typeof JobCreateInputSchema>): ToolExecution {
    const parsed = JobCreateInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        output: `Invalid JobCreate args: ${parsed.error.message}`,
      };
    }
    const a = parsed.data;
    return {
      accesses: ToolAccesses.all(),
      description: `Create job: ${a.title}`,
      readOnly: false,
      approvalRule: this.name,
      execute: async () => {
        const pool = resolveConductorPoolConfig();

        const intents =
          a.auto_split === true
            ? splitUserMessageIntoJobIntents(a.prompt?.trim() || a.title)
            : [{ title: a.title, prompt: a.prompt ?? a.title }];

        const created = intents.map((intent, index) =>
          createJob(this.store, {
            title: intent.title || a.title,
            kind: a.kind as JobKind | undefined,
            priority: (a.priority ?? 0) + (intents.length - index),
            prompt: intent.prompt,
            ownershipPaths: a.ownership_paths,
            contextPaths: a.context_paths,
            parentJobId: a.parent_job_id,
            missionRunId: a.mission_run_id,
          }),
        );

        // V2-1 ACK deadline (G1): scheduling + worker spawns run on the
        // offload lane (deferred pump → serialized WorkerSpawner); failures
        // land on ledger/inbox, never on this return path. The short grace
        // race lets a fast handshake enrich the ACK with the worker id while
        // a slow handshake (incident 2026-08-03: ~125s) can never push the
        // ACK past the locked 250ms deadline.
        requestJobSchedulePump({ store: this.store, agent: this.agent });
        if (this.agent?.subagentHost !== undefined) {
          await Promise.race([
            getJobWorkerSpawner().settle(),
            new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, JOB_CREATE_ACK_SPAWN_GRACE_MS);
              (timer as { unref?: () => void }).unref?.();
            }),
          ]);
        }

        const backpressure =
          countJobsWithStatus(this.store, ['running']) >= pool.maxConcurrentJobs;

        const lines: string[] = [];
        if (created.length > 1) {
          lines.push(`ACK batch count=${created.length} (multi-intent split)`);
        }
        for (const job of created) {
          const latest = getJob(this.store, job.id) ?? job;
          lines.push(ack(latest.id, latest.status, renderJobLine(latest)));
          if (latest.worktreePath) {
            lines.push(`worktree: ${latest.worktreePath}`);
          }
        }
        lines.push(
          'schedule: offloaded — background pump promotes queued jobs; transitions land on ledger/inbox.',
        );
        lines.push(`pool: warm=${pool.warmPoolSize} maxConcurrent=${pool.maxConcurrentJobs}`);
        if (backpressure) {
          lines.push('Backpressure active — new jobs remain queued until a slot frees.');
        }
        return { isError: false, output: lines.join('\n') };
      },
    };
  }
}

export class JobListTool implements BuiltinTool<z.infer<typeof JobListInputSchema>> {
  readonly name = 'JobList' as const;
  readonly description =
    'Read the Conductor Job ledger — the single source of truth for fleet state. Use for status questions, before creating a Job that might duplicate an existing one, and after resume/compaction to rebuild live state. Read-only; never wait on results here. Optional status filter.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(JobListInputSchema);

  constructor(private readonly store: ToolStore) {}

  resolveExecution(args: z.infer<typeof JobListInputSchema>): ToolExecution {
    const parsed = JobListInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: `Invalid JobList args: ${parsed.error.message}` };
    }
    const a = parsed.data;
    return {
      accesses: ToolAccesses.none(),
      description: 'List jobs',
      readOnly: true,
      approvalRule: this.name,
      execute: async () => {
        let jobs = [...listJobs(this.store)];
        if (a.status) jobs = jobs.filter((j) => j.status === a.status);
        jobs.sort((x, y) => y.priority - x.priority || x.createdAt.localeCompare(y.createdAt));
        const limit = a.limit ?? 50;
        jobs = jobs.slice(0, limit);
        return { isError: false, output: renderJobLedger(jobs) };
      },
    };
  }
}

export class JobInspectTool implements BuiltinTool<z.infer<typeof JobIdInputSchema>> {
  readonly name = 'JobInspect' as const;
  readonly description =
    'Inspect one Job record: status, notes (failure/block causes such as worktree_failed, spawn_budget_exceeded), worktree path, result summary. The diagnosis step before JobResume/JobSteer/retry decisions on blocked or failed jobs.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(JobIdInputSchema);

  constructor(private readonly store: ToolStore) {}

  resolveExecution(args: z.infer<typeof JobIdInputSchema>): ToolExecution {
    const parsed = JobIdInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: `Invalid JobInspect args: ${parsed.error.message}` };
    }
    return {
      accesses: ToolAccesses.none(),
      description: `Inspect ${parsed.data.job_id}`,
      readOnly: true,
      approvalRule: this.name,
      execute: async () => {
        const job = getJob(this.store, parsed.data.job_id);
        if (!job) return { isError: true, output: `Job not found: ${parsed.data.job_id}` };
        return { isError: false, output: JSON.stringify(job, null, 2) };
      },
    };
  }
}

export class JobSteerTool implements BuiltinTool<z.infer<typeof JobSteerInputSchema>> {
  readonly name = 'JobSteer' as const;
  readonly description =
    'Redirect a live Job without restarting it: append notes and deliver to the running worker when possible. ' +
    'Use when the goal stands but details changed (scope delta, extra constraint, user preference). ' +
    'If the goal itself changed, JobCancel + fresh JobCreate instead — never let two versions of one goal race.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(JobSteerInputSchema);

  constructor(
    private readonly store: ToolStore,
    private readonly agent?: Agent,
  ) {}

  resolveExecution(args: z.infer<typeof JobSteerInputSchema>): ToolExecution {
    const parsed = JobSteerInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: `Invalid JobSteer args: ${parsed.error.message}` };
    }
    const a = parsed.data;
    return {
      accesses: ToolAccesses.all(),
      description: `Steer ${a.job_id}`,
      readOnly: false,
      approvalRule: this.name,
      execute: async () => {
        const result = steerJobWorker({
          store: this.store,
          agent: this.agent,
          jobId: a.job_id,
          message: a.message,
          status: a.status,
        });
        if (!result.ok || !result.job) {
          return { isError: true, output: result.error ?? `Job not found: ${a.job_id}` };
        }
        return {
          isError: false,
          output: ack(
            result.job.id,
            result.job.status,
            `${renderJobLine(result.job)}\nsteered=${result.steered}`,
          ),
        };
      },
    };
  }
}

export class JobCancelTool implements BuiltinTool<z.infer<typeof JobCancelInputSchema>> {
  readonly name = 'JobCancel' as const;
  readonly description =
    'Cancel a Job and abort its worker when live. Use for explicit stop requests or when replacing a job whose goal changed (then create the fresh Job). Record a reason — the ledger history is the fleet memory. Do not cancel on a first failure without inspecting the cause.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(JobCancelInputSchema);

  constructor(
    private readonly store: ToolStore,
    private readonly agent?: Agent,
  ) {}

  resolveExecution(args: z.infer<typeof JobCancelInputSchema>): ToolExecution {
    const parsed = JobCancelInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: `Invalid JobCancel args: ${parsed.error.message}` };
    }
    const a = parsed.data;
    return {
      accesses: ToolAccesses.all(),
      description: `Cancel ${a.job_id}`,
      readOnly: false,
      approvalRule: this.name,
      execute: async () => {
        const result = await cancelJobWorker({
          store: this.store,
          agent: this.agent,
          jobId: a.job_id,
          reason: a.reason,
        });
        if (!result.ok || !result.job) {
          return { isError: true, output: result.error ?? `Job not found: ${a.job_id}` };
        }
        return {
          isError: false,
          output: ack(
            result.job.id,
            result.job.status,
            `${renderJobLine(result.job)}\naborted=${result.aborted}`,
          ),
        };
      },
    };
  }
}

export interface MergeJobToolOptions {
  /** Injectable git runner for contract tests (merge delay injection). */
  readonly runGit?: LandJobToMainInput['runGit'];
}

export class MergeJobTool implements BuiltinTool<z.infer<typeof MergeJobInputSchema>> {
  readonly name = 'MergeJob' as const;
  readonly description =
    'Land or hold a Job under Conductor trust rules (small∧no conflict∧checks green∧non-dangerous + summary). Never merge on green alone. On approve, records the verdict and offloads the actual merge to a kind=merge landing worker (no remote push); the interactive turn never runs git merge.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(MergeJobInputSchema);

  constructor(
    private readonly store: ToolStore,
    private readonly agent?: Agent,
    private readonly options?: MergeJobToolOptions,
  ) {}

  resolveExecution(args: z.infer<typeof MergeJobInputSchema>): ToolExecution {
    const parsed = MergeJobInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: `Invalid MergeJob args: ${parsed.error.message}` };
    }
    const a = parsed.data;
    return {
      accesses: ToolAccesses.all(),
      description: `MergeJob ${a.job_id}`,
      readOnly: false,
      approvalRule: this.name,
      execute: async () => {
        const existing = getJob(this.store, a.job_id);
        if (!existing) return { isError: true, output: `Job not found: ${a.job_id}` };

        if (!a.approve) {
          const job = patchJob(this.store, a.job_id, {
            status: existing.status === 'done' ? 'done' : 'blocked',
            notes: [existing.notes, `merge: rejected ${a.summary ?? ''}`].filter(Boolean).join('\n'),
          });
          return {
            isError: false,
            output: ack(job!.id, job!.status, 'Merge rejected/held.'),
          };
        }

        const paths = a.paths ?? existing.ownershipPaths ?? [];
        const trust = evaluateMergeTrust({
          approve: true,
          diffLines: a.diff_lines,
          hasConflict: a.has_conflict,
          checksGreen: a.checks_green,
          paths,
          hasSummary: Boolean(a.summary?.trim() || existing.resultSummary?.trim()),
          forceUserConfirm: a.force_user_confirm === true,
        });

        if (!trust.ok) {
          const job = patchJob(this.store, a.job_id, {
            status: 'blocked',
            notes: [existing.notes, `merge: hold — ${trust.reason}`].filter(Boolean).join('\n'),
          });
          return {
            isError: true,
            output: ack(
              job!.id,
              job!.status,
              `Merge held (trust rules): ${trust.reason}. Set force_user_confirm=true after user review for large/risky diffs.`,
            ),
          };
        }

        // V2-5 (G5): verdict/execution split. The interactive turn returns
        // the trust verdict only; the actual land runs on a kind=merge
        // landing job (offload lane). Never `await` a merge here — the
        // await-scan merge lane is ratcheted to 0.
        const dispatch = dispatchMergeLand({
          store: this.store,
          sourceJob: existing,
          trustMode: trust.mode,
          trustReason: trust.reason,
          summary: a.summary,
          kaos: this.agent?.kaos,
          repoPath: this.agent?.config.cwd,
          runGit: this.options?.runGit,
        });

        const latest = getJob(this.store, a.job_id) ?? existing;
        return {
          isError: false,
          output: ack(
            latest.id,
            latest.status,
            [
              `Merge approved (${trust.mode}). ${trust.reason}`,
              dispatch.mergeJob
                ? `Execution offloaded to landing worker ${dispatch.mergeJob.id} (kind=merge); land result lands on ledger/inbox. Main turn ran no git merge.`
                : 'Dispatch failed — merge held for manual resolve.',
            ].join('\n'),
          ),
        };
      },
    };
  }
}

export class JobScheduleTool implements BuiltinTool<Record<string, never>> {
  readonly name = 'JobSchedule' as const;
  readonly description =
    'Run the Conductor scheduler: pre-spawn warm workers, promote queued Jobs to running under maxConcurrent, attaching worktrees when possible.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(z.object({}).strict());

  constructor(
    private readonly store: ToolStore,
    private readonly agent?: Agent,
  ) {}

  resolveExecution(): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      description: 'Schedule queued jobs',
      readOnly: false,
      approvalRule: this.name,
      execute: async () => {
        const pool = resolveConductorPoolConfig();
        const spawner = warmPoolSpawner(this.agent);
        const warm = ensureWarmPool(this.store, pool, spawner);
        const queued = countJobsWithStatus(this.store, ['queued']);
        const running = countJobsWithStatus(this.store, ['running']);
        // V2-1 ACK deadline (G1): worktree attach + worker spawn run on the
        // offload lane; this ACK reports the synchronous pool snapshot.
        requestJobSchedulePump({ store: this.store, agent: this.agent });
        return {
          isError: false,
          output: [
            warm.message,
            `Schedule pump offloaded; queued ${queued}; running ${running}/${pool.maxConcurrentJobs}. Transitions land on ledger/inbox.`,
          ].join('\n'),
        };
      },
    };
  }
}

const JobResumeInputSchema = z
  .object({
    job_id: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional job id. Omit to resume all interrupted/needs_user jobs.'),
    answer: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Optional user answer for a needs_user interview card. Injects the answer and re-queues the job so its worker resumes with the input (mid-tool-loop input queue path).',
      ),
  })
  .strict();

export class JobResumeTool implements BuiltinTool<z.infer<typeof JobResumeInputSchema>> {
  readonly name = 'JobResume' as const;
  readonly description =
    'Restore stalled Jobs: re-queue interrupted ones (session ended mid-flight) or an explicitly identified blocked/failed/cancelled Job, and schedule workers. ' +
    'Also the delivery path for needs_user answers: pass the user answer to resume the waiting worker. ' +
    'For blocked jobs, JobInspect first and fix the recorded cause (e.g. git setup) — a blind second resume on the same cause is wasted work.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(JobResumeInputSchema);

  constructor(
    private readonly store: ToolStore,
    private readonly agent?: Agent,
  ) {}

  resolveExecution(args: z.infer<typeof JobResumeInputSchema>): ToolExecution {
    const parsed = JobResumeInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: `Invalid JobResume args: ${parsed.error.message}` };
    }
    const a = parsed.data;
    return {
      accesses: ToolAccesses.all(),
      description: a.job_id ? `Resume ${a.job_id}` : 'Resume interrupted jobs',
      readOnly: false,
      approvalRule: this.name,
      execute: async () => {
        const result = await resumeJobs({
          store: this.store,
          agent: this.agent,
          jobId: a.job_id,
          answer: a.answer,
        });
        if (!result.ok) {
          return { isError: true, output: result.error ?? 'Resume failed' };
        }
        return {
          isError: false,
          output: [
            result.message,
            ...result.resumed.map((j) => renderJobLine(j)),
          ].join('\n'),
        };
      },
    };
  }
}

const JobInboxInputSchema = z
  .object({
    mark_read: z
      .boolean()
      .optional()
      .describe('When true, mark returned unread events as read. Default false.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max events. Default 20.'),
  })
  .strict();

export class JobInboxTool implements BuiltinTool<z.infer<typeof JobInboxInputSchema>> {
  readonly name = 'JobInbox' as const;
  readonly description =
    'Read Conductor meta Job inbox (completion/failure/blocked/needs_user notices; burst digests arrive as one escalation card). Handle it with 1–2 reads per turn — act on the highest-severity card (needs_user first), do not recite events. Optional mark_read.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(JobInboxInputSchema);

  constructor(private readonly store: ToolStore) {}

  resolveExecution(args: z.infer<typeof JobInboxInputSchema>): ToolExecution {
    const parsed = JobInboxInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: `Invalid JobInbox args: ${parsed.error.message}` };
    }
    const a = parsed.data;
    return {
      accesses: ToolAccesses.none(),
      description: 'Job inbox',
      readOnly: true,
      approvalRule: this.name,
      execute: async () => {
        const limit = a.limit ?? 20;
        const unread = listUnreadJobInbox(this.store).slice(-limit);
        let marked = 0;
        if (a.mark_read === true && unread.length > 0) {
          marked = markJobInboxRead(
            this.store,
            unread.map((e) => e.id),
          );
        }
        // Render the strip from post-mark state so the ACK line and the TUI
        // strip parse never report a stale unread count for this call.
        const strip = summarizeJobStrip(this.store);
        const unreadCount = listUnreadJobInbox(this.store).length;
        const lines = [
          formatJobStripLine(strip, unreadCount),
          renderJobInboxBrief(
            unread.length > 0 ? unread : readJobInbox(this.store).events.slice(-limit),
          ),
        ];
        if (a.mark_read === true && unread.length > 0) {
          lines.push(`Marked ${marked} event(s) read.`);
        }
        return { isError: false, output: lines.join('\n') };
      },
    };
  }
}

export function createConductorJobTools(store: ToolStore, agent?: Agent): BuiltinTool[] {
  return [
    new JobCreateTool(store, agent),
    new JobListTool(store),
    new JobInspectTool(store),
    new JobSteerTool(store, agent),
    new JobCancelTool(store, agent),
    new MergeJobTool(store, agent),
    new JobScheduleTool(store, agent),
    new JobResumeTool(store, agent),
    new JobInboxTool(store),
  ];
}

/**
 * Ledger sink for the conductor guard's second-violation escalation
 * (checklist V1-3): record the blocked work as a `queued` Job so the regular
 * Job scheduler picks it up — no model round-trip through JobCreate needed.
 */
export function createConductorJobDraftRecorder(store: ToolStore): ConductorJobDraftRecorder {
  return ({ draft }) => {
    const job = createJob(store, { title: draft.title, prompt: draft.prompt });
    return { jobId: job.id };
  };
}

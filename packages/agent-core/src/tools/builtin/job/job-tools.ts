/**
 * Conductor Job* tools — meta-orchestrator ledger control plane (P0–P1.75).
 * Ledger, schedule, worker launch, inbox, resume.
 */

import { z } from 'zod';

import type { Agent } from '../../../agent';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
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
  formatJobStripLine,
  resolveConductorPoolConfig,
  scheduleQueuedJobs,
  summarizeJobStrip,
} from './job-runtime';
import { landJobToMain } from './job-land';
import { evaluateMergeTrust } from './job-merge-trust';
import { splitUserMessageIntoJobIntents } from './job-split';
import { ensureWarmPool, warmPoolSpawner, type WarmPoolSpawner } from './job-warm-pool';
import {
  cancelJobWorker,
  launchJobWorker,
  resumeJobs,
  steerJobWorker,
} from './job-worker';

const JobKindSchema = z.enum(['task', 'explore', 'implement', 'mission', 'merge']);
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
    title: z.string().trim().min(1).describe('Short job title for the ledger and ACK.'),
    kind: JobKindSchema.optional().describe('Job kind. Defaults to task.'),
    priority: z.number().int().optional().describe('Higher runs sooner when scheduled. Default 0.'),
    prompt: z.string().optional().describe('Full task brief for the worker.'),
    ownership_paths: z
      .array(z.string().trim().min(1))
      .optional()
      .describe('Paths this job intends to touch (conflict hints).'),
    parent_job_id: z.string().optional(),
    mission_run_id: z.string().optional(),
    /**
     * When true, split `prompt` (or title) into multiple Jobs via multi-intent heuristic
     * and return one summary ACK. Falls back to a single Job if split fails.
     */
    auto_split: z.boolean().optional().describe('Split multi-intent prompt into multiple Jobs.'),
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
    message: z.string().trim().min(1).describe('Steering instruction for the worker / meta notes.'),
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
    'Create a Conductor Job on the meta ledger and return an immediate ACK (job_id + queued). Prefer this for task-like user requests so work is not lost while workers run.';
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
        const kaos = this.agent?.kaos;
        const repoPath = this.agent?.config.cwd;
        const canSpawn = this.agent?.subagentHost !== undefined;
        const launchWorker =
          canSpawn && this.agent
            ? async (job: { id: string }) => {
                const full = getJob(this.store, job.id);
                if (full) await launchJobWorker({ store: this.store, agent: this.agent!, job: full });
              }
            : undefined;

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
            parentJobId: a.parent_job_id,
            missionRunId: a.mission_run_id,
          }),
        );

        const schedule = await scheduleQueuedJobs({
          store: this.store,
          kaos,
          repoPath,
          maxConcurrent: pool.maxConcurrentJobs,
          // If no kaos (unit tests), still flip to running without worktree.
          requireWorktree: kaos !== undefined && repoPath !== undefined,
          log: this.agent?.log,
          launchWorker,
        });

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
        lines.push(schedule.message);
        lines.push(`pool: warm=${pool.warmPoolSize} maxConcurrent=${pool.maxConcurrentJobs}`);
        if (schedule.backpressure) {
          lines.push('Backpressure active — new jobs remain queued until a slot frees.');
        }
        return { isError: false, output: lines.join('\n') };
      },
    };
  }
}

export class JobListTool implements BuiltinTool<z.infer<typeof JobListInputSchema>> {
  readonly name = 'JobList' as const;
  readonly description = 'List Conductor Jobs on the meta ledger (optional status filter).';
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
  readonly description = 'Inspect one Job record (status, paths, worktree, result summary).';
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
    'Steer a Job: append notes and deliver to a live worker when possible.';
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
  readonly description = 'Cancel a Job and abort its worker when live.';
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

export class MergeJobTool implements BuiltinTool<z.infer<typeof MergeJobInputSchema>> {
  readonly name = 'MergeJob' as const;
  readonly description =
    'Land or hold a Job under Conductor trust rules (small∧no conflict∧checks green∧non-dangerous + summary). Never merge on green alone. On approve, merges job worktree branch into main workspace (no remote push) and GCs worktree on success.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(MergeJobInputSchema);

  constructor(
    private readonly store: ToolStore,
    private readonly agent?: Agent,
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

        // Trust passed — attempt worktree land when available.
        const land = await landJobToMain({
          store: this.store,
          job: {
            ...existing,
            resultSummary: a.summary ?? existing.resultSummary,
            notes: [existing.notes, `merge: approved mode=${trust.mode} — ${trust.reason}`]
              .filter(Boolean)
              .join('\n'),
          },
          kaos: this.agent?.kaos,
          repoPath: this.agent?.config.cwd,
          gcOnSuccess: true,
        });

        if (!land.ok) {
          return {
            isError: true,
            output: ack(
              land.job.id,
              land.job.status,
              `Trust OK (${trust.mode}) but land failed: ${land.error ?? 'unknown'}. Job held for manual resolve.`,
            ),
          };
        }

        return {
          isError: false,
          output: ack(
            land.job.id,
            land.job.status,
            [
              `Merge approved (${trust.mode}). ${trust.reason}`,
              land.message,
              land.merged ? 'Landed to main workspace (no remote push).' : 'Ledger-only (no worktree).',
            ].join(' '),
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
        const kaos = this.agent?.kaos;
        const repoPath = this.agent?.config.cwd;
        const canSpawn = this.agent?.subagentHost !== undefined;
        const schedule = await scheduleQueuedJobs({
          store: this.store,
          kaos,
          repoPath,
          maxConcurrent: pool.maxConcurrentJobs,
          requireWorktree: kaos !== undefined && repoPath !== undefined,
          log: this.agent?.log,
          launchWorker:
            canSpawn && this.agent
              ? async (job) => {
                  await launchJobWorker({ store: this.store, agent: this.agent!, job });
                }
              : undefined,
        });
        return {
          isError: false,
          output: [
            warm.message,
            schedule.message,
            ...schedule.started.map((j) => `started ${renderJobLine(j)}`),
            ...schedule.blocked.map((j) => `blocked ${renderJobLine(j)}`),
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
    'Resume interrupted (or explicitly identified blocked/failed/cancelled) Jobs: re-queue and schedule workers.';
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
    'Read Conductor meta Job inbox (completion/failure/needs_user notices). Optional mark_read.';
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

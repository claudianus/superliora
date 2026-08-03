/**
 * Orchestrator tools — meta-orchestrator workflow for async parallel coding.
 *
 * These tools are only registered when the agent runs in `orchestratorMode`.
 * The orchestrator never performs long-running file operations itself; it
 * delegates all real work to background workers running in isolated git
 * worktrees.
 *
 * Tools:
 * - SpawnWorkerTool  — spawn a background worker in an isolated worktree
 * - SteerWorkerTool  — inject instructions into a running worker
 * - QueryWorkerTool  — list active workers and their status
 */
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import type {
  ExecutableToolContext,
  ExecutableToolResult,
  ToolExecution,
} from '../../../loop/types';
import { ToolAccesses } from '../../../loop/tool-access';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import type {
  SessionSubagentHost,
  SpawnSubagentOptions,
  SubagentHandle,
} from '../../../session/subagent/subagent-host';
import { createSessionWorktree } from '../../../session/worktree';
import type { Kaos } from '@superliora/kaos';

// ---------------------------------------------------------------------------
// Shared worker tracking
// ---------------------------------------------------------------------------

/** Structured result from a completed worker. */
export interface WorkerResult {
  /** Short summary of what was accomplished. */
  readonly summary: string;
  /** Files that were created or modified. */
  readonly filesModified: string[];
  /** Whether the worker considers its task successful. */
  readonly success: boolean;
  /** Raw result text from the subagent completion. */
  readonly raw: string;
}

/** Runtime worker record tracked by the orchestrator. */
export interface OrchestratorWorker {
  readonly id: string;
  readonly agentId: string;
  readonly description: string;
  readonly worktreePath?: string;
  status: 'running' | 'completed' | 'failed';
  readonly createdAt: number;
  result?: string;
  /** Parsed structured result, populated on completion. */
  structuredResult?: WorkerResult;
  handle?: SubagentHandle;
  /** Queued follow-up tasks to execute after the current one completes. */
  taskQueue: string[];
  /** Declared file/directory ownership for conflict detection. */
  readonly ownership: string[];
  /** Worker IDs this worker depends on. Spawning is deferred until all complete. */
  readonly dependsOn: string[];
  /** Git branch name for the worker's worktree (e.g. liora/orch-worker-1). */
  branch?: string;
  /** Repository root path for merge operations. */
  repoRoot?: string;
  /** Token usage accumulated by this worker. */
  tokenUsage?: { input: number; output: number; cacheRead: number; cacheCreation: number };
}

// ---------------------------------------------------------------------------
// SpawnWorkerTool
// ---------------------------------------------------------------------------

const SpawnWorkerInputSchema = z.object({
  prompt: z.string().describe('Full task prompt for the worker.'),
  description: z.string().describe('Short task description (3-5 words) for display.'),
  ownership: z.array(z.string()).optional()
    .describe('File paths this worker owns. Other workers will not touch them.'),
  dependsOn: z.array(z.string()).optional()
    .describe('Worker IDs that must complete before this worker starts. Enables DAG scheduling.'),
});

type SpawnWorkerInput = z.infer<typeof SpawnWorkerInputSchema>;

export class SpawnWorkerTool implements BuiltinTool<SpawnWorkerInput> {
  readonly name = 'SpawnWorker';
  readonly description =
    'Compat Fleet path: spawn a background worker in an isolated git worktree. ' +
    'Prefer JobCreate on Conductor for new work. When toolStore is provided, registers a Job ledger entry. ' +
    'The worker runs asynchronously and reports back when done.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SpawnWorkerInputSchema);

  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly kaos: Kaos,
    private readonly repoPath: string,
    private readonly workers: Map<string, OrchestratorWorker>,
    private readonly onWorkerComplete?: (worker: OrchestratorWorker) => void,
    private readonly toolStore?: ToolStore,
  ) {}

  async resolveExecution(args: SpawnWorkerInput): Promise<ToolExecution> {
    return {
      description: `Spawn worker: ${args.description}`,
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: SpawnWorkerInput,
    ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    // Conductor bridge — ledger registration (non-fatal).
    if (this.toolStore !== undefined) {
      try {
        const { registerSpawnWorkerAsJob } = await import('../job/job-fleet-bridge');
        registerSpawnWorkerAsJob(this.toolStore, {
          prompt: args.prompt,
          title: args.description,
          ownershipPaths: args.ownership,
        });
      } catch {
        // ignore
      }
    }

    const workerId = `worker-${String(this.workers.size + 1)}`;

    // Check dependencies — defer spawning if any dependency is not yet completed.
    const deps = args.dependsOn ?? [];
    const unmet = deps.filter((depId) => {
      const dep = this.workers.get(depId);
      return dep === undefined || dep.status !== 'completed';
    });
    if (unmet.length > 0) {
      // Register as a pending worker; the completion handler will spawn it
      // once all dependencies resolve.
      const pending: OrchestratorWorker = {
        id: workerId,
        agentId: '',
        description: args.description,
        status: 'running',
        createdAt: Date.now(),
        taskQueue: [],
        ownership: args.ownership ?? [],
        dependsOn: deps,
      };
      this.workers.set(workerId, pending);
      return {
        output: `Worker ${workerId} registered but deferred — waiting for: ${unmet.join(', ')}. ` +
          'It will start automatically when all dependencies complete.',
      };
    }

    // Create an isolated worktree for this worker.
    let worktreePath: string | undefined;
    let worktreeBranch: string | undefined;
    let worktreeRepoRoot: string | undefined;
    try {
      const worktree = await createSessionWorktree(this.kaos, {
        repoPath: this.repoPath,
        name: workerId,
      });
      worktreePath = worktree.workDir;
      worktreeBranch = worktree.meta.branch;
      worktreeRepoRoot = worktree.meta.repoRoot;
    } catch {
      // Worktree creation failed — fall back to shared workspace.
    }

    // Spawn the background agent.
    const spawnOptions: SpawnSubagentOptions = {
      parentToolCallId: ctx.toolCallId,
      prompt: args.prompt,
      description: args.description,
      runInBackground: true,
      signal: ctx.signal,
      ownership: args.ownership,
      profileName: 'coder',
    };

    const handle = await this.subagentHost.spawn(spawnOptions);

    const worker: OrchestratorWorker = {
      id: workerId,
      agentId: handle.agentId,
      description: args.description,
      worktreePath,
      status: 'running',
      createdAt: Date.now(),
      handle,
      taskQueue: [],
      ownership: args.ownership ?? [],
      dependsOn: args.dependsOn ?? [],
      branch: worktreeBranch,
      repoRoot: worktreeRepoRoot,
    };
    this.workers.set(workerId, worker);

    // Track completion asynchronously.
    void handle.completion.then((completion) => {
      worker.status = 'completed';
      worker.result = completion.result;
      worker.structuredResult = parseWorkerResult(completion.result, true);
      if (completion.usage !== undefined) {
        worker.tokenUsage = {
          input: completion.usage.inputOther,
          output: completion.usage.output,
          cacheRead: completion.usage.inputCacheRead,
          cacheCreation: completion.usage.inputCacheCreation,
        };
      }
      this.onWorkerComplete?.(worker);
    }).catch(() => {
      worker.status = 'failed';
      worker.structuredResult = parseWorkerResult(undefined, false);
      this.onWorkerComplete?.(worker);
    });

    const parts = [
      `Worker ${workerId} spawned (agent: ${handle.agentId}).`,
      worktreePath !== undefined
        ? `Isolated worktree: ${worktreePath}.`
        : 'Shared workspace (worktree unavailable).',
      'Running in background. Use QueryWorker to check progress.',
    ];

    return { output: parts.join(' ') };
  }
}

// ---------------------------------------------------------------------------
// SteerWorkerTool
// ---------------------------------------------------------------------------

const SteerWorkerInputSchema = z.object({
  workerId: z.string().describe('The worker to steer (e.g. "worker-1").'),
  instruction: z.string().describe('The instruction to inject into the running worker.'),
});

type SteerWorkerInput = z.infer<typeof SteerWorkerInputSchema>;

export class SteerWorkerTool implements BuiltinTool<SteerWorkerInput> {
  readonly name = 'SteerWorker';
  readonly description =
    'Inject an instruction into a running background worker. ' +
    'The worker will adjust its current work based on the instruction.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SteerWorkerInputSchema);

  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly workers: Map<string, OrchestratorWorker>,
  ) {}

  async resolveExecution(args: SteerWorkerInput): Promise<ToolExecution> {
    return {
      description: `Steer ${args.workerId}`,
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      execute: () => this.execution(args),
    };
  }

  private async execution(args: SteerWorkerInput): Promise<ExecutableToolResult> {
    const worker = this.workers.get(args.workerId);

    if (worker === undefined) {
      return {
        output: `Worker "${args.workerId}" not found. Use QueryWorker to list active workers.`,
        isError: true,
      };
    }

    if (worker.status !== 'running') {
      return {
        output: `Worker "${args.workerId}" is ${worker.status}. Cannot steer a finished worker.`,
        isError: true,
      };
    }

    const delivered = this.subagentHost.steerChild(worker.agentId, [
      { type: 'text', text: args.instruction },
    ]);

    if (delivered) {
      return {
        output: `Instruction delivered to ${args.workerId}: "${args.instruction}". ` +
          'The worker will adjust its work at the next step boundary.',
      };
    }

    return {
      output: `Worker ${args.workerId} is running but has no active turn to steer. ` +
        'The instruction could not be delivered right now.',
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// QueryWorkerTool
// ---------------------------------------------------------------------------

const QueryWorkerInputSchema = z.object({
  workerId: z.string().optional()
    .describe('Specific worker to query. Omit to list all workers.'),
});

type QueryWorkerInput = z.infer<typeof QueryWorkerInputSchema>;

export class QueryWorkerTool implements BuiltinTool<QueryWorkerInput> {
  readonly name = 'QueryWorker';
  readonly description =
    'Query the status of background workers. ' +
    'Omit workerId to list all workers. Provide a workerId for detailed status.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(QueryWorkerInputSchema);

  constructor(
    private readonly workers: Map<string, OrchestratorWorker>,
  ) {}

  async resolveExecution(args: QueryWorkerInput): Promise<ToolExecution> {
    return {
      description: args.workerId !== undefined ? `Query ${args.workerId}` : 'Query all workers',
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      execute: () => this.execution(args),
    };
  }

  private async execution(args: QueryWorkerInput): Promise<ExecutableToolResult> {
    if (args.workerId !== undefined) {
      const worker = this.workers.get(args.workerId);
      if (worker === undefined) {
        return { output: `Worker "${args.workerId}" not found.`, isError: true };
      }
      const lines = [
        `Worker: ${worker.id}`,
        `Description: ${worker.description}`,
        `Status: ${worker.status}`,
        `Agent: ${worker.agentId}`,
        worker.worktreePath !== undefined ? `Worktree: ${worker.worktreePath}` : null,
        worker.ownership.length > 0 ? `Ownership: ${worker.ownership.join(', ')}` : null,
        worker.taskQueue.length > 0 ? `Queued tasks: ${String(worker.taskQueue.length)}` : null,
        worker.tokenUsage !== undefined
          ? `Tokens: ${String(worker.tokenUsage.input)} in / ${String(worker.tokenUsage.output)} out / ${String(worker.tokenUsage.cacheRead)} cached`
          : null,
        worker.result !== undefined ? `Result: ${worker.result.slice(0, 2000)}` : null,
      ].filter(Boolean);
      return { output: lines.join('\n') };
    }

    if (this.workers.size === 0) {
      return { output: 'No workers have been spawned yet.' };
    }

    const lines = [...this.workers.values()].map((w) => {
      const elapsed = Math.round((Date.now() - w.createdAt) / 1000);
      const loc = w.worktreePath !== undefined ? ` @ ${w.worktreePath}` : '';
      return `  ${w.id}: [${w.status}] ${w.description} (${String(elapsed)}s)${loc}`;
    });

    return { output: `Workers (${String(this.workers.size)}):\n${lines.join('\n')}` };
  }
}

// ---------------------------------------------------------------------------
// Result parsing
// ---------------------------------------------------------------------------

/** Extract file paths mentioned in the result text. */
const FILE_PATH_RE = /(?:^|\s)([\w./-]+\.\w{1,6})(?:\s|$|[,;:])/g;

/**
 * Parse a raw worker completion result into a structured summary.
 * File paths are extracted heuristically from the result text.
 */
function parseWorkerResult(raw: string | undefined, success: boolean): WorkerResult {
  const text = raw ?? '';
  const filesModified: string[] = [];
  for (const match of text.matchAll(FILE_PATH_RE)) {
    const candidate = match[1];
    if (candidate !== undefined && !filesModified.includes(candidate)) {
      filesModified.push(candidate);
    }
  }
  const summary = text.length > 0
    ? text.slice(0, 300).replaceAll(/\n/g, ' ').trim()
    : success ? 'Completed successfully.' : 'Worker failed.';
  return { summary, filesModified, success, raw: text };
}

// ---------------------------------------------------------------------------
// EnqueueWorkerTaskTool
// ---------------------------------------------------------------------------

const EnqueueWorkerTaskInputSchema = z.object({
  workerId: z.string().describe('The worker to enqueue the task for.'),
  task: z.string().describe('The task prompt to queue. It will run after the current task completes.'),
});

type EnqueueWorkerTaskInput = z.infer<typeof EnqueueWorkerTaskInputSchema>;

export class EnqueueWorkerTaskTool implements BuiltinTool<EnqueueWorkerTaskInput> {
  readonly name = 'EnqueueWorkerTask';
  readonly description =
    'Queue a follow-up task for a worker. When the worker finishes its current task, ' +
    'the queued task is automatically spawned as a new worker in the same worktree. ' +
    'Use this for sequential "do X, then Y" workflows.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(EnqueueWorkerTaskInputSchema);

  constructor(private readonly workers: Map<string, OrchestratorWorker>) {}

  async resolveExecution(args: EnqueueWorkerTaskInput): Promise<ToolExecution> {
    return {
      description: `Enqueue task for ${args.workerId}`,
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      execute: () => this.execution(args),
    };
  }

  private async execution(args: EnqueueWorkerTaskInput): Promise<ExecutableToolResult> {
    const worker = this.workers.get(args.workerId);

    if (worker === undefined) {
      return {
        output: `Worker "${args.workerId}" not found. Use QueryWorker to list active workers.`,
        isError: true,
      };
    }

    worker.taskQueue.push(args.task);
    const position = worker.taskQueue.length;

    return {
      output: `Task queued for ${args.workerId} (position ${String(position)}). ` +
        `It will run after the current task and ${String(position - 1)} queued task(s) complete.`,
    };
  }
}

// ---------------------------------------------------------------------------
// MergeWorkerTool
// ---------------------------------------------------------------------------

const MergeWorkerInputSchema = z.object({
  workerId: z.string().describe('The completed worker whose worktree branch should be merged.'),
});

type MergeWorkerInput = z.infer<typeof MergeWorkerInputSchema>;

export class MergeWorkerTool implements BuiltinTool<MergeWorkerInput> {
  readonly name = 'MergeWorker';
  readonly description =
    'Merge a completed worker\'s worktree branch back into the main branch. ' +
    'Use this after a worker finishes to integrate its changes. ' +
    'Reports merge conflicts if any files were modified by multiple workers.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(MergeWorkerInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workers: Map<string, OrchestratorWorker>,
  ) {}

  async resolveExecution(args: MergeWorkerInput): Promise<ToolExecution> {
    return {
      description: `Merge ${args.workerId}`,
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      execute: () => this.execution(args),
    };
  }

  private async execution(args: MergeWorkerInput): Promise<ExecutableToolResult> {
    const worker = this.workers.get(args.workerId);

    if (worker === undefined) {
      return {
        output: `Worker "${args.workerId}" not found. Use QueryWorker to list workers.`,
        isError: true,
      };
    }

    if (worker.status !== 'completed') {
      return {
        output: `Worker "${args.workerId}" is ${worker.status}. Only completed workers can be merged.`,
        isError: true,
      };
    }

    if (worker.branch === undefined || worker.repoRoot === undefined) {
      return {
        output: `Worker "${args.workerId}" has no worktree branch. It may have run in the shared workspace.`,
        isError: true,
      };
    }

    const { runGit } = await import('#/autopilot/git');
    const result = await runGit(this.kaos, worker.repoRoot, ['merge', worker.branch, '--no-edit']);

    if (result.ok) {
      return {
        output: `Successfully merged ${worker.branch} into the main branch.\n${result.stdout}`,
      };
    }

    return {
      output: `Merge conflict detected for ${worker.branch}:\n${result.stderr}\n` +
        'Resolve conflicts manually or use SteerWorker to have the worker rebase.',
      isError: true,
    };
  }
}

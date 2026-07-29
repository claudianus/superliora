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
import type {
  SessionSubagentHost,
  SpawnSubagentOptions,
  SubagentHandle,
} from '../../../session/subagent-host';
import { createSessionWorktree } from '../../../session/worktree';
import type { Kaos } from '@superliora/kaos';

// ---------------------------------------------------------------------------
// Shared worker tracking
// ---------------------------------------------------------------------------

/** Runtime worker record tracked by the orchestrator. */
export interface OrchestratorWorker {
  readonly id: string;
  readonly agentId: string;
  readonly description: string;
  readonly worktreePath?: string;
  status: 'running' | 'completed' | 'failed';
  readonly createdAt: number;
  result?: string;
  handle?: SubagentHandle;
  /** Queued follow-up tasks to execute after the current one completes. */
  taskQueue: string[];
}

// ---------------------------------------------------------------------------
// SpawnWorkerTool
// ---------------------------------------------------------------------------

const SpawnWorkerInputSchema = z.object({
  prompt: z.string().describe('Full task prompt for the worker.'),
  description: z.string().describe('Short task description (3-5 words) for display.'),
  ownership: z.array(z.string()).optional()
    .describe('File paths this worker owns. Other workers will not touch them.'),
});

type SpawnWorkerInput = z.infer<typeof SpawnWorkerInputSchema>;

export class SpawnWorkerTool implements BuiltinTool<SpawnWorkerInput> {
  readonly name = 'SpawnWorker';
  readonly description =
    'Spawn a background worker agent in an isolated git worktree. ' +
    'The worker runs asynchronously and reports back when done. ' +
    'Use this for all real implementation work — the orchestrator never edits files directly.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SpawnWorkerInputSchema);

  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly kaos: Kaos,
    private readonly repoPath: string,
    private readonly workers: Map<string, OrchestratorWorker>,
    private readonly onWorkerComplete?: (worker: OrchestratorWorker) => void,
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
    const workerId = `worker-${String(this.workers.size + 1)}`;

    // Create an isolated worktree for this worker.
    let worktreePath: string | undefined;
    try {
      const worktree = await createSessionWorktree(this.kaos, {
        repoPath: this.repoPath,
        name: workerId,
      });
      worktreePath = worktree.workDir;
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
    };
    this.workers.set(workerId, worker);

    // Track completion asynchronously.
    void handle.completion.then((completion) => {
      worker.status = 'completed';
      worker.result = completion.result;
      this.onWorkerComplete?.(worker);
    }).catch(() => {
      worker.status = 'failed';
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

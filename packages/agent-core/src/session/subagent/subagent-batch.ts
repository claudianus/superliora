import { isAbortError } from '../../loop/errors';
import { isUserCancellation } from '../../utils/abort';
import { classifySubagentFailureReason } from './subagent-batch-failure';
import type {
  QueuedSubagentTask,
  SubagentBatchLauncher,
  SubagentBatchOptions,
  SubagentResult,
} from './subagent-batch-types';

export type {
  QueuedSubagentTask,
  ResumeQueuedSubagentTask,
  SpawnQueuedSubagentTask,
  SubagentBatchLauncher,
  SubagentBatchOptions,
  SubagentResult,
} from './subagent-batch-types';
export { classifySubagentFailureReason } from './subagent-batch-failure';
export { DEFAULT_SWARM_MAX_CONCURRENCY, resolveSwarmMaxConcurrency } from './subagent-batch-concurrency';

const UNSIGNALLED = new AbortController().signal;

/** Bounded launching only: failed turns are never automatically replayed. */
export class SubagentBatch<T> {
  private started = false;

  constructor(
    private readonly launcher: SubagentBatchLauncher,
    private readonly tasks: readonly QueuedSubagentTask<T>[],
    private readonly options: SubagentBatchOptions = {},
  ) {}

  async run(): Promise<Array<SubagentResult<T>>> {
    if (this.started) throw new Error('SubagentBatch.run() can only be called once.');
    this.started = true;
    if (this.tasks.length === 0) return [];
    const results: Array<SubagentResult<T>> = [];
    let next = 0;
    const capacity = Math.max(1, Math.min(this.options.maxConcurrency ?? this.tasks.length, this.tasks.length));
    const consume = async (): Promise<void> => {
      while (next < this.tasks.length) {
        const index = next++;
        const task = this.tasks[index]!;
        results[index] = await this.runTask(task);
      }
    };
    await Promise.all(Array.from({ length: capacity }, consume));
    return results;
  }

  private async runTask(task: QueuedSubagentTask<T>): Promise<SubagentResult<T>> {
    const signal = task.signal ?? UNSIGNALLED;
    let agentId: string | undefined;
    let started = false;
    try {
      signal.throwIfAborted();
      const options = {
        parentToolCallId: task.parentToolCallId,
        parentToolCallUuid: task.parentToolCallUuid,
        prompt: task.prompt,
        description: task.description,
        swarmIndex: task.swarmIndex,
        swarmItem: task.swarmItem,
        runInBackground: task.runInBackground,
        signal,
        timeoutMs: task.timeout,
        worktreeDir: task.worktreeDir,
        ownership: task.ownership,
        modelAlias: task.modelAlias,
        permissionMode: task.permissionMode,
      };
      const handle = task.kind === 'resume'
        ? await this.launcher.resume(task.resumeAgentId, options)
        : await this.launcher.spawn({ ...options, profileName: task.profileName });
      agentId = handle.agentId;
      started = true;
      const completion = await handle.completion;
      signal.throwIfAborted();
      return {
        task,
        agentId,
        status: 'completed',
        state: 'started',
        result: completion.result,
        usage: completion.usage,
        filesChanged: completion.filesChanged,
        context: completion.context,
      };
    } catch (error) {
      const status = signal.aborted || isAbortError(error) || isUserCancellation(error) ? 'aborted' : 'failed';
      return {
        task,
        agentId,
        status,
        state: started ? 'started' : 'not_started',
        error: error instanceof Error ? error.message : String(error),
        failureReason: classifySubagentFailureReason(error, status),
      };
    }
  }
}

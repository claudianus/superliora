/**
 * Orchestrator mode: system prompt prefix + tool registration.
 * Extracted from Agent class to reduce God Class size.
 */
import { log } from '#/logging/logger';
import {
  EnqueueWorkerTaskTool,
  MergeWorkerTool,
  QueryWorkerTool,
  SpawnWorkerTool,
  SteerWorkerTool,
} from '../tools/builtin/collaboration/orchestrator';
import type { SessionSubagentHost } from '../session/subagent/subagent-host';
import type { Agent } from './index';

export const ORCHESTRATOR_SYSTEM_PREFIX = `# Orchestrator Mode

You are running in orchestrator mode. Your role is to classify user intent,
delegate implementation work to background workers, and respond immediately.

## Rules

1. **Never perform long-running file operations yourself.** Do not edit files,
   run builds, execute tests, or perform any task that takes more than a few
   seconds. Delegate all such work to workers.

2. **Use SpawnWorker** to create background workers for implementation tasks.
   Each worker runs in an isolated git worktree. Provide a clear, specific
   prompt describing exactly what the worker should do.

3. **Use QueryWorker** to check on worker progress and retrieve results.
   Poll workers periodically or when the user asks about status.

4. **Use SteerWorker** to redirect a worker that is going off track or to
   provide additional guidance mid-task.

5. **Respond to the user immediately** after spawning workers. Acknowledge
   what you delegated and let the user know you will report back when workers
   complete. Do not wait for workers to finish before responding.

6. **Merge results** when workers complete. Review their output, resolve any
   conflicts, and present a unified summary to the user.

`;

export function registerOrchestratorTools(agent: Agent, host: SessionSubagentHost): void {
  const workers = agent.orchestratorWorkers;
  agent.tools.attachEphemeralBuiltin(
    new SpawnWorkerTool(host, agent.kaos, agent.kaos.getcwd(), workers, (worker) => {
      log.info(
        `Orchestrator worker ${worker.id} (${worker.description}) ${worker.status}` +
          (worker.result !== undefined ? `: ${worker.result.slice(0, 200)}` : ''),
      );
      // Auto-spawn the next queued task if any.
      const nextTask = worker.taskQueue.shift();
      if (nextTask !== undefined && worker.status === 'completed') {
        log.info(`Orchestrator auto-spawning queued task for ${worker.id}`);
        const spawner = new SpawnWorkerTool(host, agent.kaos, agent.kaos.getcwd(), workers);
        const context = worker.structuredResult !== undefined
          ? `\n\nPrevious task result:\n${worker.structuredResult.summary}` +
            (worker.structuredResult.filesModified.length > 0
              ? `\nFiles modified: ${worker.structuredResult.filesModified.join(', ')}`
              : '')
          : '';
        void spawner.resolveExecution({
          prompt: nextTask + context,
          description: `${worker.description} (follow-up)`,
        }).then((execution) => {
          if ('execute' in execution) {
            return execution.execute({
              turnId: '0',
              toolCallId: `queue-${worker.id}-${Date.now()}`,
              signal: new AbortController().signal,
            });
          }
        });
      }
      // Resolve pending workers whose dependencies are now all completed.
      for (const [, pending] of workers) {
        if (pending.agentId !== '' || pending.dependsOn.length === 0) continue;
        const allMet = pending.dependsOn.every((depId) => {
          const dep = workers.get(depId);
          return dep !== undefined && dep.status === 'completed';
        });
        if (!allMet) continue;
        log.info(`Orchestrator resolving deferred worker ${pending.id}`);
        const spawner = new SpawnWorkerTool(host, agent.kaos, agent.kaos.getcwd(), workers);
        void spawner.resolveExecution({
          prompt: pending.description,
          description: pending.description,
          ownership: pending.ownership.length > 0 ? pending.ownership : undefined,
        }).then((execution) => {
          if ('execute' in execution) {
            return execution.execute({
              turnId: '0',
              toolCallId: `dag-${pending.id}-${Date.now()}`,
              signal: new AbortController().signal,
            });
          }
        });
      }
      agent.emitStatusUpdated();
    }),
  );
  agent.tools.attachEphemeralBuiltin(new SteerWorkerTool(host, workers));
  agent.tools.attachEphemeralBuiltin(new QueryWorkerTool(workers));
  agent.tools.attachEphemeralBuiltin(new EnqueueWorkerTaskTool(workers));
  agent.tools.attachEphemeralBuiltin(new MergeWorkerTool(agent.kaos, workers));
}

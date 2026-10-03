import type { Logger } from '#/logging/types';
import { Agent } from '../../agent';
import { closeJobRuntime } from '../job/job-offload';
import { waitForJobScheduling } from '../../tools/builtin/job/job-runtime';
import { interruptRunningJobs } from '../../tools/builtin/job/job-worker';
import { jobResourceErrors } from '../../tools/builtin/job/job-native-resources';
import { abortError } from '../../utils/abort';

type AgentEntry = Agent | Promise<{ readonly agent: Agent; readonly warning?: string }>;

export interface SessionCloseLifecycleOptions {
  readonly log: Logger;
  readonly agents: Map<string, AgentEntry>;
  readonly readyAgents: () => Iterable<Agent>;
}

export class SessionCloseLifecycle {
  constructor(private readonly opts: SessionCloseLifecycleOptions) {}

  requestClose(): void {
    for (const agent of this.opts.readyAgents()) {
      if (agent.type === 'main') closeJobRuntime(agent.tools.getStore());
      agent.turn.cancel(undefined, abortError('Session closed'), 'session-close');
      agent.fullCompaction.cancel();
    }
  }

  async interruptJobsOnClose(): Promise<void> {
    const results = await Promise.allSettled(Array.from(this.opts.readyAgents(), async (agent) => {
      if (agent.type !== 'main') return;
      const store = agent.tools.getStore();
      closeJobRuntime(store);
      const errors: unknown[] = [];
      try {
        await waitForJobScheduling(store);
      } catch (error) {
        errors.push(error);
      }
      try {
        await interruptRunningJobs({ store, agent, reason: 'session closed' });
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) throw jobResourceErrors(errors, 'Job scheduling and worker shutdown failed.');
    }));
    const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (errors.length > 0) throw jobResourceErrors(errors, 'Job shutdown failed.');
  }

  async cancelActiveTurnsOnClose(): Promise<void> {
    const backgroundAgentIds = this.activeBackgroundAgentIds();
    await Promise.allSettled(Array.from(this.opts.agents, async ([agentId, entry]) => {
      const agent = entry instanceof Agent ? entry : (await entry).agent;
      if (backgroundAgentIds.has(agentId)) return;
      const turn = agent.turn.hasActiveTurn ? agent.turn.waitForCurrentTurn() : undefined;
      agent.turn.cancel(undefined, abortError('Session closed'), 'session-close');
      agent.fullCompaction.cancel();
      await Promise.allSettled([turn, agent.fullCompaction.waitUntilSettled()]);
    }));
  }

  async stopBackgroundTasksOnExit(): Promise<void> {
    const results = await Promise.allSettled(Array.from(this.opts.agents.values(), async (entry) => {
      const result = entry instanceof Agent ? { agent: entry } : await entry.catch(() => undefined);
      if (result === undefined) return;
      const { agent } = result;
      await agent.background.stopAll('Session closed');
    }));
    const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (errors.length > 0) throw new AggregateError(errors, 'Background shutdown failed.');
  }

  private activeBackgroundAgentIds(): Set<string> {
    const ids = new Set<string>();
    for (const agent of this.opts.readyAgents()) {
      for (const task of agent.background.list(true)) {
        if (task.kind === 'agent' && task.detached !== false && task.agentId !== undefined) ids.add(task.agentId);
      }
    }
    return ids;
  }
}

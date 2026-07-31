/**
 * Session close lifecycle — extracted from Session class.
 *
 * Cancels active turns and stops background tasks during graceful shutdown.
 */

import type { BackgroundConfig } from '../../config';
import { parseBooleanEnv, resolveConfigValue } from '../../config';
import type { Logger } from '#/logging/types';
import { Agent } from '../../agent';
import { abortError } from '../../utils/abort';

const BACKGROUND_KEEP_ALIVE_ON_EXIT_ENV = 'SUPERLIORA_BACKGROUND_KEEP_ALIVE_ON_EXIT';
export const ACTIVE_TURN_CLOSE_TIMEOUT_MS = 8_000;

type AgentEntry = Agent | Promise<{ readonly agent: Agent; readonly warning?: string }>;

export interface SessionCloseLifecycleOptions {
  readonly log: Logger;
  readonly agents: Map<string, AgentEntry>;
  readonly readyAgents: () => Iterable<Agent>;
  readonly background: BackgroundConfig | undefined;
}

export async function waitForSettlementOrTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export class SessionCloseLifecycle {
  constructor(private readonly opts: SessionCloseLifecycleOptions) {}

  async cancelActiveTurnsOnClose(): Promise<void> {
    const backgroundAgentIds = this.activeBackgroundAgentIds();
    const cancellations: Array<Promise<void>> = [];
    for (const [agentId, entry] of this.opts.agents) {
      if (!(entry instanceof Agent) || backgroundAgentIds.has(agentId)) continue;
      cancellations.push(this.cancelAgentTurnOnClose(entry));
    }
    await Promise.allSettled(cancellations);
  }

  async stopBackgroundTasksOnExit(): Promise<void> {
    const keepAliveOnExit = resolveConfigValue({
      env: process.env,
      envKey: BACKGROUND_KEEP_ALIVE_ON_EXIT_ENV,
      configValue: this.opts.background?.keepAliveOnExit,
      defaultValue: false,
      parseEnv: parseBooleanEnv,
    });
    if (keepAliveOnExit) return;
    // Include agents that were never lazily resumed — their entry is still a
    // pending Promise. Resolve each (bounded by a short timeout so a stuck
    // resume can't hang shutdown) so detached background tasks they hold are
    // stopped too, instead of leaking past session close.
    const entries = Array.from(this.opts.agents.values());
    const resolved = await Promise.all(
      entries.map(async (entry): Promise<Agent | undefined> => {
        if (entry instanceof Agent) return entry;
        try {
          return await Promise.race([
            entry.then((r) => r.agent),
            new Promise<undefined>((resolve) => {
              const t = setTimeout(() =>{  resolve(undefined); }, 2_000);
              t.unref?.();
            }),
          ]);
        } catch {
          return undefined;
        }
      }),
    );
    await Promise.all(
      resolved.map(async (agent) => {
        if (agent === undefined) return;
        const activeTasks = agent.background.list(true);
        await Promise.all(
          activeTasks.map((task) =>
            agent.background.suppressTerminalNotification(task.taskId),
          ),
        );
        await agent.background.stopAll('Session closed');
      }),
    );
  }

  private activeBackgroundAgentIds(): Set<string> {
    const agentIds = new Set<string>();
    for (const agent of this.opts.readyAgents()) {
      for (const task of agent.background.list(true)) {
        if (task.kind === 'agent' && task.agentId !== undefined && task.detached !== false) {
          agentIds.add(task.agentId);
        }
      }
    }
    return agentIds;
  }

  private async cancelAgentTurnOnClose(agent: Agent): Promise<void> {
    if (!agent.turn.hasActiveTurn) return;

    let waitForTurn: Promise<unknown>;
    try {
      waitForTurn = agent.turn.waitForCurrentTurn();
    } catch (error: unknown) {
      this.opts.log.debug('active turn wait unavailable during session close', {
        agentType: agent.type,
        agentHomedir: agent.homedir,
        error,
      });
      return;
    }

    agent.turn.cancel(undefined, abortError('Session closed'), 'session-close');
    const settled = await waitForSettlementOrTimeout(waitForTurn, ACTIVE_TURN_CLOSE_TIMEOUT_MS);
    if (!settled) {
      this.opts.log.warn('timed out waiting for active turn to cancel during session close', {
        agentType: agent.type,
        agentHomedir: agent.homedir,
        timeoutMs: ACTIVE_TURN_CLOSE_TIMEOUT_MS,
      });
    }
  }
}

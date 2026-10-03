import { setTimeout as delay } from 'node:timers/promises';

import type { KaosProcess } from '@superliora/kaos';
import { vi } from 'vitest';

import {
  AgentBackgroundTask,
  BackgroundManager,
  BackgroundTaskPersistence,
  ProcessBackgroundTask,
  type BackgroundTaskInfo,
} from '../../../src/agent/background';
import type { SessionSubagentHost, SubagentCompletion, SubagentHandle } from '../../../src/session/subagent/subagent-host';
import type { AgentEvent } from '../../../src/rpc/events';
import { testAgent } from '../harness/agent';

export function createBackgroundManager(options: {
  sessionDir?: string;
  maxRunningTasks?: number;
} = {}) {
  const ctx = testAgent({
    initialConfig: {
      providers: {},
      ...(options.maxRunningTasks === undefined
        ? {}
        : { background: { maxRunningTasks: options.maxRunningTasks } }),
    },
  });
  const emittedEvents: AgentEvent[] = [];
  const emitEvent = vi.spyOn(ctx.agent, 'emitEvent').mockImplementation((event) => {
    emittedEvents.push(event);
  });
  const track = vi.spyOn(ctx.agent.telemetry, 'track').mockImplementation(() => {});
  const persistence = options.sessionDir === undefined
    ? undefined
    : new BackgroundTaskPersistence(options.sessionDir);
  return {
    agent: Object.assign(ctx.agent, {
      emittedEvents,
      emitEvent,
      telemetry: Object.assign(ctx.agent.telemetry, { track }),
    }),
    manager: new BackgroundManager(ctx.agent, persistence),
    persistence,
  };
}

export function registerProcess(
  manager: BackgroundManager,
  proc: KaosProcess,
  command: string,
  description: string,
): string {
  return manager.registerTask(new ProcessBackgroundTask(proc, command, description, manager.agent.kaos.getcwd()));
}

export function agentTask(
  completion: Promise<SubagentCompletion>,
  description: string,
  options: {
    readonly agentId?: string;
    readonly subagentType?: string;
    readonly subagentHost?: Pick<SessionSubagentHost, 'markActiveChildDetached'>;
    readonly abortController?: AbortController;
  } = {},
): AgentBackgroundTask {
  const handle: SubagentHandle = {
    agentId: options.agentId ?? 'agent-child',
    profileName: options.subagentType ?? 'agent',
    resumed: false,
    completion,
  };
  return new AgentBackgroundTask(
    handle,
    description,
    options.subagentHost ?? { markActiveChildDetached: vi.fn() },
    options.abortController ?? new AbortController(),
  );
}

export async function waitForTerminal(
  manager: BackgroundManager,
  taskId: string,
  timeoutMs = 30_000,
): Promise<BackgroundTaskInfo | undefined> {
  return manager.wait(taskId, timeoutMs);
}

export async function waitForOutput(
  manager: BackgroundManager,
  taskId: string,
  expected: string,
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const output = await manager.readOutput(taskId);
    if (output.includes(expected)) return;
    await delay(5);
  }
  throw new Error(`Timed out waiting for output: ${expected}`);
}

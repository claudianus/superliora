import type { SubagentHandle, RunSubagentOptions, SpawnSubagentOptions } from '../session/subagent/subagent-host';

export interface FanoutTask {
  readonly prompt: string;
  readonly description: string;
  readonly profileName?: 'agent';
  readonly ownership?: readonly string[];
  readonly worktreeDir?: string;
  readonly modelAlias?: string;
  readonly permissionMode?: 'yolo' | 'auto' | 'manual';
  readonly resumeAgentId?: string;
  readonly swarmIndex?: number;
  readonly swarmItem?: string;
}

export interface FanoutSpec {
  readonly parentToolCallId: string;
  readonly parentToolCallUuid?: string;
  readonly runInBackground: boolean;
  readonly signal: AbortSignal;
  readonly tasks: readonly FanoutTask[];
  readonly timeoutMs?: number;
  readonly onReady?: () => void;
}

function runOptionsForTask(spec: FanoutSpec, task: FanoutTask): RunSubagentOptions {
  return {
    parentToolCallId: spec.parentToolCallId,
    parentToolCallUuid: spec.parentToolCallUuid,
    prompt: task.prompt,
    description: task.description,
    runInBackground: spec.runInBackground,
    signal: spec.signal,
    timeoutMs: spec.timeoutMs,
    onReady: spec.onReady,
    swarmIndex: task.swarmIndex,
    swarmItem: task.swarmItem,
    ownership: task.ownership,
    worktreeDir: task.worktreeDir,
    modelAlias: task.modelAlias,
    permissionMode: task.permissionMode,
  };
}

function spawnOptionsForTask(spec: FanoutSpec, task: FanoutTask): SpawnSubagentOptions {
  return { ...runOptionsForTask(spec, task), profileName: task.profileName };
}

export interface FanoutHost {
  spawn(options: SpawnSubagentOptions): Promise<SubagentHandle>;
  resume(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle>;
}

export function spawnOneAgent(host: FanoutHost, spec: FanoutSpec, task: FanoutTask): Promise<SubagentHandle> {
  return task.resumeAgentId !== undefined
    ? host.resume(task.resumeAgentId, runOptionsForTask(spec, task))
    : host.spawn(spawnOptionsForTask(spec, task));
}

export async function spawnAgents(host: FanoutHost, spec: FanoutSpec): Promise<readonly SubagentHandle[]> {
  const handles: SubagentHandle[] = [];
  for (const task of spec.tasks) handles.push(await spawnOneAgent(host, spec, task));
  return handles;
}

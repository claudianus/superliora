import type { SubagentHandle, RunSubagentOptions, SpawnSubagentOptions } from '../session/subagent/subagent-host';
import type {
  SubagentGoalBinding,
  SubagentPlanBinding,
} from '../session/subagent/subagent-host-types';

/**
 * Unified fan-out primitive (harness reform T4-1). Manual, template, and
 * expert fan-out all describe work through this spec so
 * runtime, events, leases, and the TUI only understand one shape. The three
 * tools stay as thin aliases that map their schemas onto a spec.
 */
export type FanoutMode = 'manual' | 'template' | 'expert';

export interface FanoutTask {
  readonly prompt: string;
  readonly description: string;
  readonly profileName: string;
  readonly ownership?: readonly string[];
  /** Isolated git worktree cwd for the worker (Conductor Jobs / fleet). */
  readonly worktreeDir?: string;
  /** Migrate a Goal onto the worker (goal-driver Jobs); it self-continues. */
  readonly goal?: SubagentGoalBinding;
  /** Activate plan mode on the worker (Plan Desk mission Jobs). */
  readonly plan?: SubagentPlanBinding;
  /** Force Premium Quality ON for UI-classified Conductor Jobs. */
  readonly forcePremiumQuality?: boolean;
  /** Prefer a vision-capable model for UI-classified Conductor Jobs. */
  readonly preferVisionModel?: boolean;
  /** Conductor-pinned worker model alias (JobCreate.model_alias). */
  readonly modelAlias?: string;
  /** Resume an existing agent instead of spawning (manual/template modes). */
  readonly resumeAgentId?: string;
  readonly swarmIndex?: number;
  readonly swarmItem?: string;
}

export interface FanoutSpec {
  readonly mode: FanoutMode;
  readonly parentToolCallId: string;
  readonly parentToolCallUuid?: string;
  readonly runInBackground: boolean;
  readonly signal: AbortSignal;
  readonly tasks: readonly FanoutTask[];
  readonly contractPath?: string;
  readonly timeoutMs?: number;
  readonly onReady?: () => void;
  readonly suppressRateLimitFailureEvent?: boolean;
}

/** Shared RunSubagentOptions fields every mode derives from the spec. */
export function baseRunOptions(spec: FanoutSpec): RunSubagentOptions {
  return {
    parentToolCallId: spec.parentToolCallId,
    parentToolCallUuid: spec.parentToolCallUuid,
    prompt: '',
    description: '',
    runInBackground: spec.runInBackground,
    signal: spec.signal,
    contractPath: spec.contractPath,
    timeoutMs: spec.timeoutMs,
    onReady: spec.onReady,
    suppressRateLimitFailureEvent: spec.suppressRateLimitFailureEvent,
  };
}

/** Map one spec task to the run/spawn options the host understands. */
export function runOptionsForTask(spec: FanoutSpec, task: FanoutTask): RunSubagentOptions {
  return {
    ...baseRunOptions(spec),
    prompt: task.prompt,
    description: task.description,
    swarmIndex: task.swarmIndex,
    swarmItem: task.swarmItem,
    ownership: task.ownership,
    worktreeDir: task.worktreeDir,
    goal: task.goal,
    plan: task.plan,
    forcePremiumQuality: task.forcePremiumQuality,
    preferVisionModel: task.preferVisionModel,
    modelAlias: task.modelAlias,
  };
}

export function spawnOptionsForTask(spec: FanoutSpec, task: FanoutTask): SpawnSubagentOptions {
  return {
    ...runOptionsForTask(spec, task),
    profileName: task.profileName,
  };
}

export interface FanoutHost {
  spawn(options: SpawnSubagentOptions): Promise<SubagentHandle>;
  resume(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle>;
}

/** Launch a single task (spawn or resume) through the shared wiring. */
export function spawnOneAgent(
  host: FanoutHost,
  spec: FanoutSpec,
  task: FanoutTask,
): Promise<SubagentHandle> {
  return task.resumeAgentId !== undefined
    ? host.resume(task.resumeAgentId, runOptionsForTask(spec, task))
    : host.spawn(spawnOptionsForTask(spec, task));
}

/**
 * Launch every task in a spec through one entry point. Resume tasks keep
 * their agent id; spawn tasks go through the host with the shared contract,
 * budget, and ownership wiring.
 */
export async function spawnAgents(
  host: FanoutHost,
  spec: FanoutSpec,
): Promise<readonly SubagentHandle[]> {
  const handles: SubagentHandle[] = [];
  for (const task of spec.tasks) {
    handles.push(await spawnOneAgent(host, spec, task));
  }
  return handles;
}

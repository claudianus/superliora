/**
 * MissionControlRegistry — pure data layer behind the Mission Control dock.
 * Merges the five worker event streams (`subagent.*` lifecycle + progress +
 * tool telemetry, `subagent.todo.updated`, `background.task.*`) into one
 * roster projection. No TUIState / component dependencies; the panel
 * component renders {@link MissionControlSnapshot} and the session-event
 * handler feeds events via {@link MissionControlRegistry.apply}.
 */

import type { Event } from '@superliora/sdk';

import { subagentToolDetailParts } from '../../utils/tools/subagent-tool-detail';

/** Completed workers linger this long so the operator sees the outcome. */
export const MISSION_COMPLETED_LINGER_MS = 12_000;
/** Ops-feed ring buffer cap (interleaved across all workers). */
export const MISSION_OPS_FEED_CAP = 40;

export type MissionWorkerStatus =
  | 'running'
  | 'stalled'
  | 'suspended'
  | 'finishing'
  | 'completed'
  | 'failed';

export type MissionWorkerKind = 'subagent' | 'background' | 'process';

export interface MissionWorker {
  readonly id: string;
  readonly name: string;
  readonly kind: MissionWorkerKind;
  readonly status: MissionWorkerStatus;
  readonly modelAlias?: string;
  readonly description?: string;
  readonly swarmIndex?: number;
  readonly runInBackground: boolean;
  readonly lastTool?: string;
  readonly lastTarget?: string;
  readonly toolCount: number;
  /** Aggregate tokens (input+output+cache) from the latest heartbeat. */
  readonly tokens: number;
  /** Wall-clock elapsed, derived at snapshot time. */
  readonly elapsedMs: number;
  readonly budgetMs?: number;
  readonly budgetRemainingMs?: number;
  readonly todoDone?: number;
  readonly todoTotal?: number;
  /** Current focus: `in_progress` title, else first `pending`. */
  readonly focusTodo?: string;
  readonly stalledSilentMs?: number;
  readonly error?: string;
  readonly terminalAtMs?: number;
  readonly lastActivityAtMs: number;
}

export interface MissionOpsEntry {
  readonly toolCallId: string;
  readonly workerId: string;
  readonly workerName: string;
  readonly name: string;
  readonly target?: string;
  readonly chip?: string;
  readonly status: 'running' | 'ok' | 'error';
  readonly atMs: number;
  readonly settledAtMs?: number;
}

export interface MissionControlSnapshot {
  /** Bumped on every mutation — render caches key on it. */
  readonly version: number;
  readonly workers: readonly MissionWorker[];
  readonly activeCount: number;
  /** Aggregate tokens across active workers. */
  readonly totalTokens: number;
  readonly ops: readonly MissionOpsEntry[];
}

interface MutableWorker {
  id: string;
  name: string;
  kind: MissionWorkerKind;
  status: MissionWorkerStatus;
  modelAlias?: string;
  description?: string;
  swarmIndex?: number;
  runInBackground: boolean;
  lastTool?: string;
  lastTarget?: string;
  toolCount: number;
  tokens: number;
  budgetMs?: number;
  budgetRemainingMs?: number;
  todoDone?: number;
  todoTotal?: number;
  focusTodo?: string;
  stalledSilentMs?: number;
  error?: string;
  spawnedAtMs: number;
  progressElapsedMs?: number;
  progressAtMs?: number;
  terminalAtMs?: number;
  lastActivityAtMs: number;
  /** Background task id once `background.task.started` correlates. */
  taskId?: string;
}

const ACTIVE_STATUSES: ReadonlySet<MissionWorkerStatus> = new Set([
  'running',
  'stalled',
  'suspended',
  'finishing',
]);

export class MissionControlRegistry {
  private readonly workers = new Map<string, MutableWorker>();
  private readonly ops: MissionOpsEntry[] = [];
  private version = 0;

  constructor(private readonly now: () => number = Date.now) {}

  reset(): void {
    this.workers.clear();
    this.ops.length = 0;
    this.version += 1;
  }

  /** Feed one session event; returns true when the roster projection changed. */
  apply(event: Event): boolean {
    switch (event.type) {
      case 'subagent.spawned':
        return this.applySpawned(event);
      case 'subagent.started':
        return this.touch(event.subagentId);
      case 'subagent.progress':
        return this.applyProgress(event);
      case 'subagent.stalled':
        return this.applyStalled(event);
      case 'subagent.suspended':
        return this.applyStatus(event.subagentId, 'suspended');
      case 'subagent.completed':
        return this.applyCompleted(event);
      case 'subagent.failed':
        return this.applyFailed(event);
      case 'subagent.tool_call':
        return this.applyToolCall(event);
      case 'subagent.tool_result':
        return this.applyToolResult(event);
      case 'subagent.todo.updated':
        return this.applyTodo(event);
      case 'background.task.started':
        return this.applyBackgroundStarted(event.info);
      case 'background.task.terminated':
        return this.applyBackgroundTerminated(event.info);
      default:
        return false;
    }
  }

  snapshot(nowMs: number = this.now()): MissionControlSnapshot {
    const workers: MissionWorker[] = [];
    let activeCount = 0;
    let totalTokens = 0;
    for (const worker of this.workers.values()) {
      if (
        worker.status === 'completed' &&
        worker.terminalAtMs !== undefined &&
        nowMs - worker.terminalAtMs > MISSION_COMPLETED_LINGER_MS
      ) {
        continue;
      }
      const active = ACTIVE_STATUSES.has(worker.status);
      if (active) {
        activeCount += 1;
        totalTokens += worker.tokens;
      }
      workers.push({
        id: worker.id,
        name: worker.name,
        kind: worker.kind,
        status: worker.status,
        ...(worker.modelAlias === undefined ? {} : { modelAlias: worker.modelAlias }),
        ...(worker.description === undefined ? {} : { description: worker.description }),
        ...(worker.swarmIndex === undefined ? {} : { swarmIndex: worker.swarmIndex }),
        runInBackground: worker.runInBackground,
        ...(worker.lastTool === undefined ? {} : { lastTool: worker.lastTool }),
        ...(worker.lastTarget === undefined ? {} : { lastTarget: worker.lastTarget }),
        toolCount: worker.toolCount,
        tokens: worker.tokens,
        elapsedMs: this.deriveElapsedMs(worker, nowMs),
        ...(worker.budgetMs === undefined ? {} : { budgetMs: worker.budgetMs }),
        ...(worker.budgetRemainingMs === undefined
          ? {}
          : { budgetRemainingMs: worker.budgetRemainingMs }),
        ...(worker.todoDone === undefined ? {} : { todoDone: worker.todoDone }),
        ...(worker.todoTotal === undefined ? {} : { todoTotal: worker.todoTotal }),
        ...(worker.focusTodo === undefined ? {} : { focusTodo: worker.focusTodo }),
        ...(worker.stalledSilentMs === undefined
          ? {}
          : { stalledSilentMs: worker.stalledSilentMs }),
        ...(worker.error === undefined ? {} : { error: worker.error }),
        ...(worker.terminalAtMs === undefined ? {} : { terminalAtMs: worker.terminalAtMs }),
        lastActivityAtMs: worker.lastActivityAtMs,
      });
    }
    workers.sort((a, b) => {
      const rank = (w: MissionWorker): number =>
        ACTIVE_STATUSES.has(w.status) ? 0 : w.status === 'failed' ? 1 : 2;
      return rank(a) - rank(b) || b.lastActivityAtMs - a.lastActivityAtMs;
    });
    return {
      version: this.version,
      workers,
      activeCount,
      totalTokens,
      ops: [...this.ops],
    };
  }

  private deriveElapsedMs(worker: MutableWorker, nowMs: number): number {
    if (worker.terminalAtMs !== undefined) {
      return Math.max(0, worker.terminalAtMs - worker.spawnedAtMs);
    }
    if (worker.progressElapsedMs !== undefined && worker.progressAtMs !== undefined) {
      return worker.progressElapsedMs + Math.max(0, nowMs - worker.progressAtMs);
    }
    return Math.max(0, nowMs - worker.spawnedAtMs);
  }

  private bump(): true {
    this.version += 1;
    return true;
  }

  private ensureWorker(
    id: string,
    init: Partial<MutableWorker> & { name: string },
  ): MutableWorker {
    const existing = this.workers.get(id);
    if (existing !== undefined) return existing;
    const atMs = this.now();
    const worker: MutableWorker = {
      kind: 'subagent',
      status: 'running',
      runInBackground: false,
      toolCount: 0,
      tokens: 0,
      spawnedAtMs: atMs,
      lastActivityAtMs: atMs,
      ...init,
      id,
    };
    this.workers.set(id, worker);
    return worker;
  }

  private touch(subagentId: string): boolean {
    const worker = this.workers.get(subagentId);
    if (worker === undefined) return false;
    worker.lastActivityAtMs = this.now();
    return this.bump();
  }

  private applySpawned(event: Extract<Event, { type: 'subagent.spawned' }>): boolean {
    const worker = this.ensureWorker(event.subagentId, {
      name: event.subagentName,
      kind: event.runInBackground ? 'background' : 'subagent',
      runInBackground: event.runInBackground,
      ...(event.modelAlias === undefined ? {} : { modelAlias: event.modelAlias }),
      ...(event.description === undefined ? {} : { description: event.description }),
    });
    worker.status = 'running';
    worker.lastActivityAtMs = this.now();
    return this.bump();
  }

  private applyProgress(event: Extract<Event, { type: 'subagent.progress' }>): boolean {
    const worker = this.ensureWorker(event.subagentId, {
      name: event.subagentName ?? event.subagentId,
    });
    if (event.subagentName !== undefined) worker.name = event.subagentName;
    worker.lastTool = event.lastTool ?? worker.lastTool;
    worker.lastTarget = event.lastTarget ?? worker.lastTarget;
    worker.toolCount = event.toolCount;
    worker.tokens = event.tokens;
    worker.progressElapsedMs = event.elapsedMs;
    worker.progressAtMs = this.now();
    worker.lastActivityAtMs = worker.progressAtMs;
    worker.budgetMs = event.budgetMs ?? worker.budgetMs;
    worker.budgetRemainingMs = event.budgetRemainingMs ?? worker.budgetRemainingMs;
    worker.stalledSilentMs = undefined;
    worker.status = event.finishing === true ? 'finishing' : 'running';
    return this.bump();
  }

  private applyStalled(event: Extract<Event, { type: 'subagent.stalled' }>): boolean {
    const worker = this.ensureWorker(event.subagentId, {
      name: event.subagentName ?? event.subagentId,
    });
    if (event.subagentName !== undefined) worker.name = event.subagentName;
    worker.status = 'stalled';
    worker.stalledSilentMs = event.silentMs;
    worker.toolCount = event.toolCount;
    worker.lastActivityAtMs = this.now();
    return this.bump();
  }

  private applyStatus(subagentId: string, status: MissionWorkerStatus): boolean {
    const worker = this.workers.get(subagentId);
    if (worker === undefined || worker.status === status) return false;
    worker.status = status;
    worker.lastActivityAtMs = this.now();
    return this.bump();
  }

  private applyCompleted(event: Extract<Event, { type: 'subagent.completed' }>): boolean {
    const worker = this.ensureWorker(event.subagentId, { name: event.subagentId });
    worker.status = 'completed';
    worker.terminalAtMs = this.now();
    worker.lastActivityAtMs = worker.terminalAtMs;
    if (event.usage !== undefined) {
      worker.tokens =
        event.usage.inputOther +
        event.usage.output +
        event.usage.inputCacheRead +
        event.usage.inputCacheCreation;
    }
    this.pruneLingered();
    return this.bump();
  }

  private applyFailed(event: Extract<Event, { type: 'subagent.failed' }>): boolean {
    const worker = this.ensureWorker(event.subagentId, { name: event.subagentId });
    worker.status = 'failed';
    worker.error = event.error;
    worker.terminalAtMs = this.now();
    worker.lastActivityAtMs = worker.terminalAtMs;
    this.pruneLingered();
    return this.bump();
  }

  private applyToolCall(event: Extract<Event, { type: 'subagent.tool_call' }>): boolean {
    const worker = this.ensureWorker(event.subagentId, {
      name: event.subagentName ?? event.subagentId,
    });
    if (event.subagentName !== undefined) worker.name = event.subagentName;
    const { target, chip } = subagentToolDetailParts(event.detail);
    const targetText = target ?? event.argsPreview;
    worker.lastTool = event.name;
    if (targetText !== undefined && targetText.length > 0) worker.lastTarget = targetText;
    worker.lastActivityAtMs = this.now();
    this.pushOps({
      toolCallId: event.toolCallId,
      workerId: worker.id,
      workerName: worker.name,
      name: event.name,
      ...(targetText === undefined || targetText.length === 0 ? {} : { target: targetText }),
      ...(chip === undefined ? {} : { chip }),
      status: 'running',
      atMs: worker.lastActivityAtMs,
    });
    return this.bump();
  }

  private applyToolResult(event: Extract<Event, { type: 'subagent.tool_result' }>): boolean {
    const atMs = this.now();
    const status = event.isError === true ? 'error' : 'ok';
    const entry = this.ops.find((candidate) => candidate.toolCallId === event.toolCallId);
    if (entry !== undefined) {
      const index = this.ops.indexOf(entry);
      this.ops[index] = {
        ...entry,
        ...(event.name !== undefined && event.name.length > 0 ? { name: event.name } : {}),
        status,
        settledAtMs: atMs,
      };
    } else {
      const worker = this.workers.get(event.subagentId);
      this.pushOps({
        toolCallId: event.toolCallId,
        workerId: event.subagentId,
        workerName: worker?.name ?? event.subagentId,
        name: event.name ?? 'tool',
        status,
        atMs,
        settledAtMs: atMs,
      });
    }
    const worker = this.workers.get(event.subagentId);
    if (worker !== undefined) worker.lastActivityAtMs = atMs;
    return this.bump();
  }

  private applyTodo(event: Extract<Event, { type: 'subagent.todo.updated' }>): boolean {
    const worker = this.ensureWorker(event.subagentId, { name: event.subagentName });
    worker.name = event.subagentName;
    worker.todoTotal = event.todos.length;
    worker.todoDone = event.todos.filter((todo) => todo.status === 'done').length;
    const inProgress = event.todos.find((todo) => todo.status === 'in_progress');
    const pending = event.todos.find((todo) => todo.status === 'pending');
    const focus = inProgress?.title ?? pending?.title;
    if (focus !== undefined && focus.length > 0) worker.focusTodo = focus;
    else delete worker.focusTodo;
    worker.lastActivityAtMs = this.now();
    return this.bump();
  }

  private applyBackgroundStarted(
    info: Extract<Event, { type: 'background.task.started' }>['info'],
  ): boolean {
    if (info.kind === 'question') return false;
    if (info.kind === 'agent' && info.agentId !== undefined) {
      const existing = this.workers.get(info.agentId);
      if (existing !== undefined) {
        existing.taskId = info.taskId;
        return this.bump();
      }
    }
    const id = info.kind === 'agent' && info.agentId !== undefined ? info.agentId : info.taskId;
    const worker = this.ensureWorker(id, {
      name:
        info.kind === 'agent'
          ? (info.subagentType ?? info.description)
          : info.description || info.command,
      kind: info.kind === 'agent' ? 'background' : 'process',
      runInBackground: true,
      description: info.description,
    });
    worker.taskId = info.taskId;
    worker.status = 'running';
    worker.lastActivityAtMs = this.now();
    return this.bump();
  }

  private applyBackgroundTerminated(
    info: Extract<Event, { type: 'background.task.terminated' }>['info'],
  ): boolean {
    const worker = this.findByTaskId(info.taskId, info.kind === 'agent' ? info.agentId : undefined);
    if (worker === undefined) return false;
    worker.status = info.status === 'completed' ? 'completed' : 'failed';
    if (worker.status === 'failed') {
      worker.error = info.stopReason ?? info.status;
    }
    worker.terminalAtMs = info.endedAt ?? this.now();
    worker.lastActivityAtMs = worker.terminalAtMs;
    this.pruneLingered();
    return this.bump();
  }

  private findByTaskId(taskId: string, agentId?: string): MutableWorker | undefined {
    if (agentId !== undefined) {
      const byAgent = this.workers.get(agentId);
      if (byAgent !== undefined) return byAgent;
    }
    for (const worker of this.workers.values()) {
      if (worker.taskId === taskId) return worker;
    }
    return undefined;
  }

  private pushOps(entry: MissionOpsEntry): void {
    this.ops.push(entry);
    if (this.ops.length > MISSION_OPS_FEED_CAP) {
      this.ops.splice(0, this.ops.length - MISSION_OPS_FEED_CAP);
    }
  }

  /** Drop completed workers past the linger window (failed persist). */
  private pruneLingered(): void {
    const nowMs = this.now();
    for (const [id, worker] of this.workers) {
      if (
        worker.status === 'completed' &&
        worker.terminalAtMs !== undefined &&
        nowMs - worker.terminalAtMs > MISSION_COMPLETED_LINGER_MS
      ) {
        this.workers.delete(id);
      }
    }
  }
}

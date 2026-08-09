/**
 * MissionControlRegistry — pure data layer behind the Mission Control dock.
 * Merges worker lifecycle / progress / tool telemetry, todo updates,
 * background tasks, and child `thinking`/`assistant` deltas into one roster
 * projection. No TUIState / component dependencies; the panel component
 * renders {@link MissionControlSnapshot} and the session-event handler feeds
 * events via {@link MissionControlRegistry.apply}.
 */

import type { Event } from '@superliora/sdk';

import { resolveSubagentToolTarget } from '../../utils/tools/subagent-tool-detail';

/** Completed workers linger this long so the operator sees the outcome. */
export const MISSION_COMPLETED_LINGER_MS = 12_000;
/** Ops-feed ring buffer cap (interleaved across all workers). */
export const MISSION_OPS_FEED_CAP = 40;
/** Keep only the rolling tail of live inference / NL text. */
export const MISSION_LIVE_TEXT_CAP = 160;
/** tok/s sparkline ring per worker (progress heartbeats). */
export const MISSION_RATE_SAMPLES_CAP = 8;
/** Compact result chip on settled MOVES rows. */
const MISSION_RESULT_CHIP_MAX = 28;

export type MissionLiveKind = 'thinking' | 'answer';

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
  /**
   * Smoothed tokens/sec from consecutive progress heartbeats. Absent until
   * two samples land with a positive delta.
   */
  readonly tokenRatePerSec?: number;
  /** Recent tok/s samples for densemode sparklines (oldest → newest). */
  readonly rateSamples?: readonly number[];
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
  /** Wall time when the worker first entered the roster (stable sort key). */
  readonly spawnedAtMs: number;
  readonly lastActivityAtMs: number;
  /** Latest child thinking/answer stream kind (NOW live strip). */
  readonly liveKind?: MissionLiveKind;
  /** Rolling tail of the live stream (last non-empty line / capped chars). */
  readonly liveText?: string;
  /** Wall time of the last live-stream delta. */
  readonly liveAtMs?: number;
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
  /** Wall time of the last token sample used for rate smoothing. */
  tokensSampleAtMs?: number;
  tokenRatePerSec?: number;
  rateSamples?: number[];
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
  liveKind?: MissionLiveKind;
  liveBuffer?: string;
  liveAtMs?: number;
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
      case 'thinking.delta':
        return this.applyLiveDelta(event.agentId, 'thinking', event.delta);
      case 'assistant.delta':
        return this.applyLiveDelta(event.agentId, 'answer', event.delta);
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
        ...(worker.tokenRatePerSec === undefined || worker.tokenRatePerSec < 1
          ? {}
          : { tokenRatePerSec: worker.tokenRatePerSec }),
        ...(worker.rateSamples === undefined || worker.rateSamples.length === 0
          ? {}
          : { rateSamples: [...worker.rateSamples] }),
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
        spawnedAtMs: worker.spawnedAtMs,
        lastActivityAtMs: worker.lastActivityAtMs,
        ...(worker.liveKind === undefined ? {} : { liveKind: worker.liveKind }),
        ...(worker.liveBuffer === undefined || worker.liveBuffer.length === 0
          ? {}
          : { liveText: liveTextTail(worker.liveBuffer) }),
        ...(worker.liveAtMs === undefined ? {} : { liveAtMs: worker.liveAtMs }),
      });
    }
    // Status buckets first; within a bucket keep spawn order so heartbeats
    // (lastActivityAtMs) cannot reshuffle rows every progress tick.
    workers.sort((a, b) => {
      const rank = (w: MissionWorker): number =>
        ACTIVE_STATUSES.has(w.status) ? 0 : w.status === 'failed' ? 1 : 2;
      return (
        rank(a) - rank(b) ||
        a.spawnedAtMs - b.spawnedAtMs ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
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
    const atMs = this.now();
    this.sampleTokenRate(worker, event.tokens, atMs);
    worker.tokens = event.tokens;
    worker.progressElapsedMs = event.elapsedMs;
    worker.progressAtMs = atMs;
    worker.lastActivityAtMs = atMs;
    worker.budgetMs = event.budgetMs ?? worker.budgetMs;
    worker.budgetRemainingMs = event.budgetRemainingMs ?? worker.budgetRemainingMs;
    worker.stalledSilentMs = undefined;
    worker.status = event.finishing === true ? 'finishing' : 'running';
    return this.bump();
  }

  /** EMA of tokens/sec from heartbeat deltas (≥250ms apart). */
  private sampleTokenRate(worker: MutableWorker, nextTokens: number, atMs: number): void {
    const prevAt = worker.tokensSampleAtMs;
    const prevTokens = worker.tokens;
    worker.tokensSampleAtMs = atMs;
    if (nextTokens < prevTokens) {
      worker.tokenRatePerSec = undefined;
      return;
    }
    if (prevAt === undefined || atMs <= prevAt) return;
    const dtSec = (atMs - prevAt) / 1000;
    if (dtSec < 0.25) return;
    const instant = (nextTokens - prevTokens) / dtSec;
    worker.tokenRatePerSec =
      worker.tokenRatePerSec === undefined
        ? instant
        : worker.tokenRatePerSec * 0.55 + instant * 0.45;
    if (worker.tokenRatePerSec !== undefined && worker.tokenRatePerSec >= 1) {
      const samples = worker.rateSamples ?? [];
      samples.push(worker.tokenRatePerSec);
      if (samples.length > MISSION_RATE_SAMPLES_CAP) {
        samples.splice(0, samples.length - MISSION_RATE_SAMPLES_CAP);
      }
      worker.rateSamples = samples;
    }
  }

  private applyStalled(event: Extract<Event, { type: 'subagent.stalled' }>): boolean {
    const worker = this.ensureWorker(event.subagentId, {
      name: event.subagentName ?? event.subagentId,
    });
    if (event.subagentName !== undefined) worker.name = event.subagentName;
    worker.status = 'stalled';
    worker.stalledSilentMs = event.silentMs;
    worker.toolCount = event.toolCount;
    worker.tokenRatePerSec = undefined;
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
    const { target, chip } = resolveSubagentToolTarget(event.detail, event.argsPreview);
    const targetText = target;
    worker.lastTool = event.name;
    if (targetText !== undefined && targetText.length > 0) worker.lastTarget = targetText;
    // Tool phase: drop stale inference so NOW shows the action, not old thoughts.
    clearLiveStream(worker);
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
    const resultChip = compactResultChip(event.resultPreview);
    const entry = this.ops.find((candidate) => candidate.toolCallId === event.toolCallId);
    if (entry !== undefined) {
      const index = this.ops.indexOf(entry);
      this.ops[index] = {
        ...entry,
        ...(event.name !== undefined && event.name.length > 0 ? { name: event.name } : {}),
        ...(resultChip === undefined || entry.chip !== undefined ? {} : { chip: resultChip }),
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
        ...(resultChip === undefined ? {} : { chip: resultChip }),
        status,
        atMs,
        settledAtMs: atMs,
      });
    }
    const worker = this.workers.get(event.subagentId);
    if (worker !== undefined) worker.lastActivityAtMs = atMs;
    return this.bump();
  }

  /**
   * Child-agent inference / NL deltas (routed by `agentId`). Unknown agents
   * are ignored — only workers already on the roster get a live strip.
   */
  private applyLiveDelta(
    agentId: string,
    kind: MissionLiveKind,
    delta: string,
  ): boolean {
    if (delta.length === 0) return false;
    const worker = this.workers.get(agentId);
    if (worker === undefined) return false;
    if (worker.liveKind !== kind) {
      worker.liveKind = kind;
      worker.liveBuffer = '';
    }
    worker.liveBuffer = appendLiveBuffer(worker.liveBuffer ?? '', delta);
    const atMs = this.now();
    worker.liveAtMs = atMs;
    worker.lastActivityAtMs = atMs;
    if (worker.status === 'stalled') worker.status = 'running';
    worker.stalledSilentMs = undefined;
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

function clearLiveStream(worker: MutableWorker): void {
  delete worker.liveKind;
  delete worker.liveBuffer;
  delete worker.liveAtMs;
}

function appendLiveBuffer(prev: string, delta: string): string {
  const next = `${prev}${delta}`;
  if (next.length <= MISSION_LIVE_TEXT_CAP * 2) return next;
  // Keep extra headroom so line-tail extraction still sees a full last line.
  return next.slice(next.length - MISSION_LIVE_TEXT_CAP * 2);
}

/** Last non-empty line, then char-cap — what NOW paints. */
export function liveTextTail(buffer: string, maxChars: number = MISSION_LIVE_TEXT_CAP): string {
  const normalized = buffer.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
  const lines = normalized.split('\n');
  let last = '';
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trimEnd();
    if (line.trim().length > 0) {
      last = line.trim();
      break;
    }
  }
  if (last.length === 0) return '';
  if (last.length <= maxChars) return last;
  return `…${last.slice(last.length - (maxChars - 1))}`;
}

function compactResultChip(preview: string | undefined): string | undefined {
  if (preview === undefined) return undefined;
  const flat = preview.replace(/\s+/gu, ' ').trim();
  if (flat.length === 0) return undefined;
  if (flat.length <= MISSION_RESULT_CHIP_MAX) return flat;
  return `${flat.slice(0, MISSION_RESULT_CHIP_MAX - 1).trimEnd()}…`;
}

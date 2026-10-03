/**
 * WorkerDockRegistry — pure data layer behind the Mission Control dock.
 * Merges worker lifecycle / progress / tool telemetry, background tasks,
 * and child `thinking`/`assistant` deltas into one roster
 * projection. No TUIState / component dependencies; the panel component
 * renders {@link WorkerDockSnapshot} and the session-event handler feeds
 * events via {@link WorkerDockRegistry.apply}.
 */

import type { Event } from '@superliora/sdk';
import { MAIN_AGENT_ID } from '../../constant/liora-tui';

import { monotonicMotionNowMs } from '../../features/appearance/appearance-effects';
import { lastNonEmptyLine, resolveSubagentToolTarget } from '../../utils/tools/subagent-tool-detail';

/**
 * Terminal workers (completed + failed) linger this long so the operator sees
 * the outcome, then drop from the dock. Same window for both — failed must not
 * permanently occupy Worker Dock.
 */
export const MISSION_COMPLETED_LINGER_MS = 12_000;

/** True when a terminal worker is past the dock linger window and should hide. */
export function isDockWorkerPastLinger(
  worker: { readonly status: DockWorkerStatus; readonly terminalAtMs?: number },
  nowMs: number,
  lingerMs: number = MISSION_COMPLETED_LINGER_MS,
): boolean {
  if (worker.status !== 'completed' && worker.status !== 'failed') return false;
  if (worker.terminalAtMs === undefined) return false;
  return nowMs - worker.terminalAtMs > lingerMs;
}

/** Ops-feed ring buffer cap (interleaved across all workers). */
export const MISSION_OPS_FEED_CAP = 40;
/** Keep only the rolling tail of live inference / NL text. */
export const MISSION_LIVE_TEXT_CAP = 160;
/** tok/s sparkline ring per worker (progress heartbeats). */
export const MISSION_RATE_SAMPLES_CAP = 8;
/**
 * Min gap between progress samples that contribute to tok/s. Below this the
 * delta is held for the next beat (avoids divide-by-tiny-dt spikes) without
 * feeling sticky — 100ms tracks live streams; the old 250ms floor lagged.
 */
export const MISSION_RATE_MIN_SAMPLE_MS = 100;
/** EMA blend: prior rate weight (lighter = snappier chase of bursts). */
export const MISSION_RATE_EMA_PREV = 0.35;
/** EMA blend: instant sample weight. */
export const MISSION_RATE_EMA_INSTANT = 0.65;
/** Compact result chip on settled MOVES rows. */
const MISSION_RESULT_CHIP_MAX = 28;

export type MissionLiveKind = 'thinking' | 'answer' | 'stdout' | 'stderr' | 'progress' | 'status';

/** True when the live strip is child-tool stdout/stderr/progress/status. */
export function isToolProgressLiveKind(
  kind: string | undefined,
): kind is 'stdout' | 'stderr' | 'progress' | 'status' {
  return kind === 'stdout' || kind === 'stderr' || kind === 'progress' || kind === 'status';
}

export type DockWorkerStatus =
  | 'running'
  | 'completed'
  | 'failed';

export type DockWorkerKind = 'subagent' | 'background' | 'process';

export interface DockWorker {
  readonly id: string;
  readonly name: string;
  readonly kind: DockWorkerKind;
  readonly status: DockWorkerStatus;
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
  /** Wall-clock elapsed, derived at snapshot time (may lag; prefer live re-derive). */
  readonly elapsedMs: number;
  /**
   * Progress-clock anchors so paint can re-derive live elapsed without a
   * version bump on every heartbeat (see {@link liveWorkerElapsedMs}).
   */
  readonly progressAtMs?: number;
  readonly progressElapsedMs?: number;
  /** Explicit caller timeout/deadline; never a heuristic step budget. */
  readonly budgetMs?: number;
  readonly budgetRemainingMs?: number;
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
  /** Raw Job ledger provenance for ghost rows seeded before live workers arrive. */
  readonly ledger?: { readonly kind: string; readonly status: string };
}

/**
 * Recorded Job-card subset the ghost hydrator consumes. Telemetry fields show live state
 * instead of a bare title.
 */
export interface WorkerDockGhostJob {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly workerAgentId?: string;
  readonly kind?: string;
  readonly progress?: {
    readonly phase?: string;
    readonly recentTools?: readonly string[];
  };
  readonly liveActivity?: {
    readonly name: string;
    readonly target?: string;
    readonly preview?: string;
    readonly previewKind?: 'stdout' | 'stderr' | 'progress' | 'status';
  };
  readonly liveTokens?: number;
}

export interface DockOpsEntry {
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

export interface WorkerDockSnapshot {
  /** Bumped on every mutation — render caches key on it. */
  readonly version: number;
  readonly workers: readonly DockWorker[];
  readonly activeCount: number;
  /** Aggregate tokens across active workers. */
  readonly totalTokens: number;
  readonly ops: readonly DockOpsEntry[];
}

interface MutableWorker {
  id: string;
  name: string;
  kind: DockWorkerKind;
  status: DockWorkerStatus;
  modelAlias?: string;
  description?: string;
  swarmIndex?: number;
  runInBackground: boolean;
  lastTool?: string;
  lastTarget?: string;
  toolCount: number;
  tokens: number;
  /** Wall time of the last accepted token sample used for rate smoothing. */
  tokensSampleAtMs?: number;
  /** Token total at {@link tokensSampleAtMs} (held across sub-min-gap beats). */
  tokensSampleTokens?: number;
  lastToolCallId?: string;
  seenToolCallIds?: Set<string>;
  tokenRatePerSec?: number;
  rateSamples?: number[];
  budgetMs?: number;
  budgetRemainingMs?: number;
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
  /** `subagent.tool_progress` tail is keyed by this toolCallId. */
  liveToolCallId?: string;
  liveProgressSource?: 'raw' | 'summary';
  /** Ledger provenance (see {@link DockWorker.ledger}). */
  ledger?: { readonly kind: string; readonly status: string };
}

export class WorkerDockRegistry {
  private readonly workers = new Map<string, MutableWorker>();
  private readonly ops: DockOpsEntry[] = [];
  private version = 0;

  /**
   * Roster timestamps share the motion time base (PREMIUM.md §7.1), because the
   * panel reads them against `appearanceAnimationNow()` — for the linger window,
   * the live elapsed clock, and the terminal settle flash. A wall-clock stamp
   * here makes every one of those differences ~-1.8e12 ms: elapsed pins at 0,
   * the flash never leaves progress 0, and terminal workers never expire.
   */
  constructor(private readonly now: () => number = monotonicMotionNowMs) {}

  reset(): void {
    this.workers.clear();
    this.ops.length = 0;
    this.version += 1;
  }

  /**
   * Seed running ghost rows from the recorded Job ledger so Worker Dock
   * is not empty after crash/resume before live subagent events arrive.
   * Ghost ids are `job-ghost:<jobId>`; dropped when a live workerAgentId is present.
   */
  hydrateJobGhosts(jobs: readonly WorkerDockGhostJob[]): boolean {
    let changed = false;
    const wanted = new Set<string>();
    const nowMs = this.now();
    for (const job of jobs) {
      if (job.status !== 'running') {
        continue;
      }
      const ghostId = `job-ghost:${job.id}`;
      if (
        job.workerAgentId !== undefined &&
        job.workerAgentId.length > 0 &&
        this.workers.has(job.workerAgentId)
      ) {
        if (this.workers.delete(ghostId)) changed = true;
        continue;
      }
      wanted.add(ghostId);
      const status: DockWorkerStatus = 'running';
      const title = job.title.trim();
      const ledger =
        job.kind === undefined || job.kind.length === 0
          ? undefined
          : { kind: job.kind, status: job.status };
      const phase = job.progress?.phase?.trim();
      // Paint the job title, not a "Resuming…" placeholder — the dock LIVE
      // cell used to look like every worker was stuck resuming.
      const description = phase && phase.length > 0 ? phase : title.length > 0 ? title : job.id;
      const lastTool = job.liveActivity?.name ?? job.progress?.recentTools?.at(-1);
      const lastTarget = job.liveActivity?.target;
      const tokens = job.liveTokens;
      const preview = job.liveActivity?.preview;
      const previewText =
        preview === undefined || preview.length === 0 ? undefined : preview;
      const liveKind =
        previewText === undefined ? undefined : (job.liveActivity?.previewKind ?? 'status');
      const liveText = previewText === undefined ? undefined : liveTextTail(previewText);
      const existing = this.workers.get(ghostId);
      if (existing !== undefined) {
        const nextName = title.length > 0 ? title.slice(0, 80) : job.id;
        const nextDescription = description;
        // Only bump the roster when fields actually change — pure progress
        // heartbeats used to force densemode rebuilds every pushView.
        if (
          existing.status !== status ||
          existing.name !== nextName ||
          existing.description !== nextDescription ||
          !ledgerEqual(existing.ledger, ledger) ||
          existing.lastTool !== lastTool ||
          existing.lastTarget !== lastTarget ||
          existing.tokens !== (tokens ?? existing.tokens) ||
          existing.liveBuffer !== liveText
        ) {
          existing.status = status;
          existing.name = nextName;
          existing.description = nextDescription;
          if (ledger === undefined) delete existing.ledger;
          else existing.ledger = ledger;
          if (lastTool === undefined) delete existing.lastTool;
          else existing.lastTool = lastTool;
          if (lastTarget === undefined) delete existing.lastTarget;
          else existing.lastTarget = lastTarget;
          if (tokens !== undefined) existing.tokens = tokens;
          if (liveText === undefined) delete existing.liveBuffer;
          else existing.liveBuffer = liveText;
          if (liveKind === undefined) delete existing.liveKind;
          else existing.liveKind = liveKind;
          existing.lastActivityAtMs = nowMs;
          changed = true;
        }
        continue;
      }
      this.workers.set(ghostId, {
        id: ghostId,
        name: title.length > 0 ? title.slice(0, 80) : job.id,
        kind: 'subagent',
        status,
        description,
        ...(ledger === undefined ? {} : { ledger }),
        ...(lastTool === undefined ? {} : { lastTool }),
        ...(lastTarget === undefined ? {} : { lastTarget }),
        ...(liveKind === undefined || liveText === undefined
          ? {}
          : { liveKind, liveBuffer: liveText, liveAtMs: nowMs }),
        runInBackground: true,
        toolCount: 0,
        tokens: tokens ?? 0,
        spawnedAtMs: nowMs,
        lastActivityAtMs: nowMs,
      });
      changed = true;
    }
    // Snapshot keys before delete — iterating Map.keys() live would skip entries.
    for (const id of Array.from(this.workers.keys())) {
      if (!id.startsWith('job-ghost:') || wanted.has(id)) continue;
      this.workers.delete(id);
      changed = true;
    }
    return changed ? this.bump() : false;
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
      case 'subagent.completed':
        return this.applyCompleted(event);
      case 'subagent.failed':
        return this.applyFailed(event);
      case 'subagent.tool_call':
        return this.applyToolCall(event);
      case 'subagent.tool_result':
        return this.applyToolResult(event);
      case 'subagent.tool_progress':
        return this.applyToolProgress(event);
      case 'background.task.started':
        return this.applyBackgroundStarted(event.info);
      case 'background.task.terminated':
        return this.applyBackgroundTerminated(event.info);
      case 'thinking.delta':
        return this.applyLiveDelta(event.agentId, 'thinking', event.delta);
      case 'assistant.delta':
        return this.applyLiveDelta(event.agentId, 'answer', event.delta);
      case 'tool.call.started':
        return this.applyRawToolCall(event);
      case 'tool.result':
        return this.applyRawToolResult(event);
      case 'tool.progress':
        return this.applyRawToolProgress(event);
      case 'shell.started':
        return event.agentId === MAIN_AGENT_ID ? false : this.touch(event.agentId);
      case 'shell.output':
        return this.applyRawShellOutput(event);
      default:
        return false;
    }
  }

  snapshot(nowMs: number = this.now()): WorkerDockSnapshot {
    const workers: DockWorker[] = [];
    let activeCount = 0;
    let totalTokens = 0;
    for (const worker of this.workers.values()) {
      if (isDockWorkerPastLinger(worker, nowMs)) {
        continue;
      }
      const active = worker.status === 'running';
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
        ...(worker.progressAtMs === undefined ? {} : { progressAtMs: worker.progressAtMs }),
        ...(worker.progressElapsedMs === undefined
          ? {}
          : { progressElapsedMs: worker.progressElapsedMs }),
        ...(worker.budgetMs === undefined ? {} : { budgetMs: worker.budgetMs }),
        ...(worker.budgetRemainingMs === undefined ? {} : { budgetRemainingMs: worker.budgetRemainingMs }),
        ...(worker.error === undefined ? {} : { error: worker.error }),
        ...(worker.terminalAtMs === undefined ? {} : { terminalAtMs: worker.terminalAtMs }),
        spawnedAtMs: worker.spawnedAtMs,
        lastActivityAtMs: worker.lastActivityAtMs,
        ...(worker.liveKind === undefined ? {} : { liveKind: worker.liveKind }),
        ...(worker.liveBuffer === undefined || worker.liveBuffer.length === 0
          ? {}
          : { liveText: liveTextTail(worker.liveBuffer) }),
        ...(worker.liveAtMs === undefined ? {} : { liveAtMs: worker.liveAtMs }),
        ...(worker.ledger === undefined ? {} : { ledger: worker.ledger }),
      });
    }
    // Status buckets first; within a bucket keep spawn order so heartbeats
    // (lastActivityAtMs) cannot reshuffle rows every progress tick.
    workers.sort((a, b) => {
      const rank = (w: DockWorker): number =>
        w.status === 'running' ? 0 : w.status === 'failed' ? 1 : 2;
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

  /**
   * Cheap ambient-schedule probe: any non-expired worker on the roster.
   * Avoids allocating the full {@link snapshot} projection every tick.
   */
  hasVisibleWorkers(nowMs: number = this.now()): boolean {
    for (const worker of this.workers.values()) {
      if (!isDockWorkerPastLinger(worker, nowMs)) return true;
    }
    return false;
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
    const prevName = worker.name;
    const prevTool = worker.lastTool;
    const prevTarget = worker.lastTarget;
    const prevToolCount = worker.toolCount;
    const prevTokens = worker.tokens;
    const prevStatus = worker.status;
    const prevRate = worker.tokenRatePerSec;
    const prevBudgetMs = worker.budgetMs;
    const prevBudgetRemainingMs = worker.budgetRemainingMs;

    if (event.subagentName !== undefined) worker.name = event.subagentName;
    worker.lastTool = event.lastTool ?? worker.lastTool;
    worker.lastTarget = event.lastTarget ?? worker.lastTarget;
    worker.toolCount = Math.max(event.toolCount, worker.seenToolCallIds?.size ?? 0);
    const atMs = this.now();
    this.sampleTokenRate(worker, event.tokens, atMs);
    worker.tokens = event.tokens;
    worker.progressElapsedMs = event.elapsedMs;
    worker.progressAtMs = atMs;
    worker.lastActivityAtMs = atMs;
    worker.budgetMs = event.budgetMs;
    worker.budgetRemainingMs = event.budgetRemainingMs;
    worker.status = 'running';

    // Always mutate clocks/rate samples; only bump the roster version when
    // layout-visible fields change. Elapsed still advances at paint via
    // progressAtMs anchors (liveWorkerElapsedMs).
    const material =
      worker.name !== prevName ||
      worker.lastTool !== prevTool ||
      worker.lastTarget !== prevTarget ||
      worker.toolCount !== prevToolCount ||
      worker.status !== prevStatus ||
      worker.budgetMs !== prevBudgetMs ||
      worker.budgetRemainingMs !== prevBudgetRemainingMs ||
      worker.tokens !== prevTokens ||
      (worker.tokenRatePerSec ?? 0) !== (prevRate ?? 0);
    return material ? this.bump() : false;
  }

  /** EMA of tokens/sec from heartbeat deltas (≥{@link MISSION_RATE_MIN_SAMPLE_MS}). */
  private sampleTokenRate(worker: MutableWorker, nextTokens: number, atMs: number): void {
    const prevAt = worker.tokensSampleAtMs;
    const prevTokens = worker.tokensSampleTokens ?? worker.tokens;
    if (nextTokens < prevTokens) {
      worker.tokensSampleAtMs = atMs;
      worker.tokensSampleTokens = nextTokens;
      worker.tokenRatePerSec = undefined;
      return;
    }
    if (prevAt === undefined || atMs <= prevAt) {
      worker.tokensSampleAtMs = atMs;
      worker.tokensSampleTokens = nextTokens;
      return;
    }
    const dtMs = atMs - prevAt;
    if (dtMs < MISSION_RATE_MIN_SAMPLE_MS) {
      // Hold sample clock + token baseline so short bursts accumulate into the
      // next eligible window instead of resetting the rate floor every tick.
      return;
    }
    worker.tokensSampleAtMs = atMs;
    worker.tokensSampleTokens = nextTokens;
    const dtSec = dtMs / 1000;
    const instant = (nextTokens - prevTokens) / dtSec;
    worker.tokenRatePerSec =
      worker.tokenRatePerSec === undefined
        ? instant
        : worker.tokenRatePerSec * MISSION_RATE_EMA_PREV + instant * MISSION_RATE_EMA_INSTANT;
    if (worker.tokenRatePerSec !== undefined && worker.tokenRatePerSec >= 1) {
      const samples = worker.rateSamples ?? [];
      samples.push(worker.tokenRatePerSec);
      if (samples.length > MISSION_RATE_SAMPLES_CAP) {
        samples.splice(0, samples.length - MISSION_RATE_SAMPLES_CAP);
      }
      worker.rateSamples = samples;
    }
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
    const target = resolveSubagentToolTarget(event.detail, event.argsPreview);
    return this.recordToolCall(worker, event.toolCallId, event.name, target);
  }

  private applyRawToolCall(event: Extract<Event, { type: 'tool.call.started' }>): boolean {
    if (event.agentId === MAIN_AGENT_ID) return false;
    const worker = this.workers.get(event.agentId);
    if (worker === undefined) return false;
    return this.recordToolCall(worker, event.toolCallId, event.name, event.description);
  }

  private recordToolCall(
    worker: MutableWorker,
    toolCallId: string,
    name: string,
    target?: string,
  ): boolean {
    const index = this.ops.findIndex(
      (entry) => entry.workerId === worker.id && entry.toolCallId === toolCallId,
    );
    if (index >= 0) {
      const entry = this.ops[index]!;
      const nextTarget = target ?? entry.target;
      if (entry.name === name && entry.target === nextTarget) return false;
      this.ops[index] = { ...entry, name, target: nextTarget };
      if (worker.lastToolCallId === toolCallId && nextTarget !== undefined) {
        worker.lastTarget = nextTarget;
      }
      return this.bump();
    }
    const seen = worker.seenToolCallIds ??= new Set<string>();
    if (seen.has(toolCallId)) return false;
    seen.add(toolCallId);
    worker.toolCount = Math.max(worker.toolCount, seen.size);
    worker.lastToolCallId = toolCallId;
    worker.lastTool = name;
    worker.lastTarget = target;
    // Repeated raw/summary copies do not clear fresh output or reopen settled rows.
    clearLiveStream(worker);
    worker.lastActivityAtMs = this.now();
    this.pushOps({
      toolCallId,
      workerId: worker.id,
      workerName: worker.name,
      name,
      ...(target === undefined || target.length === 0 ? {} : { target }),
      status: 'running',
      atMs: worker.lastActivityAtMs,
    });
    return this.bump();
  }

  private applyToolResult(event: Extract<Event, { type: 'subagent.tool_result' }>): boolean {
    return this.recordToolResult(
      event.subagentId, event.toolCallId, event.isError === true, event.resultPreview, event.name,
    );
  }

  private applyRawToolResult(event: Extract<Event, { type: 'tool.result' }>): boolean {
    if (event.agentId === MAIN_AGENT_ID || !this.workers.has(event.agentId)) return false;
    const preview = typeof event.output === 'string'
      ? event.output.slice(-MISSION_LIVE_TEXT_CAP)
      : undefined;
    return this.recordToolResult(event.agentId, event.toolCallId, event.isError === true, preview);
  }

  private recordToolResult(
    workerId: string,
    toolCallId: string,
    isError: boolean,
    preview?: string,
    name?: string,
  ): boolean {
    const atMs = this.now();
    const status = isError ? 'error' : 'ok';
    const resultChip = compactResultChip(preview);
    const index = this.ops.findIndex(
      (entry) => entry.workerId === workerId && entry.toolCallId === toolCallId,
    );
    if (index >= 0) {
      const entry = this.ops[index]!;
      const nextName = name !== undefined && name.length > 0 ? name : entry.name;
      const nextChip = entry.chip ?? resultChip;
      if (entry.status === status && entry.name === nextName && entry.chip === nextChip) return false;
      this.ops[index] = { ...entry, name: nextName, chip: nextChip, status, settledAtMs: atMs };
    } else {
      const worker = this.workers.get(workerId);
      this.pushOps({
        toolCallId,
        workerId,
        workerName: worker?.name ?? workerId,
        name: name ?? 'tool',
        ...(resultChip === undefined ? {} : { chip: resultChip }),
        status,
        atMs,
        settledAtMs: atMs,
      });
    }
    const worker = this.workers.get(workerId);
    if (worker !== undefined) {
      worker.lastActivityAtMs = atMs;
      if (worker.liveToolCallId === toolCallId) clearLiveStream(worker);
    }
    return this.bump();
  }

  /**
   * Volatile child-tool stdout/stderr/progress/status. Missing `textPreview`
   * is a no-op. Tail is keyed by `subagentId` + `toolCallId` so a new call
   * resets the buffer; stderr/stdout share one tail (kind only changes paint).
   */
  private applyToolProgress(
    event: Extract<Event, { type: 'subagent.tool_progress' }>,
  ): boolean {
    const worker = this.workers.get(event.subagentId);
    if (worker === undefined) return false;
    return this.recordToolProgress(worker, event.toolCallId, event.kind, 'summary', event.textPreview, event.name);
  }

  private applyRawToolProgress(event: Extract<Event, { type: 'tool.progress' }>): boolean {
    if (event.agentId === MAIN_AGENT_ID || !isToolProgressLiveKind(event.update.kind)) return false;
    const worker = this.workers.get(event.agentId);
    if (worker === undefined) return false;
    return this.recordToolProgress(worker, event.toolCallId, event.update.kind, 'raw', event.update.text);
  }

  private applyRawShellOutput(event: Extract<Event, { type: 'shell.output' }>): boolean {
    if (event.agentId === MAIN_AGENT_ID || !isToolProgressLiveKind(event.update.kind)) return false;
    const worker = this.workers.get(event.agentId);
    if (worker === undefined) return false;
    return this.recordToolProgress(worker, event.commandId, event.update.kind, 'raw', event.update.text);
  }

  private recordToolProgress(
    worker: MutableWorker,
    toolCallId: string,
    kind: MissionLiveKind,
    source: 'raw' | 'summary',
    preview?: string,
    name?: string,
  ): boolean {
    if (preview === undefined || preview.length === 0) return false;
    if (source === 'summary' && lastNonEmptyLine(preview).length === 0) return false;
    const atMs = this.now();
    worker.liveAtMs = atMs;
    worker.lastActivityAtMs = atMs;
    if (worker.liveToolCallId === toolCallId && source === 'summary' && worker.liveProgressSource === 'raw') {
      return false;
    }
    if (
      worker.liveToolCallId !== toolCallId ||
      (source === 'raw' && worker.liveProgressSource === 'summary')
    ) {
      worker.liveToolCallId = toolCallId;
      worker.liveBuffer = '';
    }
    worker.liveProgressSource = source;
    worker.liveKind = kind;
    const sep =
      source === 'summary' &&
      worker.liveBuffer !== undefined &&
      worker.liveBuffer.length > 0 &&
      !worker.liveBuffer.endsWith('\n')
        ? '\n'
        : '';
    worker.liveBuffer = appendLiveBuffer(worker.liveBuffer ?? '', `${sep}${preview}`);
    if (name !== undefined && name.length > 0) worker.lastTool = name;
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
      clearLiveStream(worker);
      worker.liveKind = kind;
      worker.liveBuffer = '';
    }
    worker.liveBuffer = appendLiveBuffer(worker.liveBuffer ?? '', delta);
    const atMs = this.now();
    worker.liveAtMs = atMs;
    worker.lastActivityAtMs = atMs;
    return this.bump();
  }

  private applyBackgroundStarted(
    info: Extract<Event, { type: 'background.task.started' }>['info'],
  ): boolean {
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
    // `info.endedAt` is an SDK wall-clock stamp; the roster clock is local and
    // monotonic, so take the local reading instead of mixing bases.
    worker.terminalAtMs = this.now();
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

  private pushOps(entry: DockOpsEntry): void {
    this.ops.push(entry);
    if (this.ops.length > MISSION_OPS_FEED_CAP) {
      this.ops.splice(0, this.ops.length - MISSION_OPS_FEED_CAP);
    }
  }

  /** Drop terminal workers (completed + failed) past the shared linger window. */
  private pruneLingered(): void {
    const nowMs = this.now();
    for (const [id, worker] of this.workers) {
      if (isDockWorkerPastLinger(worker, nowMs)) {
        this.workers.delete(id);
      }
    }
  }
}

function clearLiveStream(worker: MutableWorker): void {
  delete worker.liveKind;
  delete worker.liveBuffer;
  delete worker.liveAtMs;
  delete worker.liveToolCallId;
  delete worker.liveProgressSource;
}

function ledgerEqual(
  a: { readonly kind: string; readonly status: string } | undefined,
  b: { readonly kind: string; readonly status: string } | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.kind === b.kind && a.status === b.status;
}

function appendLiveBuffer(prev: string, delta: string): string {
  const next = `${prev}${delta}`;
  if (next.length <= MISSION_LIVE_TEXT_CAP * 2) return next;
  // Keep extra headroom so line-tail extraction still sees a full last line.
  return next.slice(next.length - MISSION_LIVE_TEXT_CAP * 2);
}

/** Last non-empty line, then char-cap — what NOW paints. */
export function liveTextTail(buffer: string, maxChars: number = MISSION_LIVE_TEXT_CAP): string {
  const normalized = buffer.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
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
  const flat = preview.replaceAll(/\s+/gu, ' ').trim();
  if (flat.length === 0) return undefined;
  if (flat.length <= MISSION_RESULT_CHIP_MAX) return flat;
  return `${flat.slice(0, MISSION_RESULT_CHIP_MAX - 1).trimEnd()}…`;
}

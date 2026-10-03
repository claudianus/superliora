/** Live worker progress, child tool streaming, and durable interruption snapshots. */

import type { Agent } from '../../agent';
import type { AgentEvent } from '@superliora/protocol';
import { log } from '../../logging/logger';
import {
  reportJobWorkerProgress,
} from '../../tools/builtin/job/job-worker-ledger-bridge';
import { snapshotChildWork } from './subagent-work-snapshot';
import { writeSubagentCheckpoint } from './subagent-checkpoint';
import {
  describeSubagentToolDetail,
  previewSubagentToolArgs,
  previewSubagentToolProgress,
  previewSubagentToolResult,
  summarizeToolTarget,
  type SubagentProgressStats,
} from './subagent-progress-preview';
import type { RunSubagentOptions } from './subagent-host-types';

/** Cadence for subagent.progress telemetry (T3-7). */
const SUBAGENT_PROGRESS_INTERVAL_MS = 5_000;
/** Checkpoint cadence: snapshot every N completed tool calls (T4-5). */
const CHECKPOINT_TOOL_DELTA = 10;

/** Incremental progress reporting avoids repeatedly scanning the child history. */
export function startProgressReporter(
  parent: Agent,
  child: Agent,
  childId: string,
  profileName: string,
  budgetMs?: number,
  signal?: AbortSignal,
): () => Promise<void> {
  const startedAt = Date.now();
  let lastCheckpointToolCount = 0;
  let checkpointInFlight: Promise<void> | undefined;
  let checkpointError: unknown;
  let checkpointFailed = false;
  // Incremental mirror of collectSubagentProgressStats: toolCount/lastTool/
  // lastTarget update on `tool.call.started`; tokens read from the usage
  // accumulator (already O(1)).
  let toolCount = 0;
  let lastTool: string | undefined;
  let lastTarget: string | undefined;
  const originalEmit = child.emitEvent;
  const progressEmit = function subagentProgressEmitEvent(event: AgentEvent) {
    if (event.type === 'tool.call.started') {
      toolCount += 1;
      lastTool = event.name;
      lastTarget = summarizeToolTargetFromEvent(event);
    }
    originalEmit(event);
  };
  child.emitEvent = progressEmit;
  const timer = setInterval(() => {
    const total = child.usage.data().total;
    const stats: SubagentProgressStats = {
      toolCount,
      lastTool,
      lastTarget,
      tokens:
        total === undefined
          ? 0
          : total.inputOther + total.output + total.inputCacheRead + total.inputCacheCreation,
    };
    const now = Date.now();
    const elapsedMs = now - startedAt;
    const budgetRemainingMs = budgetMs === undefined || budgetMs <= 0
      ? undefined
      : Math.max(0, budgetMs - elapsedMs);
    parent.emitEvent({
      type: 'subagent.progress',
      subagentId: childId,
      subagentName: profileName,
      lastTool: stats.lastTool,
      lastTarget: stats.lastTarget,
      toolCount: stats.toolCount,
      elapsedMs,
      tokens: stats.tokens,
      budgetMs,
      budgetRemainingMs,
    });
    // Mirror real worker activity to an attached Job's ledger.
    reportJobWorkerProgress(childId, {
      phase: progressPhaseLabel(stats),
      lastHeartbeatAt: new Date(now).toISOString(),
      recentTools:
        stats.lastTool !== undefined
          ? [stats.lastTarget !== undefined ? `${stats.lastTool}:${stats.lastTarget}` : stats.lastTool]
          : undefined,
    });
    if (
      stats.toolCount - lastCheckpointToolCount >= CHECKPOINT_TOOL_DELTA &&
      !checkpointInFlight && !checkpointFailed
    ) {
      lastCheckpointToolCount = stats.toolCount;
      checkpointInFlight = writeProgressCheckpoint(child, childId, stats, elapsedMs, signal)
        .catch((error: unknown) => {
          checkpointError = error;
          checkpointFailed = true;
          log.warn('Worker checkpoint failed', { agentId: childId, error });
        })
        .finally(() => {
          checkpointInFlight = undefined;
        });
    }
  }, SUBAGENT_PROGRESS_INTERVAL_MS);
  // Progress reporting must never keep the event loop alive on its own.
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    if (child.emitEvent === progressEmit) child.emitEvent = originalEmit;
    await checkpointInFlight;
    if (checkpointFailed) throw checkpointError;
  };
}

/**
 * Extract a bounded target preview from a `tool.call.started` event. Tool
 * args arrive as an object (not the JSON string the old history walk saw),
 * so probe the same well-known keys and fall back to a raw slice.
 */
function summarizeToolTargetFromEvent(event: {
  readonly name: string;
  readonly args?: unknown;
}): string | undefined {
  const args = event.args;
  if (args === undefined || args === null) return undefined;
  if (typeof args === 'string') return summarizeToolTarget(args);
  if (typeof args !== 'object') return undefined;
  try {
    const parsed = args as Record<string, unknown>;
    for (const key of ['command', 'operation', 'description']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.length > 0) {
        return value.length > 80 ? `${value.slice(0, 80)}…` : value;
      }
    }
  } catch {
    // Fall through to the raw snippet below.
  }
  let raw: string;
  try {
    raw = JSON.stringify(args) ?? '';
  } catch {
    return undefined;
  }
  return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
}

/** Compact phase label for the job ledger snapshot, e.g. `Bash: pnpm test`. */
function progressPhaseLabel(stats: SubagentProgressStats): string {
  if (stats.lastTool === undefined) return 'starting';
  const target = stats.lastTarget === undefined ? '' : `: ${stats.lastTarget}`;
  return `${stats.lastTool}${target}`.slice(0, 80);
}

/** Mirror child tool calls, stdout chunks, and results onto the parent feed. */
export function attachToolStreamBridge(
  parent: Agent,
  child: Agent,
  childId: string,
  profileName: string,
  options: RunSubagentOptions,
): () => void {
  const originalEmitEvent = child.emitEvent;
  const toolNames = new Map<string, string>();
  const toolStreamEmit = function subagentToolStreamEmitEvent(event: AgentEvent) {
    originalEmitEvent(event);
    if (event.type === 'tool.call.started') {
      toolNames.set(event.toolCallId, event.name);
      // Structured chip detail (Phase 1-B) is computed from the FULL child
      // args before the preview truncation below.
      const detail = describeSubagentToolDetail(event.name, event.args);
      parent.emitEvent({
        type: 'subagent.tool_call',
        subagentId: childId,
        subagentName: profileName,
        parentToolCallId: options.parentToolCallId,
        toolCallId: event.toolCallId,
        name: event.name,
        argsPreview: previewSubagentToolArgs(event.args),
        ...(detail !== undefined ? { detail } : {}),
      });
      return;
    }
    if (event.type === 'tool.progress') {
      const custom = event.update.kind === 'custom' ? event.update.customData : undefined;
      const terminalId = custom !== null && typeof custom === 'object' && 'terminalId' in custom && typeof custom.terminalId === 'string'
        ? custom.terminalId : undefined;
      const preview = previewSubagentToolProgress(event.update);
      if (preview === undefined && terminalId === undefined) return;
      const name = toolNames.get(event.toolCallId);
      parent.emitEvent({
        type: 'subagent.tool_progress',
        subagentId: childId,
        toolCallId: event.toolCallId,
        ...(name !== undefined ? { name } : {}),
        kind: preview?.kind ?? 'status',
        textPreview: preview?.textPreview ?? `Terminal ${terminalId}`,
        ...(terminalId !== undefined ? { terminalId } : {}),
      });
      return;
    }
    if (event.type === 'tool.result') {
      const name = toolNames.get(event.toolCallId);
      if (name !== undefined) toolNames.delete(event.toolCallId);
      parent.emitEvent({
        type: 'subagent.tool_result',
        subagentId: childId,
        toolCallId: event.toolCallId,
        ...(name !== undefined ? { name } : {}),
        isError: event.isError,
        resultPreview: previewSubagentToolResult(event.output),
      });
    }
  };
  child.emitEvent = toolStreamEmit;
  return () => {
    if (child.emitEvent === toolStreamEmit) child.emitEvent = originalEmitEvent;
  };
}

async function writeProgressCheckpoint(
  child: Agent,
  childId: string,
  stats: SubagentProgressStats,
  elapsedMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const work = await snapshotChildWork(child, signal);
  writeSubagentCheckpoint(childId, {
    toolCount: stats.toolCount,
    lastTool: stats.lastTool,
    lastTarget: stats.lastTarget,
    tokens: stats.tokens,
    elapsedMs,
    dirtyFiles: work.dirtyFiles,
  });
}


/**
 * Live subagent telemetry: the `subagent.progress` / `subagent.stalled`
 * reporter (harness reform T3-7), the tool-call stream bridge that mirrors a
 * child's `tool.call.started` / `tool.result` events onto the parent
 * (Phase 1-A realtime overhaul), the todo-store bridge, and the checkpoint
 * writer that pairs with them (T4-5).
 *
 * Extracted from subagent-host so the host class body does not grow with
 * every new telemetry field. Each function takes the parent/child agents and
 * run options explicitly instead of closing over host state.
 */

import type { Agent } from '../../agent';
import type { AgentEvent } from '@superliora/protocol';
import {
  reportJobWorkerProgress,
  reportJobWorkerStalled,
} from '../../tools/builtin/job/job-worker-ledger-bridge';
import { TODO_STORE_KEY, type TodoItem } from '../../tools/builtin/state/todo-list';
import { snapshotChildWork } from './subagent-result-contract';
import { writeSubagentCheckpoint } from './subagent-checkpoint';
import {
  collectSubagentProgressStats,
  describeSubagentToolDetail,
  previewSubagentToolArgs,
  previewSubagentToolResult,
  type SubagentProgressStats,
} from './subagent-progress-preview';
import type { RunSubagentOptions } from './subagent-host-types';

/** Cadence for subagent.progress telemetry (T3-7). */
const SUBAGENT_PROGRESS_INTERVAL_MS = 5_000;
/** Silence window before a subagent is reported stalled (T3-7). */
const SUBAGENT_STALL_MS = 300_000;
/** Checkpoint cadence: snapshot every N completed tool calls (T4-5). */
const CHECKPOINT_TOOL_DELTA = 10;
/** Finishing mode starts when this much budget remains (T4-5). */
const SUBAGENT_FINISHING_WINDOW_MS = 5 * 60 * 1000;
const SUBAGENT_FINISHING_REMINDER = [
  'Time budget is nearly exhausted — enter finishing mode now:',
  '- do not start new implementation work',
  '- run the verification still owed for completed work',
  '- then write the final structured summary of what is done and what remains',
].join('\n');

/**
 * Live telemetry for background subagents (harness reform T3-7): emits
 * `subagent.progress` every few seconds with the last tool, tool count,
 * elapsed time, and token spend, plus a one-shot `subagent.stalled` when
 * no tool call has happened for the stall window.
 */
export function startProgressReporter(
  parent: Agent,
  child: Agent,
  childId: string,
  profileName: string,
  budgetMs: number,
): () => void {
  const startedAt = Date.now();
  let lastToolCount = -1;
  let lastChangeAt = startedAt;
  let stalledReported = false;
  let finishingNotified = false;
  let lastCheckpointToolCount = 0;
  let checkpointInFlight = false;
  const timer = setInterval(() => {
    const stats = collectSubagentProgressStats(child);
    const now = Date.now();
    const elapsedMs = now - startedAt;
    const budgetRemainingMs = Math.max(0, budgetMs - elapsedMs);
    const finishing = budgetRemainingMs <= SUBAGENT_FINISHING_WINDOW_MS;
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
      finishing,
    });
    // Conductor Job lane: mirror the heartbeat onto the job ledger so
    // JobList/JobInspect and the desk injection see live worker state.
    // No-op for subagents that are not job workers.
    reportJobWorkerProgress(childId, {
      phase: progressPhaseLabel(stats, finishing),
      lastHeartbeatAt: new Date(now).toISOString(),
    });
    if (finishing && !finishingNotified) {
      finishingNotified = true;
      child.context.appendSystemReminder(SUBAGENT_FINISHING_REMINDER, {
        kind: 'system_trigger',
        name: 'subagent-finishing',
      });
    }
    if (stats.toolCount !== lastToolCount) {
      lastToolCount = stats.toolCount;
      lastChangeAt = now;
      stalledReported = false;
    } else if (!stalledReported && now - lastChangeAt >= SUBAGENT_STALL_MS) {
      stalledReported = true;
      parent.emitEvent({
        type: 'subagent.stalled',
        subagentId: childId,
        subagentName: profileName,
        silentMs: now - lastChangeAt,
        toolCount: stats.toolCount,
      });
      reportJobWorkerStalled(childId, now - lastChangeAt);
    }
    if (
      stats.toolCount - lastCheckpointToolCount >= CHECKPOINT_TOOL_DELTA &&
      !checkpointInFlight
    ) {
      lastCheckpointToolCount = stats.toolCount;
      checkpointInFlight = true;
      void writeProgressCheckpoint(child, childId, stats, elapsedMs)
        .catch(() => {})
        .finally(() => {
          checkpointInFlight = false;
        });
    }
  }, SUBAGENT_PROGRESS_INTERVAL_MS);
  // Progress reporting must never keep the event loop alive on its own.
  timer.unref?.();
  return () =>{  clearInterval(timer); };
}

/** Compact phase label for the job ledger snapshot, e.g. `Bash: pnpm test`. */
function progressPhaseLabel(stats: SubagentProgressStats, finishing: boolean): string {
  if (finishing) return 'finishing';
  if (stats.lastTool === undefined) return 'starting';
  const target = stats.lastTarget === undefined ? '' : `: ${stats.lastTarget}`;
  return `${stats.lastTool}${target}`.slice(0, 80);
}

/**
 * Live tool-call telemetry (Phase 1-A realtime overhaul): mirrors the
 * child's `tool.call.started` / `tool.result` agent events onto the parent
 * agent as truncated `subagent.tool_call` / `subagent.tool_result` events,
 * so clients can render a live per-subagent tool feed without subscribing
 * to every raw child event (and without huge wire payloads). Uses the same
 * instance-patch pattern as `attachSubagentTodoBridge`; the returned
 * disposer restores the original emitter.
 */
export function attachToolStreamBridge(
  parent: Agent,
  child: Agent,
  childId: string,
  profileName: string,
  options: RunSubagentOptions,
): () => void {
  const originalEmitEvent = child.emitEvent.bind(child);
  // UltraSwarm run correlation was retired (S3-R4); child tool streams no
  // longer carry a swarm run id.
  const runId: string | undefined = undefined;
  const toolNames = new Map<string, string>();
  child.emitEvent = (event: AgentEvent) => {
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
        ...(runId !== undefined ? { runId } : {}),
        toolCallId: event.toolCallId,
        name: event.name,
        argsPreview: previewSubagentToolArgs(event.args),
        ...(detail !== undefined ? { detail } : {}),
      });
      return;
    }
    if (event.type === 'tool.result') {
      const name = toolNames.get(event.toolCallId);
      if (name !== undefined) toolNames.delete(event.toolCallId);
      parent.emitEvent({
        type: 'subagent.tool_result',
        subagentId: childId,
        ...(runId !== undefined ? { runId } : {}),
        toolCallId: event.toolCallId,
        ...(name !== undefined ? { name } : {}),
        isError: event.isError,
        resultPreview: previewSubagentToolResult(event.output),
      });
    }
  };
  return () => {
    child.emitEvent = originalEmitEvent;
  };
}

async function writeProgressCheckpoint(
  child: Agent,
  childId: string,
  stats: SubagentProgressStats,
  elapsedMs: number,
): Promise<void> {
  const todos = normalizeTodoItems(child.tools.getStore().get(TODO_STORE_KEY));
  const work = await snapshotChildWork(child);
  writeSubagentCheckpoint(childId, {
    toolCount: stats.toolCount,
    lastTool: stats.lastTool,
    lastTarget: stats.lastTarget,
    tokens: stats.tokens,
    elapsedMs,
    todos,
    dirtyFiles: work.dirtyFiles,
  });
}

/**
 * Bridge the child's todo-list store updates onto the parent as
 * `subagent.todo.updated` events, so clients can render a live per-subagent
 * todo panel without polling the child's tool store directly.
 */
export function attachSubagentTodoBridge(
  parent: Agent,
  child: Agent,
  childId: string,
  profileName: string,
  options: RunSubagentOptions,
): void {
  type ToolManagerLike = {
    updateStore<K extends keyof import('../../tools/store').ToolStoreData>(
      key: K,
      value: import('../../tools/store').ToolStoreData[K],
    ): void;
  };
  const tools = child.tools as ToolManagerLike;
  const originalUpdateStore = tools.updateStore.bind(tools);
  tools.updateStore = (key, value) => {
    originalUpdateStore(key, value);
    if (key !== TODO_STORE_KEY) return;
    parent.emitEvent({
      type: 'subagent.todo.updated',
      subagentId: childId,
      subagentName: profileName,
      parentToolCallId: options.parentToolCallId,
      todos: normalizeTodoItems(value),
    });
  };
}

function normalizeTodoItems(value: unknown): readonly TodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isTodoItemLike).map((todo) => ({
    title: todo.title,
    status: todo.status,
  }));
}

function isTodoItemLike(value: unknown): value is TodoItem {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['title'] === 'string' &&
    (record['status'] === 'pending' ||
      record['status'] === 'in_progress' ||
      record['status'] === 'done')
  );
}

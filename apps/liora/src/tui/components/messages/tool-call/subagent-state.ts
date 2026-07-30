/**
 * Mutable subagent state owned by a `ToolCallComponent`. Groups the
 * SDK-event-driven fields (spawn/started/completed/failed, live sub-tool
 * activity, background-task terminal status) and their transition logic in
 * one place so `ToolCallComponent` stays a thin orchestrator: it forwards
 * SDK events here, then re-renders (`headerText.setText`, `rebuildContent`,
 * `notifySnapshotChange`, `ui?.requestRender()`) based on the boolean return
 * value where a transition may be a no-op.
 *
 * Rendering-only bookkeeping (`subagentBlockStartIndex`, the `Text`/`Container`
 * tree) and cross-cutting fields the component already owns (`toolCall`,
 * `result`, `workspaceDir`) stay on `ToolCallComponent` and are passed in
 * where needed.
 */
import type { TokenUsage } from '@superliora/sdk';
import { appendStreamingArgsPreview } from '#/tui/utils/event-payload';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import { parseArgsPreview, usageTotal } from './format';
import {
  appendSubToolLiveOutputText,
  backgroundFailureMessage,
  computeLatestActivity,
  deriveSubagentPhase,
  parseAgentIdFromToolResultOutput,
  subagentSpawnEntranceStartedAt,
  type FinishedSubCall,
  type OngoingSubCall,
  type SubagentPhase,
  type SubagentTextKind,
  type SubToolActivity,
  type ToolCallSubagentSnapshot,
} from './subagent';

const MAX_SUB_TOOL_CALLS_SHOWN = 4;

export class ToolCallSubagentState {
  agentId: string | undefined;
  agentName: string | undefined;
  modelAlias: string | undefined;
  readonly ongoingSubCalls = new Map<string, OngoingSubCall>();
  readonly finishedSubCalls: FinishedSubCall[] = [];
  readonly subToolActivities = new Map<string, SubToolActivity>();
  private subToolOrderSeq = 0;
  hiddenSubCallCount = 0;
  /**
   * Recent normal-output lines from the child agent. Historical replay can
   * also store mixed text here.
   */
  text = '';
  thinkingText = '';
  lastStreamKind: SubagentTextKind = 'text';
  phase: SubagentPhase | undefined;
  /**
   * Distinguishes a foreground subagent that the user detached via Ctrl+B
   * from one that started in the background. Both set `phase =
   * 'backgrounded'`, but only the detached one should keep showing `◐
   * backgrounded` after its spawn-success ToolResult lands — a
   * started-in-background agent reads as `done` once its result arrives.
   */
  detachedFromForeground = false;
  /**
   * Authoritative terminal phase for a backgrounded subagent. Set from
   * `BackgroundTaskInfo.status` via `setBackgroundTaskTerminalStatus` once
   * the backing task reaches a terminal state — either live (a bg agent
   * fails / is killed) or on resume (reconcile reclassifies a still-running
   * task as `lost`). Beats the spawn-success ToolResult in both render
   * paths, which would otherwise mislabel every terminated background agent
   * — including lost ones — as `✓ Completed`.
   */
  backgroundTaskTerminalPhase: 'done' | 'failed' | undefined;
  contextTokens: number | undefined;
  usage: TokenUsage | undefined;
  resultSummary: string | undefined;
  error: string | undefined;
  startedAtMs: number | undefined;
  /**
   * First-seen spawn clock for the subagent entrance settle (shared
   * animation clock, never a private timer). Undefined for replayed
   * subagents — `applyReplay` bypasses `onSpawned` — so history renders
   * without the entrance.
   */
  spawnEntranceAtMs: number | undefined;
  endedAtMs: number | undefined;
  spinnerFrame = 0;

  applyReplay(subagent: ToolCallBlockData['subagent']): void {
    if (subagent === undefined) return;
    this.agentId = subagent.id;
    this.agentName = subagent.name;
    this.text = subagent.text ?? '';
    for (const call of subagent.toolCalls ?? []) {
      if (call.result === undefined) {
        this.ongoingSubCalls.set(call.id, { name: call.name, args: call.args });
        this.upsertSubToolActivity(call.id, call.name, call.args, 'ongoing');
        continue;
      }
      this.finishedSubCalls.push({
        name: call.name,
        args: call.args,
        output: call.result.output,
        isError: call.result.is_error ?? false,
      });
      this.upsertSubToolActivity(
        call.id,
        call.name,
        call.args,
        call.result.is_error === true ? 'failed' : 'done',
        call.result.output,
      );
    }
    while (this.finishedSubCalls.length > MAX_SUB_TOOL_CALLS_SHOWN) {
      this.finishedSubCalls.shift();
      this.hiddenSubCallCount += 1;
    }
  }

  /** Returns `true` if meta actually changed (caller should re-render). */
  setMeta(agentId: string, agentName?: string): boolean {
    if (this.agentId === agentId && this.agentName === agentName) return false;
    this.agentId = agentId;
    this.agentName = agentName;
    return true;
  }

  /**
   * Immutable subagent state snapshot for `AgentGroupComponent` /
   * `ToolCallComponent.getSubagentSnapshot()`.
   *
   * `latestActivity` priority, used only while running:
   *   1. latest ongoing sub-tool (`Using {name} ({keyArg})`)
   *   2. latest finished sub-tool (`Used {name} ({keyArg})`)
   *   3. last non-empty line from accumulated subagent text
   *
   * Terminal-state priority for `phase`: SDK `tool.result` is authoritative
   * for Agent tool calls. Once it arrives, force done/failed over
   * intermediate spawning/running states for two reasons:
   *   1. Replay does not replay spawned/completed/failed events, so `phase`
   *      stays undefined and result must be used.
   *   2. Live type-validation failures may skip `subagent.failed`, or
   *      `tool.result` may arrive first; otherwise the UI can stay stuck at
   *      'spawning' and keep showing `Initializing...`.
   * Intermediate states without a result still use `phase`. `backgrounded`
   * has no result because background agents do not enter the transcript —
   * but a foreground subagent detached via Ctrl+B keeps `phase ===
   * 'backgrounded'` even after its ToolResult lands, so the group card
   * shows `◐ backgrounded` rather than `✓ Completed`. Reuse the standalone
   * derivation so both paths agree.
   */
  getSnapshot(params: {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly toolCallDescription: string;
    readonly workspaceDir: string | undefined;
    readonly result: ToolResultBlockData | undefined;
  }): ToolCallSubagentSnapshot {
    const finished = this.finishedSubCalls.length + this.hiddenSubCallCount;
    const contextTokens = this.contextTokens;
    const tokens =
      contextTokens && contextTokens > 0
        ? contextTokens
        : (this.usage === undefined ? 0 : usageTotal(this.usage));
    const latestActivity = computeLatestActivity(
      this.ongoingSubCalls,
      this.finishedSubCalls,
      this.getCombinedText(),
      params.workspaceDir,
    );
    const derivedPhase = this.getDerivedPhase(params.result);
    const errorText = this.error ?? (derivedPhase === 'failed' ? params.result?.output : undefined);
    return {
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      toolCallDescription: params.toolCallDescription,
      agentName: this.agentName,
      phase: derivedPhase,
      toolCount: finished,
      elapsedSeconds: this.getElapsedSeconds(),
      tokens,
      isError: derivedPhase === 'failed',
      errorText,
      latestActivity,
    };
  }

  private getCombinedText(): string {
    return [this.thinkingText, this.text].filter((s) => s.length > 0).join('\n');
  }

  finalizeElapsedIfNeeded(toolCallName: string): void {
    if (toolCallName === 'Agent' && this.startedAtMs !== undefined && this.endedAtMs === undefined) {
      this.endedAtMs = Date.now();
    }
  }

  /**
   * Handles SDK `subagent.spawned`. The child agent is registered with the
   * parent call, but its prompt may still be queued behind other subagents.
   * `onStarted` moves it to 'running' when the child turn actually begins.
   */
  onSpawned(
    meta: {
      agentId: string;
      agentName?: string | undefined;
      runInBackground: boolean;
      modelAlias?: string | undefined;
    },
    toolCallId: string,
  ): void {
    this.agentId = meta.agentId;
    this.agentName = meta.agentName;
    this.modelAlias = meta.modelAlias;
    this.phase = meta.runInBackground ? 'backgrounded' : 'queued';
    this.startedAtMs = Date.now();
    // Bounded entrance settle for the freshly appeared subagent chip/card —
    // first-seen guarded so remounts / clock-driven rebuilds never restart it.
    this.spawnEntranceAtMs = subagentSpawnEntranceStartedAt(toolCallId, meta.agentId);
    this.endedAtMs = undefined;
  }

  /** Handles SDK `subagent.started` once a queued child turn begins. */
  onStarted(meta: { agentId: string; agentName?: string | undefined; runInBackground: boolean }): void {
    this.agentId = meta.agentId;
    this.agentName = meta.agentName;
    if (!meta.runInBackground && (this.phase === undefined || this.phase === 'queued')) {
      this.phase = 'running';
    }
  }

  /**
   * Handles SDK `subagent.completed`. Moves the phase to 'done' and records
   * token usage plus the result summary for the header chip and tail summary.
   */
  onCompleted(payload: {
    contextTokens?: number | undefined;
    usage?: TokenUsage | undefined;
    resultSummary: string;
  }): void {
    this.phase = 'done';
    this.endedAtMs ??= Date.now();
    if (payload.contextTokens !== undefined && payload.contextTokens > 0) {
      this.contextTokens = payload.contextTokens;
    }
    this.usage = payload.usage;
    this.resultSummary = payload.resultSummary.length > 0 ? payload.resultSummary : undefined;
    if (this.text.trim().length === 0 && this.resultSummary !== undefined) {
      this.text = this.resultSummary;
    }
  }

  /** Handles SDK `agent.status.updated` from the child agent. */
  updateMetrics(payload: { contextTokens?: number | undefined; usage?: TokenUsage | undefined }): void {
    if (payload.contextTokens !== undefined && payload.contextTokens > 0) {
      this.contextTokens = payload.contextTokens;
    }
    if (payload.usage !== undefined) {
      this.usage = payload.usage;
    }
  }

  /** Handles SDK `subagent.failed`. */
  onFailed(payload: { error: string }): void {
    this.phase = 'failed';
    this.endedAtMs ??= Date.now();
    this.error = payload.error;
  }

  /**
   * Records the actual terminal status of the backing background task so
   * the snapshot phase no longer relies on the spawn-success ToolResult.
   * Called for `agent-*` background tasks both live (when the bg agent
   * terminates non-successfully) and on resume (when reconcile
   * reclassifies a previously-running task as `lost`). Returns `true` if
   * state actually changed (caller should re-render).
   */
  setBackgroundTaskTerminalStatus(
    status: 'completed' | 'failed' | 'timed_out' | 'killed' | 'lost',
    options: { errorText?: string | undefined } = {},
  ): boolean {
    const phase: 'done' | 'failed' = status === 'completed' ? 'done' : 'failed';
    const { errorText } = options;
    const phaseUnchanged = this.backgroundTaskTerminalPhase === phase;
    let errorChanged = false;
    if (phase === 'failed') {
      // Surface the failure line through the same `error` slot that
      // `onFailed` writes. The standalone card reads this in
      // `buildSingleSubagentBlock`; the group card reads it via `errorText`
      // in `getSnapshot`. Priority:
      //   1. Explicit `errorText` from the caller (the real message from a
      //      live `subagent.failed` event) always wins — it is the most
      //      informative.
      //   2. Existing `error` (could be from a prior `onFailed` or an
      //      earlier explicit override) is kept.
      //   3. Fall back to a friendly generic so the failure has SOME
      //      visible explanation when no source has supplied one.
      if (errorText !== undefined && this.error !== errorText) {
        this.error = errorText;
        errorChanged = true;
      } else if (this.error === undefined) {
        const generic = backgroundFailureMessage(status);
        if (generic !== undefined) {
          this.error = generic;
          errorChanged = true;
        }
      }
    }
    if (phaseUnchanged && !errorChanged) return false;
    this.backgroundTaskTerminalPhase = phase;
    this.endedAtMs ??= Date.now();
    return true;
  }

  /**
   * Mark a foreground subagent as detached-to-background. Called when a
   * `background.task.started` event arrives for this agent (i.e. the user
   * pressed Ctrl+B). Keeps the card showing `◐ backgrounded` instead of
   * flipping to `✓ Completed` when the spawn-success ToolResult lands.
   * Returns `true` if state actually changed.
   */
  markBackgrounded(): boolean {
    if (this.detachedFromForeground) return false;
    this.detachedFromForeground = true;
    this.phase = 'backgrounded';
    return true;
  }

  /**
   * Subagent id for the backing AgentTool call, used by routing to find a
   * tool call's backing subagent when reconciling background task lifecycle
   * events.
   *
   * Two writers, in priority order:
   *   1. In-memory `agentId` — wired by `setMeta` / `onSpawned` for
   *      foreground agents. For backgrounded agents this stays undefined:
   *      `handleSubagentSpawned` early-returns before calling
   *      `tc.onSubagentSpawned`, and `applyReplay` early-returns when the
   *      wire payload omits the `subagent` block — which it does for every
   *      replayed Agent call.
   *   2. The spawn-success ToolResult body — AgentTool unconditionally
   *      emits `agent_id: agent-N` for every Agent call (foreground and
   *      background). Parsing it gives the stable identifier even when the
   *      in-memory field is empty, which is the only way the resume path
   *      can reliably route a `background.task.terminated` to the right
   *      card and the only way the live path avoids matching by description
   *      and accidentally updating an unrelated Agent card that happens to
   *      share the same `args.description`.
   */
  getAgentId(toolCallName: string, result: ToolResultBlockData | undefined): string | undefined {
    if (this.agentId !== undefined) return this.agentId;
    if (toolCallName !== 'Agent' || result === undefined) return undefined;
    return parseAgentIdFromToolResultOutput(result.output);
  }

  appendText(text: string, kind: SubagentTextKind = 'text'): void {
    this.lastStreamKind = kind;
    if (kind === 'thinking') {
      this.thinkingText += text;
    } else {
      this.text += text;
    }
    // Child-agent activity means it is running unless already terminal/backgrounded.
    if (this.phase === undefined || this.phase === 'queued' || this.phase === 'spawning') {
      this.phase = 'running';
    }
  }

  appendSubToolCall(call: { id: string; name: string; args: Record<string, unknown> }): void {
    const existing = this.ongoingSubCalls.get(call.id);
    this.ongoingSubCalls.set(call.id, {
      name: call.name,
      args: call.args,
      ...(existing?.streamingArguments !== undefined
        ? { streamingArguments: existing.streamingArguments }
        : {}),
    });
    this.upsertSubToolActivity(call.id, call.name, call.args, 'ongoing');
    if (this.phase === undefined || this.phase === 'queued' || this.phase === 'spawning') {
      this.phase = 'running';
    }
  }

  appendSubToolCallDelta(delta: { id: string; name?: string | undefined; argumentsPart: string | null }): void {
    const existing = this.ongoingSubCalls.get(delta.id);
    const nextArgsText = appendStreamingArgsPreview(existing?.streamingArguments, delta.argumentsPart);
    const parsed = parseArgsPreview(nextArgsText);
    this.ongoingSubCalls.set(delta.id, {
      name: delta.name ?? existing?.name ?? 'Tool',
      args: parsed,
      streamingArguments: nextArgsText,
    });
    this.upsertSubToolActivity(delta.id, delta.name ?? existing?.name ?? 'Tool', parsed, 'ongoing');
    if (this.phase === undefined || this.phase === 'queued' || this.phase === 'spawning') {
      this.phase = 'running';
    }
  }

  /** Returns `true` if state actually changed (caller should re-render). */
  appendSubToolLiveOutput(id: string, text: string): boolean {
    if (text.length === 0) return false;
    const activity = this.subToolActivities.get(id);
    const ongoing = this.ongoingSubCalls.get(id);
    if (activity === undefined && ongoing === undefined) return false;
    const name = activity?.name ?? ongoing?.name ?? 'Tool';
    const args = activity?.args ?? ongoing?.args ?? {};
    const output = appendSubToolLiveOutputText(activity?.output ?? '', text);
    this.upsertSubToolActivity(id, name, args, activity?.phase ?? 'ongoing', output);
    return true;
  }

  /** Returns `true` if state actually changed (caller should re-render). */
  finishSubToolCall(result: { tool_call_id: string; output: string; is_error?: boolean | undefined }): boolean {
    const ongoing = this.ongoingSubCalls.get(result.tool_call_id);
    if (ongoing === undefined) return false;
    this.ongoingSubCalls.delete(result.tool_call_id);
    this.finishedSubCalls.push({
      name: ongoing.name,
      args: ongoing.args,
      output: result.output,
      isError: result.is_error ?? false,
    });
    this.upsertSubToolActivity(
      result.tool_call_id,
      ongoing.name,
      ongoing.args,
      result.is_error === true ? 'failed' : 'done',
      result.output,
    );
    while (this.finishedSubCalls.length > MAX_SUB_TOOL_CALLS_SHOWN) {
      this.finishedSubCalls.shift();
      this.hiddenSubCallCount += 1;
    }
    return true;
  }

  hasState(): boolean {
    return (
      this.agentId !== undefined ||
      this.ongoingSubCalls.size > 0 ||
      this.finishedSubCalls.length > 0 ||
      this.subToolActivities.size > 0 ||
      this.text.length > 0 ||
      this.thinkingText.length > 0 ||
      this.phase !== undefined ||
      this.backgroundTaskTerminalPhase !== undefined
    );
  }

  getDerivedPhase(result: ToolResultBlockData | undefined): SubagentPhase | undefined {
    return deriveSubagentPhase({
      backgroundTaskTerminalPhase: this.backgroundTaskTerminalPhase,
      detachedFromForeground: this.detachedFromForeground,
      subagentPhase: this.phase,
      result,
    });
  }

  getElapsedSeconds(): number | undefined {
    if (this.startedAtMs === undefined) return undefined;
    const end = this.endedAtMs ?? Date.now();
    return Math.max(0, Math.floor((end - this.startedAtMs) / 1000));
  }

  private upsertSubToolActivity(
    id: string,
    name: string,
    args: Record<string, unknown>,
    phase: SubToolActivity['phase'],
    output?: string,
  ): void {
    const existing = this.subToolActivities.get(id);
    if (existing !== undefined) {
      existing.name = name;
      existing.args = args;
      existing.phase = phase;
      if (output !== undefined) existing.output = output;
      return;
    }
    this.subToolActivities.set(id, {
      id,
      name,
      args,
      phase,
      ...(output !== undefined ? { output } : {}),
      orderSeq: ++this.subToolOrderSeq,
    });
  }
}
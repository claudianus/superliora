import type { Event, TeamPlan } from '@superliora/sdk';

import {
  AgentSwarmProgressComponent,
  agentSwarmDescriptionFromArgs,
  agentSwarmGridHeightForTerminalRows,
  swarmProgressTitleForToolName,
} from '../../components/messages/agent-swarm-progress/index';
import type { TodoItem } from '../../components/chrome/todo/todo-panel-types';
import { describeSubagentToolFeedBody } from '../../components/subagents/subagent-activity';
import type { ToolResultBlockData, AppState } from '../../types';
import type { TUIState } from '../../tui-state';
import { argsRecord } from '../../utils/event-payload';
import {
  buildWarRoomRestaffSteerDirective,
  formatWarRoomRestaffReason,
  resolveWarRoomReason,
} from '../../features/agent-swarm/war-room-action';
import type { WarRoomExpertView } from '../../utils/war-room-experts';
import type { StreamingUIController } from '../streaming-ui/index';
import {
  isUserCancelledSubagentError,
  renderedRowsAfterChild,
  subagentFailureRetryNote,
  ultraSwarmMembersFromTeam,
  type SubagentLifecycleEventOf,
} from './helpers';

/** Host surface required by swarm progress coordination. */
export interface SubagentSwarmHost {
  readonly state: TUIState;
  setAppState(patch: Partial<AppState>): void;
  readonly session:
    | {
        pauseUltrawork(input: { reason: string }): Promise<unknown>;
        swarmRestaff(input: { reason: string }): Promise<boolean>;
        steer(text: string): Promise<unknown>;
      }
    | undefined;
  readonly streamingUI: StreamingUIController;
  showError(message: string): void;
  updateActivityPane(): void;
}

export class SubagentSwarmCoordinator {
  private readonly progressByToolCallId = new Map<string, AgentSwarmProgressComponent>();
  private readonly teamsByToolCallId = new Map<string, TeamPlan>();

  constructor(
    private readonly host: SubagentSwarmHost,
    private readonly requestRender: () => void,
  ) {}

  reset(): void {
    this.clearProgress();
    this.teamsByToolCallId.clear();
    this.host.setAppState({ makerCheckerSoftWarn: null });
  }

  hasProgress(toolCallId: string): boolean {
    return this.progressByToolCallId.has(toolCallId);
  }

  isOrchestrated(parentToolCallId: string): boolean {
    return (
      this.progressByToolCallId.has(parentToolCallId) ||
      this.teamsByToolCallId.has(parentToolCallId)
    );
  }

  clearProgress(): void {
    for (const progress of this.progressByToolCallId.values()) {
      progress.dispose();
    }
    this.progressByToolCallId.clear();
    this.host.updateActivityPane();
  }

  applyRoutingDecision(routing: {
    readonly decision: string;
    readonly intensity: string;
    readonly estimatedExperts: number;
  }): void {
    for (const progress of this.progressByToolCallId.values()) {
      progress.applyRoutingDecision(routing);
    }
  }

  applyCouncilDecision(input: { readonly decision: string; readonly reason?: string }): void {
    for (const progress of this.progressByToolCallId.values()) {
      progress.applyCouncilDecision(input);
    }
  }

  applySwarmPaused(input: { readonly reason: string; readonly phase?: string }): void {
    for (const progress of this.progressByToolCallId.values()) {
      progress.applySwarmPaused(input);
    }
  }

  /**
   * Invoke War Room action dock on every live UltraSwarm/AgentSwarm progress card.
   * Returns how many components accepted the action (0 if none active).
   */
  invokeWarRoomAction(
    action: 'pause' | 'restaff' | 'raw',
    options: { readonly reason?: string } = {},
  ): number {
    let count = 0;
    for (const progress of this.progressByToolCallId.values()) {
      if (!progress.isToolCallActive()) continue;
      if (action === 'pause') {
        progress.requestPause({
          reason: resolveWarRoomReason('pause', options.reason),
        });
      } else if (action === 'restaff') {
        progress.requestRestaff({
          reason: resolveWarRoomReason('restaff', options.reason),
        });
      } else {
        progress.toggleRawFeed();
      }
      count += 1;
    }
    if (count > 0) this.requestRender();
    return count;
  }

  /**
   * Experts from the most recent active UltraSwarm / AgentSwarm war room card.
   * Prefers a still-active tool call; otherwise the last registered progress card.
   */
  listWarRoomExperts(): readonly WarRoomExpertView[] {
    let fallback: WarRoomExpertView[] = [];
    for (const progress of this.progressByToolCallId.values()) {
      const experts = progress.listWarRoomExperts();
      if (experts.length === 0) continue;
      if (progress.isToolCallActive()) return experts;
      fallback = [...experts];
    }
    return fallback;
  }

  hasActiveToolCall(): boolean {
    return Array.from(this.progressByToolCallId.values()).some((progress) =>
      progress.isToolCallActive(),
    );
  }

  syncActivitySpinner(spinner: { renderGlyph(): string } | undefined): void {
    for (const progress of this.progressByToolCallId.values()) {
      progress.setActivitySpinnerText(
        spinner === undefined ? undefined : () => spinner.renderGlyph(),
      );
    }
  }

  handleToolCallStarted(
    toolCallId: string,
    args: Record<string, unknown>,
    toolName = 'AgentSwarm',
  ): void {
    const progress = this.ensureProgress(toolCallId, args, { toolName });
    progress.markInputComplete();
    this.requestRender();
  }

  handleToolCallDelta(
    toolCallId: string,
    args: Record<string, unknown>,
    options: { readonly streamingArguments?: string | undefined },
    toolName = 'AgentSwarm',
  ): void {
    this.ensureProgress(toolCallId, args, { ...options, toolName });
    this.requestRender();
  }

  handleToolResult(toolCallId: string, resultData: ToolResultBlockData, isError: boolean): void {
    const progress = this.progressByToolCallId.get(toolCallId);
    if (progress === undefined) return;

    if (isError && isUserCancelledSubagentError(resultData.output)) {
      if (progress.isRequestStreaming()) {
        this.removeProgress(toolCallId, progress);
      } else {
        progress.markToolCallEnded();
        progress.markActiveCancelled();
      }
    } else if (isError) {
      progress.markToolCallEnded();
      if (!progress.applyResult(resultData.output)) {
        progress.markSwarmFailed(resultData.output);
      }
    } else {
      progress.markToolCallEnded();
      progress.applyResult(resultData.output);
    }
    this.host.updateActivityPane();
    this.requestRender();
  }

  handleTeamStaffed(event: Extract<Event, { type: 'ultrawork.team.staffed' }>): void {
    if (event.toolCallId === undefined) return;
    this.teamsByToolCallId.set(event.toolCallId, event.team);
    this.updateProgress(event.toolCallId, (progress) => {
      progress.applyUltraSwarmTeam(ultraSwarmMembersFromTeam(event.team));
      // Adaptive restaff / second staffing wave ends the dock restaffing state.
      if (progress.isRestaffing()) {
        progress.applySwarmRestaffing({ active: false });
      }
    });
  }

  /**
   * Routes a collaboration message into the live UltraSwarm feed.
   * @returns true when an active swarm progress component owned the feed line
   */
  handleCollaborationMessage(
    event: Extract<Event, { type: 'ultrawork.collaboration.message' }>,
  ): boolean {
    const toolCallId = event.message.parentToolCallId;
    if (toolCallId.length === 0) return false;
    return this.updateProgress(toolCallId, (progress) => {
      progress.applySwarmCollaborationMessage(event.message);
    });
  }

  /**
   * Routes a collaboration mention into the live UltraSwarm feed.
   * @returns true when an active swarm progress component owned the feed line
   */
  handleCollaborationMention(
    event: Extract<Event, { type: 'ultrawork.collaboration.mention' }>,
  ): boolean {
    const toolCallId = event.message.parentToolCallId;
    if (toolCallId.length === 0) return false;
    return this.updateProgress(toolCallId, (progress) => {
      progress.applySwarmCollaborationMention(event.message);
    });
  }

  /**
   * Routes debate turns into active UltraSwarm war-room reels.
   * Debate events are run-scoped (no parentToolCallId), so broadcast to live swarms.
   * @returns true when at least one swarm progress component accepted the turn
   */
  handleCollaborationDebate(
    event: Extract<Event, { type: 'ultrawork.collaboration.debate' }>,
  ): boolean {
    let owned = false;
    for (const progress of this.progressByToolCallId.values()) {
      progress.applySwarmCollaborationDebate({
        debateId: event.debateId,
        phase: event.phase,
        expertId: event.expertId,
        expertName: event.expertName,
        text: event.text,
        stance: event.stance,
      });
      owned = true;
    }
    return owned;
  }

  /**
   * Routes steer turns into active UltraSwarm war-room reels.
   * @returns true when at least one swarm progress component accepted the turn
   */
  handleCollaborationSteer(
    event: Extract<Event, { type: 'ultrawork.collaboration.steer' }>,
  ): boolean {
    let owned = false;
    for (const progress of this.progressByToolCallId.values()) {
      progress.applySwarmCollaborationSteer({
        debateId: event.debateId,
        text: event.text,
        fromUser: event.fromUser,
      });
      owned = true;
    }
    return owned;
  }

  markActiveCancelled(): void {
    let updated = false;
    for (const [toolCallId, progress] of this.progressByToolCallId) {
      if (progress.isRequestStreaming()) {
        this.removeProgress(toolCallId, progress);
        updated = true;
        continue;
      }
      progress.markActiveCancelled();
      updated = true;
    }
    if (updated) this.requestRender();
  }

  applyChildAgentEvent(
    parentToolCallId: string,
    event: Event,
    subagentId: string,
  ): boolean {
    const progress = this.progressByToolCallId.get(parentToolCallId);
    if (progress === undefined) return false;
    if (event.type === 'assistant.delta' || event.type === 'thinking.delta') {
      progress.appendModelDelta({ agentId: subagentId, delta: event.delta });
    } else if (event.type === 'tool.call.started') {
      progress.recordToolCall({
        agentId: subagentId,
        toolCallId: event.toolCallId,
        toolName: event.name,
        toolDescription: event.description,
      });
      // War Room file map: surface Edit/Write path claims for the active worker.
      if (event.name === 'Edit' || event.name === 'Write') {
        const args = argsRecord(event.args);
        const pathValue = args['path'];
        const path = typeof pathValue === 'string' ? pathValue.trim() : '';
        if (path.length > 0) {
          progress.applyFileLeaseClaim({ path, owner: subagentId });
        }
      }
    } else if (event.type === 'tool.result') {
      const summary =
        typeof event.output === 'string'
          ? event.output.slice(0, 80)
          : undefined;
      progress.recordToolResult({
        agentId: subagentId,
        toolCallId: event.toolCallId,
        isError: event.isError,
        summary,
      });
    }
    this.requestRender();
    return true;
  }

  /**
   * Swarm lane tool activity (Phase 1-B): mirrors structured tool calls into
   * the owning member's ops feed so each parallel lane shows live work with
   * the same chip detail as the background panel. Successful results are
   * skipped — the member grid already pulses on them — while failures land
   * as `fail` feed entries.
   */
  routeToolActivity(
    event: Extract<Event, { type: 'subagent.tool_call' | 'subagent.tool_result' }>,
    parentToolCallId: string,
  ): void {
    const progress = this.progressByToolCallId.get(parentToolCallId);
    if (progress === undefined) return;
    if (event.type === 'subagent.tool_call') {
      progress.appendMemberToolFeed({
        agentId: event.subagentId,
        body: describeSubagentToolFeedBody(event.name, event.detail, event.argsPreview),
        // Phase 5-A: drives the per-member ✎ code-write pulse in the grid.
        toolName: event.name,
      });
      this.requestRender();
      return;
    }
    if (event.isError !== true) return;
    const preview =
      event.resultPreview === undefined || event.resultPreview.length === 0
        ? ''
        // Bound the failure note; the emitter already caps at ~500 chars.
        : ` · ${event.resultPreview.slice(0, 120)}`;
    progress.appendMemberToolFeed({
      agentId: event.subagentId,
      body: `✗ ${event.name ?? 'tool'}${preview}`,
      isError: true,
    });
    this.requestRender();
  }

  registerSubagent(
    parentToolCallId: string,
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): boolean {
    return this.updateProgress(parentToolCallId, (progress) => {
      progress.registerSubagent({
        agentId: event.subagentId,
        swarmIndex: event.swarmIndex,
        modelAlias: event.modelAlias,
      });
    });
  }

  markStarted(parentToolCallId: string, subagentId: string): boolean {
    return this.updateProgress(parentToolCallId, (progress) => {
      progress.markStarted(subagentId);
    });
  }

  markSuspended(
    parentToolCallId: string,
    input: { readonly agentId: string; readonly reason: string; readonly swarmIndex?: number },
  ): boolean {
    return this.updateProgress(parentToolCallId, (progress) => {
      progress.markSuspended(input);
    });
  }

  markCompleted(
    parentToolCallId: string,
    subagentId: string,
    resultSummary: string | undefined,
  ): boolean {
    return this.updateProgress(parentToolCallId, (progress) => {
      progress.markCompleted(subagentId, resultSummary);
    });
  }

  markFailedOrCancelled(
    parentToolCallId: string,
    subagentId: string,
    error: string,
    event?: SubagentLifecycleEventOf<'subagent.failed'>,
  ): boolean {
    return this.updateProgress(parentToolCallId, (progress) => {
      if (isUserCancelledSubagentError(error)) {
        progress.markCancelled(subagentId);
      } else {
        const retryNote = event === undefined ? undefined : subagentFailureRetryNote(event);
        progress.markFailed(
          subagentId,
          error,
          retryNote === undefined ? undefined : { retryNote },
        );
      }
    });
  }

  applyMemberTodos(
    parentToolCallId: string,
    subagentId: string,
    todos: readonly { title: string; status: string }[],
  ): void {
    const progress = this.progressByToolCallId.get(parentToolCallId);
    if (progress === undefined) return;
    progress.applyMemberTodos(subagentId, todos as readonly TodoItem[]);
  }

  private updateProgress(
    parentToolCallId: string,
    update: (progress: AgentSwarmProgressComponent) => void,
  ): boolean {
    const progress = this.progressByToolCallId.get(parentToolCallId);
    if (progress === undefined) return false;
    update(progress);
    this.requestRender();
    return true;
  }

  /**
   * War-room action dock pause: pause active Ultrawork/UltraSwarm run when a session exists.
   */
  private handleWarRoomPauseRequest(request: {
    readonly reason?: string;
    readonly phase?: string;
  }): void {
    const session = this.host.session;
    if (session === undefined) return;
    const reason = resolveWarRoomReason('pause', request.reason);
    void session.pauseUltrawork({ reason }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.host.showError(`Failed to pause Fleet: ${message}`);
    });
  }

  /**
   * War-room action dock restaff: force an UltraSwarm adaptive restaff wave via
   * session.swarmRestaff (Agent.swarmRestaff). Falls back to steer text when the
   * RPC rejects or no UltraSwarm run is active.
   */
  private handleWarRoomRestaffRequest(request: {
    readonly reason?: string;
    readonly phase?: string;
  }): void {
    const session = this.host.session;
    if (session === undefined) return;
    const reasonWithPhase = formatWarRoomRestaffReason(request);
    void session
      .swarmRestaff({ reason: reasonWithPhase })
      .then((accepted) => {
        if (accepted) return;
        // No active UltraSwarm run context — keep steer fallback for older paths.
        return session.steer(buildWarRoomRestaffSteerDirective(request));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.host.showError(`Failed to request Fleet restaff: ${message}`);
      });
  }

  private ensureProgress(
    toolCallId: string,
    args: Record<string, unknown>,
    options: {
      readonly streamingArguments?: string | undefined;
      readonly toolName?: string | undefined;
    } = {},
  ): AgentSwarmProgressComponent {
    const existing = this.progressByToolCallId.get(toolCallId);
    if (existing !== undefined) {
      existing.updateArgs(args, options);
      return existing;
    }

    const isUltraSwarm = (options.toolName ?? 'AgentSwarm') === 'UltraSwarm';
    const progress = new AgentSwarmProgressComponent({
      description: agentSwarmDescriptionFromArgs(args),
      title: swarmProgressTitleForToolName(options.toolName ?? 'AgentSwarm'),
      availableGridHeight: () => this.gridHeight(isUltraSwarm),
      requestRender: () => {
        this.requestRender();
      },
      onRequestPause: isUltraSwarm
        ? (request) => {
            this.handleWarRoomPauseRequest(request);
          }
        : undefined,
      onRequestRestaff: isUltraSwarm
        ? (request) => {
            this.handleWarRoomRestaffRequest(request);
          }
        : undefined,
      onGovernanceSoftWarn: (warn) => {
        this.host.setAppState({ makerCheckerSoftWarn: warn ?? null });
      },
    });
    progress.updateArgs(args, options);
    const team = this.teamsByToolCallId.get(toolCallId);
    if (team !== undefined) {
      progress.applyUltraSwarmTeam(ultraSwarmMembersFromTeam(team));
    }
    this.progressByToolCallId.set(toolCallId, progress);
    this.host.streamingUI.finalizeLiveTextBuffers('tool');
    this.host.state.transcriptContainer.addChild(progress);
    this.host.updateActivityPane();
    this.requestRender();
    return progress;
  }

  private removeProgress(toolCallId: string, progress: AgentSwarmProgressComponent): void {
    this.progressByToolCallId.delete(toolCallId);
    progress.dispose();
    this.host.state.transcriptContainer.removeChild(progress);
    this.host.state.transcriptContainer.invalidatePaint();
    this.host.updateActivityPane();
  }

  private gridHeight(opsFeed = false): number | undefined {
    const { state } = this.host;
    const terminalRows = state.ui.terminal.rows;
    const terminalColumns = state.ui.terminal.columns;
    if (!Number.isFinite(terminalColumns) || terminalColumns <= 0) {
      return agentSwarmGridHeightForTerminalRows(terminalRows, 0, { opsFeed });
    }

    const width = Math.floor(terminalColumns);
    const rowsAfterSwarm = renderedRowsAfterChild(
      state.ui.children,
      state.transcriptContainer,
      width,
    );
    return agentSwarmGridHeightForTerminalRows(terminalRows, rowsAfterSwarm, { opsFeed });
  }
}

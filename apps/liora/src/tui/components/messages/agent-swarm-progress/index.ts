import { visibleWidth, type Component } from '#/tui/renderer';

import type { TodoItem } from '#/tui/components/chrome/todo/todo-panel';
import {
  AgentSwarmProgressEstimator,
} from '#/tui/components/messages/agent-swarm-progress/estimator';
import {
  AgentSwarmProgressMemberEvents,
  type AgentSwarmProgressMemberRuntime,
} from '#/tui/components/messages/agent-swarm-progress/member-events';
import { AgentSwarmProgressWarRoom } from '#/tui/components/messages/agent-swarm-progress/war-room';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  summarizeSnapshots,
  ultraSwarmMemberLabel,
} from '#/tui/features/agent-swarm/agent-swarm-cell-render';
import {
  agentSwarmDescriptionFromArgs,
  agentSwarmItemsFromArgs,
  agentSwarmPartialItemsFromArguments,
  agentSwarmPartialPromptTemplateFromArguments,
  agentSwarmPartialResumeItemsFromArguments,
  agentSwarmPromptTemplateFromArgs,
  agentSwarmResumeItemsFromArgs,
  swarmWorkItemsStartedFromArguments,
  ultraSwarmExpertItemsFromArgs,
  ultraSwarmPartialExpertItemsFromArguments,
} from '#/tui/features/agent-swarm/agent-swarm-result-parser';
import { calculateAgentSwarmGridLayout } from '#/tui/features/agent-swarm/agent-swarm-grid-layout';
import { updateAgentSwarmMemberItemTexts } from '#/tui/features/agent-swarm/agent-swarm-member-state';
import {
  indentAgentSwarmProgressLines,
  renderAgentSwarmProgressLayout,
  type AgentSwarmProgressLayoutRenderInput,
} from '#/tui/features/agent-swarm/agent-swarm-progress-layout-render';
import {
  AGENT_SWARM_FRAME_INTERVAL_MS,
  AGENT_SWARM_LEFT_INDENT,
  AGENT_SWARM_RIGHT_GAP,
} from '#/tui/features/agent-swarm/agent-swarm-progress-constants';
import {
  buildAgentSwarmSnapshots,
  hasAnimatedAgentSwarmMembers,
  shouldRequestAgentSwarmAnimationFrame,
  sortAgentSwarmMembersForGrid,
} from '#/tui/features/agent-swarm/agent-swarm-snapshot';
import {
  isSwarmProgressToolName,
  swarmProgressTitleForToolName,
} from '#/tui/features/agent-swarm/agent-swarm-tool-ident';

export {
  agentSwarmPartialItemsCountFromArguments,
  agentSwarmResultSummaryFromOutput,
} from '#/tui/features/agent-swarm/agent-swarm-result-parser';
export { agentSwarmGridHeightForTerminalRows } from '#/tui/features/agent-swarm/agent-swarm-grid-layout';
export { CODE_WRITE_QUIET_MS } from '#/tui/features/agent-swarm/agent-swarm-cell-render';
export {
  calculateAgentSwarmGridLayout,
  agentSwarmDescriptionFromArgs,
  agentSwarmItemsFromArgs,
  agentSwarmPartialItemsFromArguments,
};
export type {
  AgentSwarmActionDockRequest,
  AgentSwarmMember,
  AgentSwarmPauseRequest,
  AgentSwarmProgressOptions,
  AgentSwarmRestaffRequest,
  AgentSwarmSnapshot,
  AgentSwarmSummary,
  SwarmCollaborationFeedMessage,
  SwarmOpsFeedEntry,
  SwarmOpsFeedTag,
  TotalStatus,
  UltraSwarmMemberMetadata,
  WarRoomDebatePhase,
} from '#/tui/features/agent-swarm/agent-swarm-progress-types';
export { isSwarmProgressToolName, swarmProgressTitleForToolName };

import type {
  AgentSwarmPauseRequest,
  AgentSwarmProgressOptions,
  AgentSwarmRestaffRequest,
  SwarmCollaborationFeedMessage,
  UltraSwarmMemberMetadata,
} from '#/tui/features/agent-swarm/agent-swarm-progress-types';

export class AgentSwarmProgressComponent implements Component {
  private readonly progressEstimator = new AgentSwarmProgressEstimator();
  private readonly runtime: AgentSwarmProgressMemberRuntime;
  private readonly memberEvents: AgentSwarmProgressMemberEvents;
  private readonly warRoom: AgentSwarmProgressWarRoom;
  private description: string;
  private readonly title: string;
  private routingBadge: string | undefined;
  private readonly requestRender: (() => void) | undefined;
  private readonly availableGridHeight: (() => number | undefined) | undefined;
  private itemsStarted = false;
  private toolCallActive = true;
  private promptTemplateText = '';
  private activitySpinnerText: (() => string) | undefined;
  private lastFrameTickMs = 0;

  constructor(options: AgentSwarmProgressOptions) {
    this.description = options.description;
    this.title = options.title ?? 'Agent Swarm';
    this.requestRender = options.requestRender;
    this.availableGridHeight = options.availableGridHeight;
    this.runtime = {
      members: [],
      inputComplete: false,
      failed: false,
      aborted: false,
      swarmStartedAtMs: undefined,
      integrationReport: undefined,
    };
    this.memberEvents = new AgentSwarmProgressMemberEvents(
      this.runtime,
      this.progressEstimator,
      () => this.colors,
    );
    this.warRoom = new AgentSwarmProgressWarRoom(
      this.title,
      this.requestRender,
      options.onRequestPause,
      options.onRequestRestaff,
      () => this.runtime.members,
    );
  }

  /** Live palette, read on each render so a theme switch recolors the panel. */
  private get colors(): ColorPalette {
    return currentTheme.palette;
  }

  dispose(): void {
    // No private timer to clear — animation is clock-driven via
    // tickClockDrivenAnimation() called from render().
  }

  invalidate(): void {}

  setActivitySpinnerText(provider: (() => string) | undefined): void {
    if (!this.toolCallActive) return;
    this.activitySpinnerText = provider;
  }

  markToolCallEnded(): void {
    this.toolCallActive = false;
    this.activitySpinnerText = undefined;
  }

  isToolCallActive(): boolean {
    return this.toolCallActive;
  }

  isRequestStreaming(): boolean {
    return !this.runtime.inputComplete;
  }

  updateArgs(
    args: Record<string, unknown>,
    options: { readonly streamingArguments?: string | undefined } = {},
  ): void {
    const streamingArguments = options.streamingArguments;
    const description = agentSwarmDescriptionFromArgs(args);
    if (description.length > 0 || this.description.length === 0) {
      this.description = description;
    }
    const fullRows = [
      ...agentSwarmResumeItemsFromArgs(args),
      ...agentSwarmItemsFromArgs(args),
      ...ultraSwarmExpertItemsFromArgs(args),
    ];
    const partialRows = streamingArguments === undefined
      ? []
      : [
          ...agentSwarmPartialResumeItemsFromArguments(streamingArguments),
          ...agentSwarmPartialItemsFromArguments(streamingArguments),
          ...ultraSwarmPartialExpertItemsFromArguments(streamingArguments),
        ];
    if (
      fullRows.length > 0 ||
      partialRows.length > 0 ||
      (streamingArguments !== undefined && swarmWorkItemsStartedFromArguments(streamingArguments))
    ) {
      this.itemsStarted = true;
    }
    const fullPromptTemplate = agentSwarmPromptTemplateFromArgs(args);
    const partialPromptTemplate =
      streamingArguments === undefined
        ? ''
        : agentSwarmPartialPromptTemplateFromArguments(streamingArguments);
    const promptTemplate =
      fullPromptTemplate.length > 0 ? fullPromptTemplate : partialPromptTemplate;
    if (promptTemplate.length > 0 || this.promptTemplateText.length === 0) {
      this.promptTemplateText = promptTemplate;
    }

    const itemCount = Math.max(fullRows.length, partialRows.length);
    if (itemCount > 0) this.memberEvents.ensureMemberCount(itemCount);
    updateAgentSwarmMemberItemTexts(this.runtime.members, fullRows, partialRows);
  }

  applyUltraSwarmTeam(members: readonly UltraSwarmMemberMetadata[]): void {
    this.memberEvents.ensureMemberCount(members.length);
    for (let index = 0; index < members.length; index += 1) {
      const member = this.runtime.members[index];
      const metadata = members[index];
      if (member === undefined || metadata === undefined) continue;
      member.ultraSwarm = metadata;
      member.itemText = ultraSwarmMemberLabel(metadata);
    }
    this.itemsStarted = members.length > 0;
    this.warRoom.rebuildExpertSlotIndex();
  }

  applyRoutingDecision(routing: {
    readonly decision: string;
    readonly intensity: string;
    readonly estimatedExperts: number;
  }): void {
    this.routingBadge = `${routing.decision} · ${routing.intensity}`;
    this.requestRender?.();
  }

  applyCouncilDecision(input: {
    readonly decision: string;
    readonly reason?: string;
  }): void {
    this.warRoom.applyCouncilDecision(input);
  }

  applySwarmPaused(input: { readonly reason: string; readonly phase?: string }): void {
    this.warRoom.applySwarmPaused(input);
  }

  applySwarmResumed(): void {
    this.warRoom.applySwarmResumed();
  }

  applySwarmRestaffing(input: {
    readonly active: boolean;
    readonly reason?: string;
  }): void {
    this.warRoom.applySwarmRestaffing(input);
  }

  requestPause(input: AgentSwarmPauseRequest = {}): void {
    this.warRoom.requestPause(input);
  }

  requestRestaff(input: AgentSwarmRestaffRequest = {}): void {
    this.warRoom.requestRestaff(input);
  }

  toggleRawFeed(force?: boolean): boolean {
    return this.warRoom.toggleRawFeed(force);
  }

  isShowRawFeed(): boolean {
    return this.warRoom.isShowRawFeed();
  }

  isSwarmPaused(): boolean {
    return this.warRoom.isSwarmPaused();
  }

  isRestaffing(): boolean {
    return this.warRoom.isRestaffing();
  }

  applySwarmCollaborationMessage(message: SwarmCollaborationFeedMessage): void {
    this.warRoom.applySwarmCollaborationMessage(message);
  }

  applySwarmCollaborationMention(message: SwarmCollaborationFeedMessage): void {
    this.warRoom.applySwarmCollaborationMention(message);
  }

  applySwarmCollaborationDebate(input: {
    readonly debateId?: string;
    readonly phase: 'critic' | 'rebuttal' | 'counter-critique' | 'consensus';
    readonly expertId?: string;
    readonly expertName?: string;
    readonly text: string;
    readonly stance?: 'support' | 'oppose' | 'neutral';
  }): void {
    this.warRoom.applySwarmCollaborationDebate(input);
  }

  applySwarmCollaborationSteer(input: {
    readonly debateId?: string;
    readonly text: string;
    readonly fromUser?: boolean;
  }): void {
    this.warRoom.applySwarmCollaborationSteer(input);
  }

  applyFileLeaseClaim(input: {
    readonly path: string;
    readonly owner: string;
    readonly released?: boolean;
  }): void {
    this.warRoom.applyFileLeaseClaim(input);
  }

  markInputComplete(): void {
    this.memberEvents.markInputComplete();
    this.startAnimationIfNeeded();
  }

  registerSubagent(input: {
    readonly agentId: string;
    readonly swarmIndex?: number;
    readonly description?: string | undefined;
    readonly modelAlias?: string | undefined;
  }): void {
    this.memberEvents.registerSubagent(input);
    this.startAnimationIfNeeded();
  }

  markStarted(agentId: string): void {
    this.memberEvents.markStarted(agentId);
    this.startAnimationIfNeeded();
  }

  applyMemberTodos(agentId: string, todos: readonly TodoItem[]): void {
    this.memberEvents.applyMemberTodos(agentId, todos);
    this.startAnimationIfNeeded();
  }

  recordToolCall(input: Parameters<AgentSwarmProgressMemberEvents['recordToolCall']>[0]): void {
    this.memberEvents.recordToolCall(input);
    this.startAnimationIfNeeded();
  }

  recordToolResult(input: Parameters<AgentSwarmProgressMemberEvents['recordToolResult']>[0]): void {
    this.memberEvents.recordToolResult(input);
    this.startAnimationIfNeeded();
  }

  appendMemberToolFeed(input: Parameters<AgentSwarmProgressWarRoom['appendMemberToolFeed']>[0]): void {
    this.warRoom.appendMemberToolFeed(input);
  }

  appendModelDelta(input: Parameters<AgentSwarmProgressMemberEvents['appendModelDelta']>[0]): void {
    this.memberEvents.appendModelDelta(input);
  }

  markCompleted(agentId: string, completedText?: string): void {
    this.memberEvents.markCompleted(agentId, completedText);
    this.startAnimationIfNeeded();
  }

  markSuspended(input: Parameters<AgentSwarmProgressMemberEvents['markSuspended']>[0]): void {
    this.memberEvents.markSuspended(input);
    this.startAnimationIfNeeded();
  }

  markFailed(
    agentId: string,
    failureText?: string,
    meta?: { readonly retryNote?: string | undefined },
  ): void {
    this.memberEvents.markFailed(agentId, failureText, meta);
    this.startAnimationIfNeeded();
  }

  markSwarmFailed(failureText?: string): void {
    this.memberEvents.markSwarmFailed(failureText);
    this.startAnimationIfNeeded();
  }

  markCancelled(agentId: string): void {
    this.memberEvents.markCancelled(agentId);
  }

  markActiveCancelled(): void {
    this.memberEvents.markActiveCancelled();
    this.startAnimationIfNeeded();
  }

  applyResult(output: string): boolean {
    const applied = this.memberEvents.applyResult(output);
    if (applied) this.startAnimationIfNeeded();
    return applied;
  }

  render(width: number): string[] {
    this.tickClockDrivenAnimation();

    const outerWidth = Math.max(1, width);
    const innerWidth = Math.max(
      1,
      outerWidth - visibleWidth(AGENT_SWARM_LEFT_INDENT) - AGENT_SWARM_RIGHT_GAP,
    );
    const nowMs = Date.now();
    const snapshots = buildAgentSwarmSnapshots(this.runtime.members, nowMs);
    const summary = summarizeSnapshots(snapshots);
    const sortedMembers = sortAgentSwarmMembersForGrid(this.runtime.members);
    const sortedSnapshots = buildAgentSwarmSnapshots(sortedMembers, nowMs);
    const lines = renderAgentSwarmProgressLayout(
      this.layoutRenderInput(),
      innerWidth,
      summary,
      sortedMembers,
      sortedSnapshots,
      nowMs,
    );
    this.startAnimationIfNeeded();
    return indentAgentSwarmProgressLines(lines, outerWidth);
  }

  private layoutRenderInput(): AgentSwarmProgressLayoutRenderInput {
    const warRoom = this.warRoom.layoutSlice();
    return {
      title: this.title,
      description: this.description,
      routingBadge: this.routingBadge,
      colors: this.colors,
      members: this.runtime.members,
      integrationReport: this.runtime.integrationReport,
      debateReel: warRoom.debateReel,
      feedEvidenceIds: warRoom.feedEvidenceIds,
      feedPathHints: warRoom.feedPathHints,
      fileLeases: warRoom.fileLeases,
      opsFeed: warRoom.opsFeed,
      opsToolFeed: warRoom.opsToolFeed,
      showRawFeed: warRoom.showRawFeed,
      expertSlotById: warRoom.expertSlotById,
      failed: this.runtime.failed,
      aborted: this.runtime.aborted,
      toolCallActive: this.toolCallActive,
      activitySpinnerText: this.activitySpinnerText,
      swarmStartedAtMs: this.runtime.swarmStartedAtMs,
      inputComplete: this.runtime.inputComplete,
      itemsStarted: this.itemsStarted,
      promptTemplateText: this.promptTemplateText,
      swarmPaused: warRoom.swarmPaused,
      swarmPausedReason: warRoom.swarmPausedReason,
      swarmPausedPhase: warRoom.swarmPausedPhase,
      restaffing: warRoom.restaffing,
      restaffingReason: warRoom.restaffingReason,
      isUltraSwarm: warRoom.isUltraSwarm,
      availableGridHeight: this.availableGridHeight?.(),
      progressEstimator: this.progressEstimator,
    };
  }

  private startAnimationIfNeeded(): void {
    // No-op: animation is now clock-driven via tickClockDrivenAnimation()
    // called from render(). Kept as a stub so the many call sites don't need
    // to change.
  }

  private tickClockDrivenAnimation(): void {
    if (this.requestRender === undefined) return;
    const now = Date.now();
    const hasAnimatedMembers = hasAnimatedAgentSwarmMembers(
      this.runtime.members,
      now,
      this.progressEstimator.hasPendingCatchup(),
    );
    if (!hasAnimatedMembers) {
      this.lastFrameTickMs = 0;
      return;
    }
    if (!shouldRequestAgentSwarmAnimationFrame(
      this.lastFrameTickMs,
      now,
      AGENT_SWARM_FRAME_INTERVAL_MS,
      hasAnimatedMembers,
    )) return;
    this.lastFrameTickMs = now;
    this.requestRender();
  }
}

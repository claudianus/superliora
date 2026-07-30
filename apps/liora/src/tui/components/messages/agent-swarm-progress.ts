import { visibleWidth, type Component } from '#/tui/renderer';

import {
  AgentSwarmProgressEstimator,
} from '#/tui/components/messages/agent-swarm-progress-estimator';
import type { TodoItem } from '#/tui/components/chrome/todo-panel';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  collapseWhitespace,
  humanizeFeedBody,
  isAgentConversationChannel,
  isTerminalPhase,
  summarizeSnapshots,
  swarmCollaborationFeedTag,
  ultraSwarmMemberLabel,
} from '#/tui/utils/agent-swarm-cell-render';
import {
  agentSwarmDescriptionFromArgs,
  agentSwarmItemsFromArgs,
  agentSwarmPartialItemsFromArguments,
  agentSwarmPartialPromptTemplateFromArguments,
  agentSwarmPartialResumeItemsFromArguments,
  agentSwarmPromptTemplateFromArgs,
  agentSwarmResumeItemsFromArgs,
  parseAgentSwarmResultStatuses,
  parseUltraSwarmIntegrationReport,
  swarmWorkItemsStartedFromArguments,
  ultraSwarmExpertItemsFromArgs,
  ultraSwarmPartialExpertItemsFromArguments,
  type UltraSwarmIntegrationReport,
} from '#/tui/utils/agent-swarm-result-parser';
import { calculateAgentSwarmGridLayout } from '#/tui/utils/agent-swarm-grid-layout';
import {
  appendAgentSwarmConversationFeedEntry,
  appendAgentSwarmToolFeedEntry,
  rebuildAgentSwarmExpertSlotIndex,
} from '#/tui/utils/agent-swarm-feed-render';
import {
  collectAgentSwarmWarRoomHints,
  type WarRoomDebateTurn,
  type WarRoomFileLease,
} from '#/tui/utils/agent-swarm-header-render';
import {
  applyAgentSwarmMemberCancelled,
  applyAgentSwarmMemberCompleted,
  applyAgentSwarmMemberFailed,
  createAgentSwarmMembers,
  findAgentSwarmMemberByAgentId,
  promoteAgentSwarmMemberToRunning,
  resolveAgentSwarmMemberForSubagent,
  TERMINAL_CLEAR_KEYS,
  trackAgentSwarmMemberCodeWriteActivity,
  updateAgentSwarmMemberItemTexts,
  clearAgentSwarmMemberState,
} from '#/tui/utils/agent-swarm-member-state';
import {
  indentAgentSwarmProgressLines,
  renderAgentSwarmProgressLayout,
  type AgentSwarmProgressLayoutRenderInput,
} from '#/tui/utils/agent-swarm-progress-layout-render';
import {
  AGENT_SWARM_FRAME_INTERVAL_MS,
  AGENT_SWARM_LEFT_INDENT,
  AGENT_SWARM_MAX_LATEST_MODEL_CHARS,
  AGENT_SWARM_RIGHT_GAP,
  SWARM_OPS_FEED_MAX_ENTRIES,
} from '#/tui/utils/agent-swarm-progress-constants';
import {
  buildAgentSwarmSnapshots,
  hasAnimatedAgentSwarmMembers,
  shouldRequestAgentSwarmAnimationFrame,
  sortAgentSwarmMembersForGrid,
} from '#/tui/utils/agent-swarm-snapshot';
import {
  isSwarmProgressToolName,
  swarmProgressTitleForToolName,
} from '#/tui/utils/agent-swarm-tool-ident';
import {
  buildCouncilDecisionFeedDraft,
  buildSwarmPausedFeedDraft,
  buildSwarmRestaffingFeedDraft,
  trimAgentSwarmDebateReel,
} from '#/tui/utils/agent-swarm-war-room-feed';
import { resolveWarRoomReason } from '#/tui/utils/war-room-action';

export {
  agentSwarmPartialItemsCountFromArguments,
  agentSwarmResultSummaryFromOutput,
} from '#/tui/utils/agent-swarm-result-parser';
export { agentSwarmGridHeightForTerminalRows } from '#/tui/utils/agent-swarm-grid-layout';
export { CODE_WRITE_QUIET_MS } from '#/tui/utils/agent-swarm-cell-render';
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
} from '#/tui/utils/agent-swarm-progress-types';
export { isSwarmProgressToolName, swarmProgressTitleForToolName };

import type {
  AgentSwarmMember,
  AgentSwarmPauseRequest,
  AgentSwarmProgressOptions,
  AgentSwarmRestaffRequest,
  SwarmCollaborationFeedMessage,
  SwarmOpsFeedEntry,
  SwarmOpsFeedTag,
  UltraSwarmMemberMetadata,
} from '#/tui/utils/agent-swarm-progress-types';

export class AgentSwarmProgressComponent implements Component {
  private members: AgentSwarmMember[];
  private readonly progressEstimator = new AgentSwarmProgressEstimator();
  private description: string;
  private readonly title: string;
  private routingBadge: string | undefined;
  private readonly requestRender: (() => void) | undefined;
  private readonly availableGridHeight: (() => number | undefined) | undefined;
  private readonly onRequestPause: ((request: AgentSwarmPauseRequest) => void) | undefined;
  private readonly onRequestRestaff: ((request: AgentSwarmRestaffRequest) => void) | undefined;
  private inputComplete = false;
  private failed = false;
  private aborted = false;
  private itemsStarted = false;
  private toolCallActive = true;
  private promptTemplateText = '';
  private activitySpinnerText: (() => string) | undefined;
  private swarmStartedAtMs: number | undefined;
  private lastFrameTickMs = 0;
  private readonly opsFeed: SwarmOpsFeedEntry[] = [];
  private readonly opsToolFeed: SwarmOpsFeedEntry[] = [];
  /** Dedupe collaboration feed lines even when message + mention both fire. */
  private readonly seenCollaborationMessageIds = new Set<string>();
  private readonly expertSlotById = new Map<string, string>();
  private integrationReport: UltraSwarmIntegrationReport | undefined;
  /** Debate / steer turns for the war-room debate reel. */
  private readonly debateReel: WarRoomDebateTurn[] = [];
  /** Soft file-lease claims reported by workers or lease events. */
  private readonly fileLeases = new Map<string, WarRoomFileLease>();
  /** Evidence ids scraped from humanized collaboration bodies. */
  private readonly feedEvidenceIds = new Set<string>();
  /** Path-like tokens scraped from humanized collaboration bodies. */
  private readonly feedPathHints = new Set<string>();
  /** War-room action dock: swarm is paused for steering. */
  private swarmPaused = false;
  private swarmPausedReason: string | undefined;
  private swarmPausedPhase: string | undefined;
  /** War-room action dock: restaff in flight. */
  private restaffing = false;
  private restaffingReason: string | undefined;
  /** When true, feed shows raw protocol bodies for entries that have them. */
  private showRawFeed = false;

  constructor(options: AgentSwarmProgressOptions) {
    this.description = options.description;
    this.title = options.title ?? 'Agent Swarm';
    this.requestRender = options.requestRender;
    this.availableGridHeight = options.availableGridHeight;
    this.onRequestPause = options.onRequestPause;
    this.onRequestRestaff = options.onRequestRestaff;
    this.members = [];
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
    return !this.inputComplete;
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
    if (itemCount > 0) this.ensureMemberCount(itemCount);
    updateAgentSwarmMemberItemTexts(this.members, fullRows, partialRows);
  }

  applyUltraSwarmTeam(members: readonly UltraSwarmMemberMetadata[]): void {
    this.ensureMemberCount(members.length);
    for (let index = 0; index < members.length; index += 1) {
      const member = this.members[index];
      const metadata = members[index];
      if (member === undefined || metadata === undefined) continue;
      member.ultraSwarm = metadata;
      member.itemText = ultraSwarmMemberLabel(metadata);
    }
    this.itemsStarted = members.length > 0;
    this.rebuildExpertSlotIndex();
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
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    this.appendConversationFeed(buildCouncilDecisionFeedDraft(input));
    this.requestRender?.();
  }

  applySwarmPaused(input: { readonly reason: string; readonly phase?: string }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const paused = buildSwarmPausedFeedDraft(input);
    this.swarmPaused = true;
    this.swarmPausedReason = paused.pausedReason;
    this.swarmPausedPhase = paused.pausedPhase;
    this.appendConversationFeed(paused.feed);
    this.requestRender?.();
  }

  /**
   * Clear paused dock state after resume / redirect continues the run.
   */
  applySwarmResumed(): void {
    if (!this.swarmPaused) return;
    this.swarmPaused = false;
    this.swarmPausedReason = undefined;
    this.swarmPausedPhase = undefined;
    this.requestRender?.();
  }

  /**
   * Mark restaff as in-flight or finished so the action dock reflects status.
   * Host / UltraSwarm restaff path can call this around adaptive restaff.
   */
  applySwarmRestaffing(input: {
    readonly active: boolean;
    readonly reason?: string;
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    this.restaffing = input.active;
    this.restaffingReason =
      input.reason === undefined ? undefined : collapseWhitespace(input.reason);
    if (input.active) {
      this.appendConversationFeed(buildSwarmRestaffingFeedDraft(this.restaffingReason));
    }
    this.requestRender?.();
  }

  /**
   * Host-callable: request pause via optional callback and mark local paused state.
   * Keyboard/click wiring can call this without going through events first.
   */
  requestPause(input: AgentSwarmPauseRequest = {}): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const reason = resolveWarRoomReason(
      'pause',
      input.reason === undefined ? undefined : collapseWhitespace(input.reason),
    );
    this.onRequestPause?.({ reason, phase: input.phase });
    // Reflect immediately so the dock updates even if the host only wires the callback.
    if (!this.swarmPaused) {
      this.applySwarmPaused({ reason, phase: input.phase });
    } else {
      this.requestRender?.();
    }
  }

  /**
   * Host-callable: request restaff. Invokes onRequestRestaff when wired, then
   * marks restaffing status for the action dock.
   */
  requestRestaff(input: AgentSwarmRestaffRequest = {}): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const reason = resolveWarRoomReason(
      'restaff',
      input.reason === undefined ? undefined : collapseWhitespace(input.reason),
    );
    this.onRequestRestaff?.({ reason, phase: input.phase });
    this.applySwarmRestaffing({ active: true, reason });
  }

  /**
   * Toggle feed display between humanized and raw protocol bodies.
   * Returns the new showRawFeed value.
   */
  toggleRawFeed(force?: boolean): boolean {
    if (!this.isUltraSwarmOpsFeedEnabled()) return false;
    this.showRawFeed = force === undefined ? !this.showRawFeed : force;
    this.requestRender?.();
    return this.showRawFeed;
  }

  isShowRawFeed(): boolean {
    return this.showRawFeed;
  }

  isSwarmPaused(): boolean {
    return this.swarmPaused;
  }

  isRestaffing(): boolean {
    return this.restaffing;
  }

  applySwarmCollaborationMessage(message: SwarmCollaborationFeedMessage): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    if (!isAgentConversationChannel(message.channel)) return;
    const rawBody = message.body;
    const body = humanizeFeedBody(rawBody, {
      channel: message.channel,
      fromName: message.from.name,
      fromExpertId: message.from.expertId,
      toExpertId: message.to?.expertId,
    });
    this.collectWarRoomHintsFromText(body);
    this.appendConversationFeed({
      tag: swarmCollaborationFeedTag(message.channel),
      messageId: message.id,
      fromExpertId: message.from.expertId,
      fromName: message.from.name,
      fromEmoji: message.from.emoji,
      toExpertId: message.to?.expertId,
      body,
      rawBody,
    });
  }

  applySwarmCollaborationMention(message: SwarmCollaborationFeedMessage): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const rawBody = message.body;
    const body = humanizeFeedBody(rawBody, {
      channel: message.channel,
      tag: 'mention',
      fromName: message.from.name,
      fromExpertId: message.from.expertId,
      toExpertId: message.to?.expertId,
    });
    this.collectWarRoomHintsFromText(body);
    this.appendConversationFeed({
      tag: 'mention',
      messageId: message.id,
      fromExpertId: message.from.expertId,
      fromName: message.from.name,
      fromEmoji: message.from.emoji,
      toExpertId: message.to?.expertId,
      body,
      rawBody,
    });
  }

  /**
   * Record a collaboration debate turn for the war-room debate reel.
   * Headline is a short single-line scan of the turn text.
   */
  applySwarmCollaborationDebate(input: {
    readonly debateId?: string;
    readonly phase: 'critic' | 'rebuttal' | 'counter-critique' | 'consensus';
    readonly expertId?: string;
    readonly expertName?: string;
    readonly text: string;
    readonly stance?: 'support' | 'oppose' | 'neutral';
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const headline = collapseWhitespace(input.text);
    if (headline.length === 0) return;
    this.collectWarRoomHintsFromText(headline);
    this.pushDebateReelTurn({
      atMs: Date.now(),
      phase: input.phase,
      expertName: input.expertName ?? input.expertId,
      headline,
      debateId: input.debateId,
    });
    this.requestRender?.();
  }

  /**
   * Record a user/system steer event as a debate-reel turn (phase = steer).
   */
  applySwarmCollaborationSteer(input: {
    readonly debateId?: string;
    readonly text: string;
    readonly fromUser?: boolean;
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const headline = collapseWhitespace(input.text);
    if (headline.length === 0) return;
    this.collectWarRoomHintsFromText(headline);
    this.pushDebateReelTurn({
      atMs: Date.now(),
      phase: 'steer',
      expertName: input.fromUser === false ? 'system' : 'user',
      headline,
      debateId: input.debateId,
    });
    this.requestRender?.();
  }

  /**
   * Soft file-lease claim for the war-room file map.
   * Workers / lease events report path ownership; release drops the claim.
   */
  applyFileLeaseClaim(input: {
    readonly path: string;
    readonly owner: string;
    readonly released?: boolean;
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const path = collapseWhitespace(input.path);
    const owner = collapseWhitespace(input.owner);
    if (path.length === 0) return;
    if (input.released === true) {
      this.fileLeases.delete(path);
      this.requestRender?.();
      return;
    }
    if (owner.length === 0) return;
    this.fileLeases.set(path, { path, owner, atMs: Date.now() });
    this.requestRender?.();
  }

  markInputComplete(): void {
    if (!this.inputComplete) {
      this.inputComplete = true;
      this.ensureSwarmStartedAt(Date.now());
      for (const member of this.members) {
        if (member.phase === 'pending') member.phase = 'queued';
      }
    }
    this.startAnimationIfNeeded();
  }

  registerSubagent(input: {
    readonly agentId: string;
    readonly swarmIndex?: number;
    readonly description?: string | undefined;
    readonly modelAlias?: string | undefined;
  }): void {
    const member = resolveAgentSwarmMemberForSubagent(
      () => this.members,
      input.agentId,
      input.swarmIndex,
      (count) => this.ensureMemberCount(count),
    );
    if (member === undefined) return;
    member.agentId = input.agentId;
    if (input.modelAlias !== undefined) {
      const alias = collapseWhitespace(input.modelAlias);
      if (alias.length > 0) member.modelAlias = alias;
    }
    if (member.phase === 'pending') member.phase = 'queued';
    this.startAnimationIfNeeded();
  }

  markStarted(agentId: string): void {
    const member = findAgentSwarmMemberByAgentId(this.members, agentId);
    if (member === undefined) return;
    const nowMs = Date.now();
    this.progressEstimator.markStarted(member.id, nowMs);
    member.startedAtMs ??= nowMs;
    member.ticks = Math.max(member.ticks, 1);
    this.promoteToRunning(member, nowMs);
    this.startAnimationIfNeeded();
  }

  applyMemberTodos(agentId: string, todos: readonly TodoItem[]): void {
    const member = findAgentSwarmMemberByAgentId(this.members, agentId);
    if (member === undefined) return;
    member.todos = todos.map((todo) => ({ title: todo.title, status: todo.status }));
    this.startAnimationIfNeeded();
  }

  recordToolCall(input: {
    readonly agentId: string;
    readonly toolCallId: string;
    readonly toolName?: string;
    readonly toolDescription?: string;
  }): void {
    const member = findAgentSwarmMemberByAgentId(this.members, input.agentId);
    if (member === undefined) return;
    const result = this.progressEstimator.recordToolCall({
      memberKey: member.id,
      toolCallId: input.toolCallId,
      nowMs: Date.now(),
    });
    if (!result.accepted) return;
    member.ticks = result.rawTicks;
    if (input.toolName !== undefined && input.toolName.length > 0) {
      member.activeToolName = input.toolName;
    }
    this.promoteToRunning(member);
    this.startAnimationIfNeeded();
  }

  /**
   * Record that a tool call finished for this swarm member. The progress
   * estimator counts tool starts as activity pulses; a completion is surfaced
   * as another pulse so the grid reflects ongoing work rather than freezing
   * after the tool call started. An optional short summary is appended to the
   * member's latest text so the result is observable in the swarm grid.
   */
  recordToolResult(input: {
    readonly agentId: string;
    readonly toolCallId: string;
    readonly isError?: boolean;
    readonly summary?: string;
  }): void {
    const member = findAgentSwarmMemberByAgentId(this.members, input.agentId);
    if (member === undefined) return;
    delete member.activeToolName;
    member.ticks += 1;
    if (input.summary !== undefined && input.summary.length > 0) {
      const prefix = input.isError === true ? '⚠ ' : '';
      const line = `${prefix}${input.summary}`.slice(0, AGENT_SWARM_MAX_LATEST_MODEL_CHARS);
      member.latestModelText = line;
    }
    this.promoteToRunning(member);
    this.startAnimationIfNeeded();
  }

  /**
   * Live tool activity in the ops feed (Phase 1-B realtime overhaul):
   * appends a compact `Name target chip` line attributed to the member that
   * owns `agentId`, so each parallel lane shows the same structured tool
   * detail the background activity panel renders. Error results use the
   * `fail` tag so failures stand out in the lane.
   *
   * Phase 5-A: the optional `toolName` also drives the per-member code-write
   * pulse — Write/Edit marks the member as actively writing code; any other
   * tool (or an error result) clears the mark.
   */
  appendMemberToolFeed(input: {
    readonly agentId: string;
    readonly body: string;
    readonly isError?: boolean;
    readonly toolName?: string;
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const member = findAgentSwarmMemberByAgentId(this.members, input.agentId);
    if (member === undefined) return;
    trackAgentSwarmMemberCodeWriteActivity(member, input, Date.now());
    this.appendToolFeed({
      tag: input.isError === true ? 'fail' : 'tool',
      fromExpertId: member.ultraSwarm?.expertId ?? member.agentId,
      fromName: member.ultraSwarm?.name,
      fromEmoji: member.ultraSwarm?.emoji,
      body: input.body,
    });
    this.requestRender?.();
  }

  appendModelDelta(input: {
    readonly agentId: string;
    readonly delta: string;
  }): void {
    const member = findAgentSwarmMemberByAgentId(this.members, input.agentId);
    if (member === undefined || input.delta.length === 0) return;
    delete member.activeToolName;
    member.latestModelText = `${member.latestModelText}${input.delta}`.slice(
      -AGENT_SWARM_MAX_LATEST_MODEL_CHARS,
    );
    this.promoteToRunning(member, Date.now(), true);
  }

  markCompleted(agentId: string, completedText?: string): void {
    const member = findAgentSwarmMemberByAgentId(this.members, agentId);
    if (member === undefined || member.phase === 'failed' || member.phase === 'cancelled') return;
    const nowMs = Date.now();
    this.completeMember(member, nowMs, completedText);
    this.startAnimationIfNeeded();
  }

  markSuspended(input: {
    readonly agentId: string;
    readonly reason: string;
    readonly swarmIndex?: number;
    readonly description?: string | undefined;
  }): void {
    const member = findAgentSwarmMemberByAgentId(this.members, input.agentId) ??
      resolveAgentSwarmMemberForSubagent(
        () => this.members,
        input.agentId,
        input.swarmIndex,
        (count) => this.ensureMemberCount(count),
      );
    if (member === undefined || member.phase === 'completed' || member.phase === 'cancelled') return;
    member.agentId = input.agentId;
    this.progressEstimator.markQueued(member.id, Date.now());
    member.phase = 'suspended';
    clearAgentSwarmMemberState(member, ...TERMINAL_CLEAR_KEYS);
    this.startAnimationIfNeeded();
  }

  markFailed(
    agentId: string,
    failureText?: string,
    meta?: { readonly retryNote?: string | undefined },
  ): void {
    const member = findAgentSwarmMemberByAgentId(this.members, agentId);
    if (member === undefined) return;
    const nowMs = Date.now();
    this.failMember(member, nowMs, failureText, meta?.retryNote);
    this.startAnimationIfNeeded();
  }

  markSwarmFailed(failureText?: string): void {
    this.failed = true;
    this.aborted = false;
    const nowMs = Date.now();
    for (const member of this.members) {
      if (isTerminalPhase(member.phase)) continue;
      this.failMember(member, nowMs, failureText);
    }
    this.startAnimationIfNeeded();
  }

  markCancelled(agentId: string): void {
    const member = findAgentSwarmMemberByAgentId(this.members, agentId);
    if (member === undefined) return;
    this.cancelMember(member, Date.now());
  }

  markActiveCancelled(): void {
    this.aborted = true;
    const nowMs = Date.now();
    for (const member of this.members) {
      if (isTerminalPhase(member.phase)) continue;
      this.cancelMember(member, nowMs);
    }
    this.startAnimationIfNeeded();
  }

  applyResult(output: string): boolean {
    const statuses = parseAgentSwarmResultStatuses(output);
    if (statuses.length === 0) return false;
    this.aborted = false;
    const nowMs = Date.now();
    for (const entry of statuses) {
      this.ensureMemberCount(entry.index);
      const member = this.members[entry.index - 1];
      if (member === undefined) continue;
      if (entry.status === 'completed') {
        member.verdict = entry.verdict;
        member.evidenceIds = entry.evidenceIds;
        member.ultraSwarm = entry.ultraSwarm ?? member.ultraSwarm;
        this.completeMember(member, nowMs, entry.completedText);
      } else if (entry.status === 'failed') {
        member.verdict = entry.verdict;
        member.evidenceIds = entry.evidenceIds;
        member.ultraSwarm = entry.ultraSwarm ?? member.ultraSwarm;
        this.failMember(member, nowMs, entry.failureText);
      } else {
        member.verdict = entry.verdict;
        member.evidenceIds = entry.evidenceIds;
        member.ultraSwarm = entry.ultraSwarm ?? member.ultraSwarm;
        this.cancelMember(member, nowMs);
      }
    }
    const integrationReport = parseUltraSwarmIntegrationReport(output);
    if (integrationReport !== undefined) {
      this.integrationReport = integrationReport;
    }
    this.startAnimationIfNeeded();
    return true;
  }

  render(width: number): string[] {
    // Clock-driven animation: request a render frame from the shared loop
    // ticker instead of a private setInterval. See PREMIUM.md §7.1.
    this.tickClockDrivenAnimation();

    const outerWidth = Math.max(1, width);
    const innerWidth = Math.max(
      1,
      outerWidth - visibleWidth(AGENT_SWARM_LEFT_INDENT) - AGENT_SWARM_RIGHT_GAP,
    );
    const nowMs = Date.now();
    const snapshots = buildAgentSwarmSnapshots(this.members, nowMs);
    const summary = summarizeSnapshots(snapshots);
    const sortedMembers = sortAgentSwarmMembersForGrid(this.members);
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
    return {
      title: this.title,
      description: this.description,
      routingBadge: this.routingBadge,
      colors: this.colors,
      members: this.members,
      integrationReport: this.integrationReport,
      debateReel: this.debateReel,
      feedEvidenceIds: this.feedEvidenceIds,
      feedPathHints: this.feedPathHints,
      fileLeases: this.fileLeases,
      opsFeed: this.opsFeed,
      opsToolFeed: this.opsToolFeed,
      showRawFeed: this.showRawFeed,
      expertSlotById: this.expertSlotById,
      failed: this.failed,
      aborted: this.aborted,
      toolCallActive: this.toolCallActive,
      activitySpinnerText: this.activitySpinnerText,
      swarmStartedAtMs: this.swarmStartedAtMs,
      inputComplete: this.inputComplete,
      itemsStarted: this.itemsStarted,
      promptTemplateText: this.promptTemplateText,
      swarmPaused: this.swarmPaused,
      swarmPausedReason: this.swarmPausedReason,
      swarmPausedPhase: this.swarmPausedPhase,
      restaffing: this.restaffing,
      restaffingReason: this.restaffingReason,
      isUltraSwarm: this.isUltraSwarmOpsFeedEnabled(),
      availableGridHeight: this.availableGridHeight?.(),
      progressEstimator: this.progressEstimator,
    };
  }

  private collectWarRoomHintsFromText(text: string): void {
    const { evidenceIds, pathHints } = collectAgentSwarmWarRoomHints(text);
    for (const id of evidenceIds) this.feedEvidenceIds.add(id);
    for (const path of pathHints) this.feedPathHints.add(path);
  }

  private pushDebateReelTurn(turn: WarRoomDebateTurn): void {
    this.debateReel.push(turn);
    trimAgentSwarmDebateReel(this.debateReel);
  }

  private rebuildExpertSlotIndex(): void {
    this.expertSlotById.clear();
    for (const [expertId, slot] of rebuildAgentSwarmExpertSlotIndex(this.members)) {
      this.expertSlotById.set(expertId, slot);
    }
  }

  private isUltraSwarmOpsFeedEnabled(): boolean {
    return this.title === 'UltraSwarm';
  }

  private appendConversationFeed(input: {
    readonly tag: SwarmOpsFeedTag;
    readonly messageId?: string;
    readonly fromExpertId?: string;
    readonly fromName?: string;
    readonly fromEmoji?: string;
    readonly toExpertId?: string;
    readonly body: string;
    readonly rawBody?: string;
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    appendAgentSwarmConversationFeedEntry(
      this.opsFeed,
      this.seenCollaborationMessageIds,
      SWARM_OPS_FEED_MAX_ENTRIES,
      { ...input, atMs: Date.now() },
    );
  }

  private appendToolFeed(input: {
    readonly tag: 'tool' | 'fail';
    readonly fromExpertId?: string;
    readonly fromName?: string;
    readonly fromEmoji?: string;
    readonly body: string;
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    appendAgentSwarmToolFeedEntry(this.opsToolFeed, SWARM_OPS_FEED_MAX_ENTRIES, {
      ...input,
      atMs: Date.now(),
    });
  }

  private ensureMemberCount(count: number): void {
    if (count <= this.members.length) return;
    const previousLength = this.members.length;
    this.members = [
      ...this.members,
      ...createAgentSwarmMembers(count, this.inputComplete ? 'queued' : 'pending').slice(this.members.length),
    ];
    const nowMs = Date.now();
    for (let index = previousLength; index < this.members.length; index += 1) {
      const member = this.members[index];
      if (member !== undefined) this.progressEstimator.ensureMember(member.id, nowMs);
    }
  }

  private startAnimationIfNeeded(): void {
    // No-op: animation is now clock-driven via tickClockDrivenAnimation()
    // called from render(). Kept as a stub so the many call sites don't need
    // to change.
  }

  /**
   * Clock-driven animation tick.  Instead of a private setInterval, we
   * request a render frame from the shared loop ticker at most once per
   * FRAME_INTERVAL_MS.  When no members are animating, the tick is a no-op.
   */
  private tickClockDrivenAnimation(): void {
    if (this.requestRender === undefined) return;
    const now = Date.now();
    const hasAnimatedMembers = hasAnimatedAgentSwarmMembers(
      this.members,
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

  private promoteToRunning(member: AgentSwarmMember, nowMs?: number, setTicks = false): void {
    promoteAgentSwarmMemberToRunning(member, {
      nowMs,
      setTicks,
      onStarted: (memberId, startedAtMs) => this.progressEstimator.markStarted(memberId, startedAtMs),
      onSwarmStarted: (startedAtMs) => this.ensureSwarmStartedAt(startedAtMs),
    });
  }

  private ensureSwarmStartedAt(nowMs: number): void {
    if (this.swarmStartedAtMs === undefined) this.swarmStartedAtMs = nowMs;
  }

  private completeMember(member: AgentSwarmMember, nowMs: number, completedText?: string): void {
    applyAgentSwarmMemberCompleted(member, nowMs, completedText, () => {
      this.progressEstimator.markCompleted(member.id, nowMs);
    });
  }

  private failMember(
    member: AgentSwarmMember,
    nowMs: number,
    failureText?: string,
    retryNote?: string,
  ): void {
    applyAgentSwarmMemberFailed(member, nowMs, failureText, () => {
      this.progressEstimator.markFailed(member.id, nowMs);
    }, retryNote);
  }

  private cancelMember(member: AgentSwarmMember, nowMs: number): void {
    applyAgentSwarmMemberCancelled(member, this.colors, () => {
      this.progressEstimator.markCancelled(member.id, nowMs);
    });
  }
}

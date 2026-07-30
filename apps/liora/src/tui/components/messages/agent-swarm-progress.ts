import { visibleWidth, type Component } from '#/tui/renderer';
import chalk from 'chalk';

import {
  AgentSwarmProgressEstimator,
  type AgentSwarmProgressEstimatorPhase,
} from '#/tui/components/messages/agent-swarm-progress-estimator';
import type { TodoItem } from '#/tui/components/chrome/todo-panel';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import { renderRoundedPanel } from '#/tui/utils/panel-frame';
import { resolveWarRoomReason } from '#/tui/utils/war-room-action';
import {
  ABORTED_LABEL,
  CANCELLED_LABEL,
  COMPLETE_FILL_MS,
  cancelledLabelColor,
  collapseWhitespace,
  humanizeFeedBody,
  isAgentConversationChannel,
  isCodeWriteToolActivity,
  isTerminalPhase,
  normalizeFinalOutputText,
  runningCellLabelText,
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
  normalizeFailureText,
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
  renderAgentSwarmOpsFeedContent,
  renderAgentSwarmOpsFeedSection,
  renderAgentSwarmToolFeedSection,
  type SwarmFeedRenderContext,
} from '#/tui/utils/agent-swarm-feed-render';
import { renderAgentSwarmGrid } from '#/tui/utils/agent-swarm-grid-render';
import {
  renderAgentSwarmStatusLine,
  type SwarmStatusLineContext,
} from '#/tui/utils/agent-swarm-status-line-render';
import {
  collectAgentSwarmEvidenceWallIds,
  collectAgentSwarmWarRoomHints,
  indentAgentSwarmLines,
  isAgentSwarmWarRoomActive,
  renderAgentSwarmActionDockHint,
  renderAgentSwarmChildActivitySection,
  renderAgentSwarmDebateReelContent,
  renderAgentSwarmEvidenceWallContent,
  renderAgentSwarmFileMapContent,
  renderAgentSwarmHeaderLines,
  renderAgentSwarmIntegrationReportContent,
  renderAgentSwarmMemberTodoSection,
  renderAgentSwarmMissionContent,
  type WarRoomActionDockState,
  type WarRoomDebateTurn,
  type WarRoomFileLease,
} from '#/tui/utils/agent-swarm-header-render';

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

const FRAME_INTERVAL_MS = 80;
const MAX_LATEST_MODEL_CHARS = 2_000;
const AGENT_SWARM_LEFT_INDENT = ' ';
const AGENT_SWARM_RIGHT_GAP = 1;
const SWARM_OPS_FEED_MAX_ENTRIES = 48;
const SWARM_OPS_FEED_RENDER_LINES = 8;
const SWARM_OPS_FEED_RENDER_LINES_TINY = 4;
/** War room debate reel cap before eviction (rendered slice is smaller; see agent-swarm-header-render). */
const WAR_ROOM_DEBATE_REEL_MAX = 4;

type AgentSwarmPhase = AgentSwarmProgressEstimatorPhase;
export type TotalStatus = 'working' | 'completed' | 'suspended' | 'failed' | 'aborted';
type ClearableMemberKey =
  | 'completedAtMs'
  | 'completedText'
  | 'failedAtMs'
  | 'failureText'
  | 'cancelledLabelText'
  | 'cancelledLabelColor'
  | 'cancelledMarkColor'
  | 'cancelledBarColor'
  | 'suspendedReason'
  | 'activeToolName'
  | 'codeWriteAtMs'
  | 'retryNote';

const COMPLETED_CLEAR_KEYS = [
  'failedAtMs',
  'failureText',
  'cancelledLabelText',
  'cancelledLabelColor',
  'cancelledMarkColor',
  'cancelledBarColor',
  'suspendedReason',
  'activeToolName',
  'codeWriteAtMs',
  'retryNote',
] as const satisfies readonly ClearableMemberKey[];
const FAILED_CLEAR_KEYS = [
  'completedAtMs',
  'completedText',
  'cancelledLabelText',
  'cancelledLabelColor',
  'cancelledMarkColor',
  'cancelledBarColor',
  'suspendedReason',
  'activeToolName',
  'codeWriteAtMs',
] as const satisfies readonly ClearableMemberKey[];
const TERMINAL_CLEAR_KEYS = [
  'completedAtMs',
  'completedText',
  'failedAtMs',
  'failureText',
  'cancelledLabelText',
  'cancelledLabelColor',
  'cancelledMarkColor',
  'cancelledBarColor',
  'suspendedReason',
  'activeToolName',
  'codeWriteAtMs',
  'retryNote',
] as const satisfies readonly ClearableMemberKey[];
const CANCELLED_CLEAR_KEYS = [
  'completedAtMs',
  'completedText',
  'failedAtMs',
  'failureText',
  'suspendedReason',
  'activeToolName',
  'codeWriteAtMs',
  'retryNote',
] as const satisfies readonly ClearableMemberKey[];

export interface UltraSwarmMemberMetadata {
  readonly expertId: string;
  readonly name: string;
  readonly division?: string;
  readonly emoji?: string;
  readonly coverageLane?: string;
  readonly selectionReason?: string;
  readonly focus?: string;
  readonly dependsOn?: readonly string[];
  readonly taskIds?: readonly string[];
}

export type SwarmOpsFeedTag =
  | 'staff'
  | 'join'
  | 'live'
  | 'tool'
  | 'pulse'
  | 'done'
  | 'fail'
  | 'wait'
  | 'stop'
  | 'msg'
  | 'mention'
  | 'block'
  | 'standup'
  | 'council';

export interface SwarmCollaborationFeedMessage {
  readonly id?: string;
  readonly from: { readonly expertId?: string; readonly name: string; readonly emoji?: string };
  readonly to?: { readonly expertId: string };
  readonly channel: 'standup' | 'lane' | 'direct' | 'blocker' | 'council';
  readonly body: string;
}

export interface SwarmOpsFeedEntry {
  readonly atMs: number;
  readonly tag: SwarmOpsFeedTag;
  readonly messageId?: string;
  readonly fromExpertId?: string;
  readonly fromName?: string;
  readonly fromEmoji?: string;
  readonly toExpertId?: string;
  /** Humanized (or plain) body shown by default. */
  readonly body: string;
  /** Original protocol/raw body when humanization rewrote the message. */
  readonly rawBody?: string;
}

/** Host-facing action dock request kinds. */
export type AgentSwarmActionDockRequest = 'pause' | 'restaff' | 'raw';

export interface AgentSwarmRestaffRequest {
  readonly reason?: string;
  readonly phase?: string;
}

export interface AgentSwarmPauseRequest {
  readonly reason?: string;
  readonly phase?: string;
}

export type WarRoomDebatePhase = 'critic' | 'rebuttal' | 'counter-critique' | 'consensus' | 'steer';

export interface AgentSwarmMember {
  readonly id: string;
  agentId?: string;
  phase: AgentSwarmPhase;
  ticks: number;
  itemText: string;
  latestModelText: string;
  modelAlias?: string;
  activeToolName?: string;
  ultraSwarm?: UltraSwarmMemberMetadata;
  verdict?: string;
  evidenceIds?: readonly string[];
  completedText?: string;
  failureText?: string;
  cancelledLabelText?: string;
  cancelledLabelColor?: string;
  cancelledMarkColor?: string;
  cancelledBarColor?: string;
  suspendedReason?: string;
  completedAtMs?: number;
  failedAtMs?: number;
  /** First moment the member entered running; drives the per-cell elapsed badge. */
  startedAtMs?: number;
  /** Last moment a Write/Edit tool started in this lane; drives the ✎ code-write pulse. */
  codeWriteAtMs?: number;
  /** Optional dim note after failure text (retry attempt / model fallback). */
  retryNote?: string;
  todos: TodoItem[];
}

export interface AgentSwarmSnapshot {
  readonly phase: AgentSwarmPhase;
  readonly ticks: number;
  readonly latestModelText: string;
  readonly phaseElapsedMs: number;
}

export interface AgentSwarmSummary {
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface AgentSwarmProgressOptions {
  readonly description: string;
  readonly title?: string | undefined;
  readonly requestRender?: () => void;
  readonly availableGridHeight?: () => number | undefined;
  /**
   * Host callback when the war-room action dock requests a pause.
   * Wire to session `pauseUltrawork` / `swarmSteer` as available.
   */
  readonly onRequestPause?: (request: AgentSwarmPauseRequest) => void;
  /**
   * Host callback when the war-room action dock requests restaff.
   * Parent may emit collaboration/steer or invoke UltraSwarm restaff path.
   */
  readonly onRequestRestaff?: (request: AgentSwarmRestaffRequest) => void;
}

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
    this.updateItemTexts(fullRows, partialRows);
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
    const body = input.reason === undefined || input.reason.trim().length === 0
      ? `council ${input.decision}`
      : `council ${input.decision} · ${input.reason}`;
    this.appendConversationFeed({
      tag: 'council',
      fromExpertId: 'council',
      fromName: 'Council',
      fromEmoji: '⚑',
      body,
    });
    this.requestRender?.();
  }

  applySwarmPaused(input: { readonly reason: string; readonly phase?: string }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    this.swarmPaused = true;
    this.swarmPausedReason = collapseWhitespace(input.reason);
    this.swarmPausedPhase = input.phase === undefined ? undefined : collapseWhitespace(input.phase);
    const phase = this.swarmPausedPhase === undefined || this.swarmPausedPhase.length === 0
      ? ''
      : ` @ ${this.swarmPausedPhase}`;
    const reason =
      this.swarmPausedReason === undefined || this.swarmPausedReason.length === 0
        ? 'steering'
        : this.swarmPausedReason;
    this.appendConversationFeed({
      tag: 'stop',
      fromExpertId: 'orchestrator',
      fromName: 'Orchestrator',
      fromEmoji: '⏸',
      body: `paused for steering${phase} · ${reason}`,
    });
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
      const reason =
        this.restaffingReason === undefined || this.restaffingReason.length === 0
          ? 'closing gaps'
          : this.restaffingReason;
      this.appendConversationFeed({
        tag: 'staff',
        fromExpertId: 'orchestrator',
        fromName: 'Orchestrator',
        fromEmoji: '↻',
        body: `restaffing · ${reason}`,
      });
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
    const member = this.findMemberForSubagent(input.agentId, input.swarmIndex);
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
    const member = this.findMemberByAgentId(agentId);
    if (member === undefined) return;
    const nowMs = Date.now();
    this.progressEstimator.markStarted(member.id, nowMs);
    member.startedAtMs ??= nowMs;
    member.ticks = Math.max(member.ticks, 1);
    this.promoteToRunning(member, nowMs);
    this.startAnimationIfNeeded();
  }

  applyMemberTodos(agentId: string, todos: readonly TodoItem[]): void {
    const member = this.findMemberByAgentId(agentId);
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
    const member = this.findMemberByAgentId(input.agentId);
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
    const member = this.findMemberByAgentId(input.agentId);
    if (member === undefined) return;
    delete member.activeToolName;
    member.ticks += 1;
    if (input.summary !== undefined && input.summary.length > 0) {
      const prefix = input.isError === true ? '⚠ ' : '';
      const line = `${prefix}${input.summary}`.slice(0, MAX_LATEST_MODEL_CHARS);
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
    const member = this.findMemberByAgentId(input.agentId);
    if (member === undefined) return;
    this.trackMemberCodeWriteActivity(member, input);
    this.appendToolFeed({
      tag: input.isError === true ? 'fail' : 'tool',
      fromExpertId: member.ultraSwarm?.expertId ?? member.agentId,
      fromName: member.ultraSwarm?.name,
      fromEmoji: member.ultraSwarm?.emoji,
      body: input.body,
    });
    this.requestRender?.();
  }

  /**
   * Phase 5-A parallel write visibility: timestamp the member's latest
   * code-writing tool so the grid cell can pulse ✎ while writes are in
   * flight. Non-write tools and error results clear the mark immediately;
   * the renderer expires it after CODE_WRITE_QUIET_MS of quiet.
   */
  private trackMemberCodeWriteActivity(
    member: AgentSwarmMember,
    input: {
      readonly body: string;
      readonly isError?: boolean;
      readonly toolName?: string;
    },
  ): void {
    if (input.isError !== true && isCodeWriteToolActivity(input.toolName, input.body)) {
      member.codeWriteAtMs = Date.now();
    } else {
      delete member.codeWriteAtMs;
    }
  }

  appendModelDelta(input: {
    readonly agentId: string;
    readonly delta: string;
  }): void {
    const member = this.findMemberByAgentId(input.agentId);
    if (member === undefined || input.delta.length === 0) return;
    delete member.activeToolName;
    member.latestModelText = `${member.latestModelText}${input.delta}`.slice(
      -MAX_LATEST_MODEL_CHARS,
    );
    this.promoteToRunning(member, Date.now(), true);
  }

  markCompleted(agentId: string, completedText?: string): void {
    const member = this.findMemberByAgentId(agentId);
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
    const member = this.findMemberByAgentId(input.agentId) ??
      this.findMemberForSubagent(input.agentId, input.swarmIndex);
    if (member === undefined || member.phase === 'completed' || member.phase === 'cancelled') return;
    member.agentId = input.agentId;
    this.progressEstimator.markQueued(member.id, Date.now());
    member.phase = 'suspended';
    clearMemberState(member, ...TERMINAL_CLEAR_KEYS);
    this.startAnimationIfNeeded();
  }

  markFailed(
    agentId: string,
    failureText?: string,
    meta?: { readonly retryNote?: string | undefined },
  ): void {
    const member = this.findMemberByAgentId(agentId);
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
    const member = this.findMemberByAgentId(agentId);
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
    const snapshots = this.members.map((member): AgentSwarmSnapshot => ({
      phase: member.phase,
      ticks: member.ticks,
      latestModelText: member.latestModelText,
      phaseElapsedMs: terminalPhaseElapsedMs(member, nowMs),
    }));
    const summary = summarizeSnapshots(snapshots);
    // Sort grid: running first, then completed, then pending
    const sortedMembers = [...this.members].sort((a, b) => {
      const order = (p: AgentSwarmPhase): number => {
        if (p === 'running') return 0;
        if (p === 'completed') return 1;
        return 2;
      };
      return order(a.phase) - order(b.phase);
    });
    const sortedSnapshots = sortedMembers.map((member): AgentSwarmSnapshot => ({
      phase: member.phase,
      ticks: member.ticks,
      latestModelText: member.latestModelText,
      phaseElapsedMs: terminalPhaseElapsedMs(member, nowMs),
    }));
    const lines = this.members.length === 0
      ? this.renderEmptyLayout(innerWidth, summary)
      : this.isUltraSwarmOpsFeedEnabled()
        ? this.renderUltraSwarmLayout(innerWidth, summary, sortedMembers, sortedSnapshots, nowMs)
        : [
            '',
            ...this.renderIntegratedDashboard(innerWidth, summary),
            '',
            ...this.renderGrid(
              innerWidth,
              this.availableGridHeight?.(),
              sortedMembers,
              sortedSnapshots,
              nowMs,
            ),
            ...this.renderChildActivitySection(innerWidth),
            ...this.renderMemberTodoSection(innerWidth),
            ...this.renderOpsFeed(innerWidth),
            '',
            '',
          ];
    this.startAnimationIfNeeded();
    return this.indentLines(lines, outerWidth);
  }

  private renderEmptyLayout(width: number, summary: AgentSwarmSummary): string[] {
    if (this.isUltraSwarmOpsFeedEnabled()) {
      return this.renderUltraSwarmLayout(width, summary, [], [], Date.now());
    }
    return [
      '',
      ...this.renderHeaderLines(width, undefined),
      '',
      this.renderStatusLine(width),
      '',
    ];
  }

  private renderUltraSwarmLayout(
    width: number,
    summary: AgentSwarmSummary,
    members: readonly AgentSwarmMember[],
    snapshots: readonly AgentSwarmSnapshot[],
    nowMs: number,
  ): string[] {
    const profile = resolveResponsiveLayout({ width });
    const missionContent = this.renderMissionContent(width, summary);
    const teamContent = this.renderGrid(width, this.availableGridHeight?.(), members, snapshots, nowMs);
    const feedLimit = profile === 'tiny' ? SWARM_OPS_FEED_RENDER_LINES_TINY : SWARM_OPS_FEED_RENDER_LINES;
    const feedContent = this.renderOpsFeedContent(width, feedLimit);
    const reportContent = this.renderIntegrationReportContent(width);
    const debateContent = this.renderDebateReelContent(width, profile);
    const evidenceContent = this.renderEvidenceWallContent(width);
    const fileMapContent = this.renderFileMapContent(width);
    const actionDock = this.renderActionDockHint(width);
    const statusFooter = ['', this.renderStatusLine(width), ''];

    const teamBody = teamContent.length > 0
      ? teamContent
      : [chalk.hex(this.colors.textDim)('awaiting agents…')];
    const activityContent = this.renderChildActivitySection(width);
    const feedHeader = chalk.hex(this.colors.textDim)('war room · team feed');
    const panelContent = [
      ...missionContent,
      '',
      ...teamBody,
      ...(activityContent.length > 0 ? ['', ...activityContent] : []),
      ...(reportContent.length > 0 ? ['', ...reportContent] : []),
      ...(debateContent.length > 0 ? ['', ...debateContent] : []),
      ...(evidenceContent.length > 0 ? ['', ...evidenceContent] : []),
      ...(fileMapContent.length > 0 ? ['', ...fileMapContent] : []),
      '',
      feedHeader,
      ...feedContent,
      ...this.renderToolFeed(width),
      ...(actionDock.length > 0 ? ['', ...actionDock] : []),
    ];

    if (profile === 'tiny') {
      return ['', ...panelContent, ...statusFooter];
    }

    return [
      '',
      ...renderRoundedPanel({
        title: ' UltraSwarm ',
        content: panelContent,
        width,
        borderToken: 'primary',
        minBoxWidth: 60,
      }),
      ...statusFooter,
    ];
  }

  private renderMissionContent(width: number, summary: AgentSwarmSummary | undefined): string[] {
    return renderAgentSwarmMissionContent(width, {
      title: this.title,
      description: this.description,
      routingBadge: this.routingBadge,
      summary,
      members: this.members,
      colors: this.colors,
    });
  }

  private renderIntegrationReportContent(width: number): string[] {
    return renderAgentSwarmIntegrationReportContent(width, this.integrationReport, this.colors);
  }

  private renderDebateReelContent(
    width: number,
    profile: ReturnType<typeof resolveResponsiveLayout>,
  ): string[] {
    return renderAgentSwarmDebateReelContent(width, profile, this.debateReel, this.colors);
  }

  private renderEvidenceWallContent(width: number): string[] {
    const ids = collectAgentSwarmEvidenceWallIds(this.members, this.feedEvidenceIds, this.feedPathHints);
    return renderAgentSwarmEvidenceWallContent(width, ids, this.colors);
  }

  private renderFileMapContent(width: number): string[] {
    if (!this.isUltraSwarmOpsFeedEnabled()) return [];
    return renderAgentSwarmFileMapContent(width, this.fileLeases, this.colors, this.isWarRoomActive());
  }

  private renderActionDockHint(width: number): string[] {
    if (!this.isUltraSwarmOpsFeedEnabled()) return [];
    return renderAgentSwarmActionDockHint(width, this.actionDockState(), this.colors);
  }

  private actionDockState(): WarRoomActionDockState {
    return {
      swarmPaused: this.swarmPaused,
      swarmPausedReason: this.swarmPausedReason,
      swarmPausedPhase: this.swarmPausedPhase,
      restaffing: this.restaffing,
      restaffingReason: this.restaffingReason,
      showRawFeed: this.showRawFeed,
    };
  }

  private isWarRoomActive(): boolean {
    return isAgentSwarmWarRoomActive({
      members: this.members,
      opsFeedLength: this.opsFeed.length,
      opsToolFeedLength: this.opsToolFeed.length,
      debateReelLength: this.debateReel.length,
      fileLeaseCount: this.fileLeases.size,
      itemsStarted: this.itemsStarted,
    });
  }

  private collectWarRoomHintsFromText(text: string): void {
    const { evidenceIds, pathHints } = collectAgentSwarmWarRoomHints(text);
    for (const id of evidenceIds) this.feedEvidenceIds.add(id);
    for (const path of pathHints) this.feedPathHints.add(path);
  }

  private pushDebateReelTurn(turn: WarRoomDebateTurn): void {
    this.debateReel.push(turn);
    const maxStored = WAR_ROOM_DEBATE_REEL_MAX * 4;
    if (this.debateReel.length > maxStored) {
      this.debateReel.splice(0, this.debateReel.length - maxStored);
    }
  }

  private indentLines(lines: readonly string[], width: number): string[] {
    return indentAgentSwarmLines(lines, width, AGENT_SWARM_LEFT_INDENT, AGENT_SWARM_RIGHT_GAP);
  }

  private renderHeaderLines(width: number, _summary: AgentSwarmSummary | undefined): string[] {
    return renderAgentSwarmHeaderLines(width, this.title, this.description, this.colors);
  }

  private renderIntegratedDashboard(
    width: number,
    summary: AgentSwarmSummary | undefined,
  ): string[] {
    const headerLines = this.renderHeaderLines(width, summary);
    const statusLine = this.renderStatusLine(width);
    return [...headerLines, '', statusLine];
  }

  private renderMemberTodoSection(width: number): string[] {
    return renderAgentSwarmMemberTodoSection(width, this.members, this.colors);
  }

  private feedRenderContext(): SwarmFeedRenderContext {
    return {
      colors: this.colors,
      showRawFeed: this.showRawFeed,
      expertSlotById: this.expertSlotById,
      members: this.members,
    };
  }

  private renderOpsFeed(width: number): string[] {
    if (!this.isUltraSwarmOpsFeedEnabled()) return [];
    return renderAgentSwarmOpsFeedSection(width, this.opsFeed, this.feedRenderContext());
  }

  private renderToolFeed(width: number): string[] {
    if (!this.isUltraSwarmOpsFeedEnabled()) return [];
    return renderAgentSwarmToolFeedSection(width, this.opsToolFeed, this.feedRenderContext());
  }

  private renderOpsFeedContent(
    width: number,
    maxLines: number,
    indent = false,
  ): string[] {
    return renderAgentSwarmOpsFeedContent(
      this.opsFeed,
      width,
      maxLines,
      indent,
      resolveResponsiveLayout({ width }),
      this.feedRenderContext(),
    );
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

  private renderStatusLine(width: number): string {
    const context: SwarmStatusLineContext = {
      members: this.members,
      failed: this.failed,
      aborted: this.aborted,
      toolCallActive: this.toolCallActive,
      activitySpinnerText: this.activitySpinnerText,
      swarmStartedAtMs: this.swarmStartedAtMs,
      inputComplete: this.inputComplete,
      itemsStarted: this.itemsStarted,
      promptTemplateText: this.promptTemplateText,
      colors: this.colors,
    };
    return renderAgentSwarmStatusLine(width, context);
  }

  private renderGrid(
    width: number,
    height: number | undefined,
    members: readonly AgentSwarmMember[],
    snapshots: readonly AgentSwarmSnapshot[],
    nowMs: number,
  ): string[] {
    return renderAgentSwarmGrid({
      width,
      height,
      members,
      snapshots,
      nowMs,
      colors: this.colors,
      estimate: (input) => this.progressEstimator.estimate(input),
    });
  }

  private renderChildActivitySection(width: number): string[] {
    return renderAgentSwarmChildActivitySection(width, this.members, this.colors);
  }

  private findMemberForSubagent(
    agentId: string,
    swarmIndex: number | undefined,
  ): AgentSwarmMember | undefined {
    const existing = this.findMemberByAgentId(agentId);
    if (existing !== undefined) return existing;

    if (swarmIndex !== undefined && Number.isInteger(swarmIndex) && swarmIndex > 0) {
      this.ensureMemberCount(swarmIndex);
      const byIndex = this.members[swarmIndex - 1];
      if (byIndex !== undefined) return byIndex;
    }

    const unassigned = this.members.find((member) => member.agentId === undefined);
    if (unassigned !== undefined) return unassigned;

    this.ensureMemberCount(this.members.length + 1);
    return this.members.at(-1);
  }

  private findMemberByAgentId(agentId: string): AgentSwarmMember | undefined {
    return this.members.find((member) => member.agentId === agentId);
  }

  private ensureMemberCount(count: number): void {
    if (count <= this.members.length) return;
    const previousLength = this.members.length;
    this.members = [
      ...this.members,
      ...createMembers(count, this.inputComplete ? 'queued' : 'pending').slice(this.members.length),
    ];
    const nowMs = Date.now();
    for (let index = previousLength; index < this.members.length; index += 1) {
      const member = this.members[index];
      if (member !== undefined) this.progressEstimator.ensureMember(member.id, nowMs);
    }
  }

  private updateItemTexts(fullItems: readonly string[], partialItems: readonly string[]): void {
    const count = Math.max(fullItems.length, partialItems.length, this.members.length);
    for (let index = 0; index < count; index += 1) {
      const member = this.members[index];
      if (member === undefined) continue;
      const itemText = fullItems[index] ?? partialItems[index];
      if (itemText !== undefined) member.itemText = itemText;
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
    if (!this.hasAnimatedMembers()) {
      this.lastFrameTickMs = 0;
      return;
    }
    const now = Date.now();
    if (this.lastFrameTickMs !== 0 && now - this.lastFrameTickMs < FRAME_INTERVAL_MS) return;
    this.lastFrameTickMs = now;
    this.requestRender();
  }

  private hasAnimatedMembers(): boolean {
    const now = Date.now();
    return (
      this.progressEstimator.hasPendingCatchup() ||
      this.members.some((member) =>
        (
          member.phase === 'completed' &&
          member.completedAtMs !== undefined &&
          now - member.completedAtMs < COMPLETE_FILL_MS
        ) ||
        (
          member.phase === 'failed' &&
          member.failedAtMs !== undefined &&
          now - member.failedAtMs < COMPLETE_FILL_MS
        ),
      )
    );
  }

  private promoteToRunning(member: AgentSwarmMember, nowMs?: number, setTicks = false): void {
    if (member.phase === 'pending' || member.phase === 'queued' || member.phase === 'suspended') {
      member.phase = 'running';
      member.startedAtMs ??= nowMs ?? Date.now();
      if (nowMs !== undefined) {
        this.ensureSwarmStartedAt(nowMs);
        this.progressEstimator.markStarted(member.id, nowMs);
      }
      if (setTicks) member.ticks = Math.max(member.ticks, 1);
    }
    delete member.suspendedReason;
  }

  private ensureSwarmStartedAt(nowMs: number): void {
    if (this.swarmStartedAtMs === undefined) this.swarmStartedAtMs = nowMs;
  }

  private completeMember(member: AgentSwarmMember, nowMs: number, completedText?: string): void {
    if (member.phase !== 'completed') {
      this.progressEstimator.markCompleted(member.id, nowMs);
      member.completedAtMs = nowMs;
    }
    const normalizedCompletedText = normalizeFinalOutputText(completedText);
    if (normalizedCompletedText !== undefined) member.completedText = normalizedCompletedText;
    member.phase = 'completed';
    clearMemberState(member, ...COMPLETED_CLEAR_KEYS);
  }

  private failMember(
    member: AgentSwarmMember,
    nowMs: number,
    failureText?: string,
    retryNote?: string,
  ): void {
    if (member.phase !== 'failed') {
      this.progressEstimator.markFailed(member.id, nowMs);
      member.failedAtMs = nowMs;
    }
    const normalizedFailureText = normalizeFailureText(failureText);
    if (normalizedFailureText !== undefined) member.failureText = normalizedFailureText;
    const normalizedRetryNote = normalizeFailureText(retryNote);
    if (normalizedRetryNote !== undefined) member.retryNote = normalizedRetryNote;
    member.phase = 'failed';
    clearMemberState(member, ...FAILED_CLEAR_KEYS);
  }

  private cancelMember(member: AgentSwarmMember, nowMs: number): void {
    const previousPhase = member.phase;
    this.progressEstimator.markCancelled(member.id, nowMs);
    member.phase = 'cancelled';
    clearMemberState(member, ...CANCELLED_CLEAR_KEYS);
    if (previousPhase === 'pending' || previousPhase === 'queued' || previousPhase === 'suspended') {
      member.cancelledLabelText = CANCELLED_LABEL;
      member.cancelledLabelColor = cancelledLabelColor(this.colors);
      member.cancelledMarkColor = this.colors.warning;
      member.cancelledBarColor = this.colors.warning;
    } else if (previousPhase === 'running') {
      member.cancelledLabelText = runningCellLabelText(member);
      member.cancelledLabelColor = cancelledLabelColor(this.colors);
      member.cancelledMarkColor = this.colors.warning;
      member.cancelledBarColor = this.colors.warning;
    } else {
      member.cancelledLabelText = ABORTED_LABEL;
      member.cancelledLabelColor = this.colors.warning;
      member.cancelledMarkColor = this.colors.warning;
      member.cancelledBarColor = this.colors.warning;
    }
  }
}

function createMembers(count: number, phase: AgentSwarmPhase): AgentSwarmMember[] {
  return Array.from({ length: count }, (_item, index) => ({
    id: String(index + 1).padStart(3, '0'),
    phase,
    ticks: 0,
    itemText: '',
    latestModelText: '',
    todos: [],
  }));
}

function clearMemberState(member: AgentSwarmMember, ...keys: ClearableMemberKey[]): void {
  for (const key of keys) delete member[key];
}

function terminalPhaseElapsedMs(member: AgentSwarmMember, nowMs: number): number {
  const startedAtMs = member.phase === 'completed'
    ? member.completedAtMs
    : member.phase === 'failed'
      ? member.failedAtMs
      : undefined;
  return startedAtMs === undefined ? 0 : Math.max(0, nowMs - startedAtMs);
}

export function isSwarmProgressToolName(toolName: string): boolean {
  return toolName === 'AgentSwarm' || toolName === 'UltraSwarm';
}

export function swarmProgressTitleForToolName(toolName: string): string {
  return toolName === 'UltraSwarm' ? 'UltraSwarm' : 'Agent Swarm';
}

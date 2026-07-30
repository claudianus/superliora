import {
  RENDERER_BRAILLE_PROGRESS_LEVELS,
  renderRendererDividerRow,
  renderRendererLabeledDividerRow,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '#/tui/renderer';
import chalk from 'chalk';

import {
  AgentSwarmProgressEstimator,
  type AgentSwarmProgressEstimatorPhase,
} from '#/tui/components/messages/agent-swarm-progress-estimator';
import {
  formatSwarmMemberTodoLines,
  type TodoItem,
} from '#/tui/components/chrome/todo-panel';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import { renderAnimatedGradientText } from '#/tui/utils/appearance-effects';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';
import { renderRoundedPanel } from '#/tui/utils/panel-frame';
import { resolveWarRoomReason } from '#/tui/utils/war-room-action';
import {
  ABORTED_LABEL,
  ACTIVITY_SPINNER_PLACEHOLDER,
  CANCELLED_LABEL,
  COMPLETE_FILL_MS,
  ORCHESTRATING_LABEL,
  PROMPTING_LABEL,
  activityPrefixForTotalStatus,
  brailleBar,
  cancelledLabelColor,
  cancelledProgressColor,
  collapseWhitespace,
  compactTerminalMark,
  feedThreadKey,
  formatDebatePhaseLabel,
  humanizeFeedBody,
  isAgentConversationChannel,
  isCodeWriteToolActivity,
  isConversationFeedTag,
  isTerminalPhase,
  isTerminalTotalStatus,
  latestNonEmptyLine,
  normalizeFinalOutputText,
  padAnsi,
  renderCancelledUnstartedCell,
  renderCellLabel,
  renderPendingCell,
  renderQueuedCell,
  renderStatusLabel,
  renderStatusPipBar,
  runningCellLabelText,
  shortExpertId,
  shortExpertName,
  stripAnsiText,
  summarizeSnapshots,
  swarmCollaborationFeedTag,
  swarmMemberDisplayName,
  totalStatus,
  totalStatusLabel,
  totalStatusLabelToken,
  truncateStartToWidth,
  truncateWithColor,
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
import {
  calculateAgentSwarmGridLayout,
  type AgentSwarmGridLayout,
} from '#/tui/utils/agent-swarm-grid-layout';

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
const TOTAL_STATUS_BAR_GAP = 2;
const PROMPTING_TEXT_TRAILING_GAP = 1;
const AGENT_SWARM_LEFT_INDENT = ' ';
const AGENT_SWARM_RIGHT_GAP = 1;
const SWARM_OPS_FEED_MAX_ENTRIES = 48;
const SWARM_OPS_FEED_RENDER_LINES = 8;
const SWARM_OPS_FEED_RENDER_LINES_TINY = 4;
/** Max per-child activity lines shown under the swarm grid before collapsing. */
const MAX_CHILD_ACTIVITY_LINES = 6;
const SWARM_FEED_BODY_MIN_WIDTH = 24;
const SWARM_FEED_BODY_WIDTH_RATIO = 0.65;
const SWARM_FEED_NARROW_WIDTH = 72;
/** War room debate reel: last N turns (tiny terminals show fewer). */
const WAR_ROOM_DEBATE_REEL_MAX = 4;
const WAR_ROOM_DEBATE_REEL_MAX_TINY = 2;
/** War room evidence wall chips. */
const WAR_ROOM_EVIDENCE_WALL_MAX = 6;
/** War room file map lease rows. */
const WAR_ROOM_FILE_MAP_MAX = 6;
/** Soft path-like tokens scraped from humanized feed bodies for evidence wall. */
const WAR_ROOM_PATH_TOKEN =
  /(?:^|[\s`"'(])((?:\.?\.?\/)?[\w.-]+(?:\/[\w.-]+)+\.[A-Za-z][\w.-]{0,12}|[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|py|go|rs|toml|css|scss|html|vue|svelte))(?=$|[\s`"'),:;])/g;
/** Evidence id tokens (ev_… / evidence-…) found in feed text. */
const WAR_ROOM_EVIDENCE_ID_TOKEN = /\b(?:ev[_-][\w.-]+|evidence[_-][\w.-]+)\b/gi;

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

interface WarRoomDebateTurn {
  readonly atMs: number;
  readonly phase: WarRoomDebatePhase;
  readonly expertName?: string;
  readonly headline: string;
  readonly debateId?: string;
}

interface WarRoomFileLease {
  readonly path: string;
  readonly owner: string;
  readonly atMs: number;
}

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
    const title = renderAnimatedGradientText(this.title, `agent-swarm:title:${this.title}`);
    const description = this.description.length > 0
      ? chalk.hex(this.colors.text)(this.description)
      : '';
    const stats = summary === undefined ? '' : this.renderMissionStats(summary);
    const headlineParts = [title];
    if (this.routingBadge !== undefined) {
      headlineParts.push(`${chalk.hex(this.colors.textDim)('·')} ${chalk.hex(this.colors.primary)(this.routingBadge)}`);
    }
    if (description.length > 0) headlineParts.push(`${chalk.hex(this.colors.textDim)('·')} ${description}`);
    if (stats.length > 0) headlineParts.push(`${chalk.hex(this.colors.textDim)('·')} ${stats}`);
    return [truncateToWidth(headlineParts.join(' '), width)];
  }

  private renderMissionStats(summary: AgentSwarmSummary): string {
    const total = summary.active + summary.completed + summary.failed + summary.cancelled;
    const running = this.members.filter((member) => member.phase === 'running').length;
    const evidenceCount = this.members.reduce(
      (count, member) => count + (member.evidenceIds?.length ?? 0),
      0,
    );
    const segments = [
      total > 0 ? `${String(total)} experts` : undefined,
      running > 0 ? `${String(running)} working` : undefined,
      summary.completed > 0 ? `${String(summary.completed)}/${String(total)} done` : undefined,
      summary.failed > 0 ? `${String(summary.failed)} failed` : undefined,
      evidenceCount > 0 ? `${String(evidenceCount)} evidence` : undefined,
    ].filter((segment): segment is string => segment !== undefined);
    return segments.length > 0 ? segments.join(' · ') : `${String(total)} agents`;
  }

  private renderIntegrationReportContent(width: number): string[] {
    const report = this.integrationReport;
    if (report === undefined) return [];

    const lines: string[] = [chalk.hex(this.colors.textDim)('integration report')];
    if (report.headline.length > 0) {
      lines.push(chalk.hex(this.colors.textDim)(truncateToWidth(report.headline, width)));
    }

    for (const agent of report.agents) {
      const emojiPrefix = agent.emoji === undefined || agent.emoji.length === 0 ? '' : `${agent.emoji} `;
      const header = `${emojiPrefix}${agent.name} · ${agent.phase} · ${agent.verdict}`;
      lines.push(chalk.hex(this.colors.text)(truncateToWidth(header, width)));
      const detail = agent.summary ?? agent.findings ?? agent.risksAndGaps;
      if (detail !== undefined && detail.length > 0) {
        lines.push(chalk.hex(this.colors.textDim)(truncateToWidth(`  ${detail}`, width)));
      }
    }

    if (report.openGaps !== undefined && report.openGaps.length > 0) {
      lines.push(chalk.hex(this.colors.textDim)(truncateToWidth('open gaps', width)));
      for (const gapLine of report.openGaps.split('\n')) {
        const trimmed = gapLine.trim();
        if (trimmed.length === 0) continue;
        lines.push(chalk.hex(this.colors.textDim)(truncateToWidth(`  ${trimmed}`, width)));
      }
    }

    return lines;
  }

  private renderDebateReelContent(
    width: number,
    profile: ReturnType<typeof resolveResponsiveLayout>,
  ): string[] {
    if (this.debateReel.length === 0) return [];
    const limit = profile === 'tiny' ? WAR_ROOM_DEBATE_REEL_MAX_TINY : WAR_ROOM_DEBATE_REEL_MAX;
    const turns = this.debateReel.slice(-limit);
    const lines: string[] = [chalk.hex(this.colors.textDim)('debate reel')];
    for (const turn of turns) {
      const phaseLabel = formatDebatePhaseLabel(turn.phase);
      const line = `debate · ${phaseLabel}: ${turn.headline}`;
      lines.push(chalk.hex(this.colors.text)(truncateToWidth(line, width)));
    }
    return lines;
  }

  private renderEvidenceWallContent(width: number): string[] {
    const ids = this.collectEvidenceWallIds();
    if (ids.length === 0) return [];
    const lines: string[] = [chalk.hex(this.colors.textDim)('evidence wall')];
    for (const id of ids) {
      lines.push(chalk.hex(this.colors.text)(truncateToWidth(`evidence · ${id}`, width)));
    }
    return lines;
  }

  private renderFileMapContent(width: number): string[] {
    if (!this.isUltraSwarmOpsFeedEnabled()) return [];
    const leases = Array.from(this.fileLeases.values())
      .sort((a, b) => a.atMs - b.atMs)
      .slice(-WAR_ROOM_FILE_MAP_MAX);
    if (leases.length === 0) {
      // Empty state only when swarm is active (team staffed or feed/ops live).
      if (!this.isWarRoomActive()) return [];
      return [
        chalk.hex(this.colors.textDim)(
          truncateToWidth('file map · no leases yet', width),
        ),
      ];
    }
    const lines: string[] = [chalk.hex(this.colors.textDim)('file map')];
    for (const lease of leases) {
      const owner = shortExpertName(lease.owner);
      const line = `file · ${lease.path} @ ${owner}`;
      lines.push(chalk.hex(this.colors.text)(truncateToWidth(line, width)));
    }
    return lines;
  }

  private renderActionDockHint(width: number): string[] {
    if (!this.isUltraSwarmOpsFeedEnabled()) return [];
    const lines: string[] = [
      chalk.hex(this.colors.textDim)(
        truncateToWidth(this.formatActionDockLine(), width),
      ),
    ];
    const status = this.formatActionDockStatusLine();
    if (status !== undefined) {
      lines.push(chalk.hex(this.colors.warning)(truncateToWidth(status, width)));
    }
    return lines;
  }

  private formatActionDockLine(): string {
    const pauseLabel = this.swarmPaused ? 'resume' : 'pause';
    const restaffLabel = this.restaffing ? 'restaff…' : 'restaff';
    const rawLabel = this.showRawFeed ? 'raw · on' : 'raw';
    return `actions · ${pauseLabel} · ${restaffLabel} · ${rawLabel}`;
  }

  private formatActionDockStatusLine(): string | undefined {
    const parts: string[] = [];
    if (this.swarmPaused) {
      const reason =
        this.swarmPausedReason === undefined || this.swarmPausedReason.length === 0
          ? 'steering'
          : this.swarmPausedReason;
      const phase =
        this.swarmPausedPhase === undefined || this.swarmPausedPhase.length === 0
          ? ''
          : ` @ ${this.swarmPausedPhase}`;
      parts.push(`paused${phase} · ${reason}`);
    }
    if (this.restaffing) {
      const reason =
        this.restaffingReason === undefined || this.restaffingReason.length === 0
          ? 'closing gaps'
          : this.restaffingReason;
      parts.push(`restaffing · ${reason}`);
    }
    if (this.showRawFeed) {
      parts.push('feed · raw protocol');
    }
    if (parts.length === 0) return undefined;
    return `status · ${parts.join(' · ')}`;
  }

  private isWarRoomActive(): boolean {
    if (this.members.some((member) => member.ultraSwarm !== undefined)) return true;
    if (this.opsFeed.length > 0) return true;
    if (this.opsToolFeed.length > 0) return true;
    if (this.debateReel.length > 0) return true;
    if (this.fileLeases.size > 0) return true;
    if (this.itemsStarted) return true;
    return false;
  }

  private collectEvidenceWallIds(): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    const push = (raw: string): void => {
      const id = collapseWhitespace(raw);
      if (id.length === 0 || seen.has(id)) return;
      seen.add(id);
      ordered.push(id);
    };
    for (const member of this.members) {
      for (const id of member.evidenceIds ?? []) push(id);
    }
    for (const id of this.feedEvidenceIds) push(id);
    // Path hints from humanized feed bodies surface as soft evidence chips.
    for (const path of this.feedPathHints) push(path);
    return ordered.slice(0, WAR_ROOM_EVIDENCE_WALL_MAX);
  }

  private collectWarRoomHintsFromText(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    for (const match of trimmed.matchAll(WAR_ROOM_EVIDENCE_ID_TOKEN)) {
      const id = match[0]?.trim();
      if (id !== undefined && id.length > 0) this.feedEvidenceIds.add(id);
    }
    for (const match of trimmed.matchAll(WAR_ROOM_PATH_TOKEN)) {
      const path = match[1]?.trim();
      if (path !== undefined && path.length > 0) this.feedPathHints.add(path);
    }
  }

  private pushDebateReelTurn(turn: WarRoomDebateTurn): void {
    this.debateReel.push(turn);
    const maxStored = WAR_ROOM_DEBATE_REEL_MAX * 4;
    if (this.debateReel.length > maxStored) {
      this.debateReel.splice(0, this.debateReel.length - maxStored);
    }
  }

  private indentLines(lines: readonly string[], width: number): string[] {
    const contentWidth = Math.max(
      0,
      width - visibleWidth(AGENT_SWARM_LEFT_INDENT) - AGENT_SWARM_RIGHT_GAP,
    );
    return lines.map((line) =>
      truncateToWidth(
        AGENT_SWARM_LEFT_INDENT + truncateToWidth(line, contentWidth),
        width,
      )
    );
  }

  private renderHeaderLines(width: number, _summary: AgentSwarmSummary | undefined): string[] {
    const dividerStyle = (text: string): string => chalk.hex(this.colors.primary)(text);
    if (width <= 3) {
      return [
        renderRendererDividerRow({
          width,
          style: dividerStyle,
        }),
      ];
    }

    const title = renderAnimatedGradientText(this.title, `agent-swarm:title:${this.title}`);
    const description =
      this.description.length > 0
        ? chalk.hex(this.colors.primary)(` ${renderRendererDividerRow({ width: 1 })} `) +
          chalk.hex(this.colors.text)(this.description)
        : '';
    const lines = [
      renderRendererLabeledDividerRow({
        width,
        label: title + description,
        dividerStyle,
      }),
    ];
    return lines;
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
    const lines: string[] = [];
    for (const member of this.members) {
      if (member.todos.length === 0) continue;
      const memberLines = formatSwarmMemberTodoLines(
        member.todos,
        width,
        this.colors,
        swarmMemberDisplayName(member),
      );
      if (memberLines.length === 0) continue;
      lines.push(chalk.hex(this.colors.textDim)(swarmMemberDisplayName(member)));
      lines.push(...memberLines);
    }
    return lines;
  }

  private renderOpsFeed(width: number): string[] {
    if (!this.isUltraSwarmOpsFeedEnabled()) return [];
    const dividerStyle = (text: string): string => chalk.hex(this.colors.primary)(text);
    const lines: string[] = [
      '',
      renderRendererLabeledDividerRow({
        width,
        label: chalk.hex(this.colors.accent)('LIVE FEED'),
        dividerStyle,
      }),
      ...this.renderOpsFeedContent(width, SWARM_OPS_FEED_RENDER_LINES, true),
    ];
    return lines;
  }

  private renderToolFeed(width: number): string[] {
    if (!this.isUltraSwarmOpsFeedEnabled() || this.opsToolFeed.length === 0) return [];
    const profile = resolveResponsiveLayout({ width });
    const maxLines = profile === 'tiny'
      ? SWARM_OPS_FEED_RENDER_LINES_TINY
      : SWARM_OPS_FEED_RENDER_LINES;
    const dividerStyle = (text: string): string => chalk.hex(this.colors.primary)(text);
    return [
      '',
      renderRendererLabeledDividerRow({
        width,
        label: chalk.hex(this.colors.accent)('TOOL ACTIVITY'),
        dividerStyle,
      }),
      ...this.renderToolFeedContent(width, maxLines),
    ];
  }

  private renderToolFeedContent(
    width: number,
    maxLines = SWARM_OPS_FEED_RENDER_LINES,
  ): string[] {
    return this.opsToolFeed
      .slice(-maxLines)
      .map((entry) => this.renderToolFeedEntry(entry, width));
  }

  private renderToolFeedEntry(entry: SwarmOpsFeedEntry, width: number): string {
    const isFailure = entry.tag === 'fail';
    const tagStyle = chalk.hex(isFailure ? this.colors.warning : this.colors.primary);
    const bodyStyle = chalk.hex(isFailure ? this.colors.warning : this.colors.text);
    const source = chalk.hex(this.colors.textDim)(
      this.formatExpertLabel(entry.fromExpertId, entry.fromName, entry.fromEmoji),
    );
    const glyph = tagStyle(isFailure ? '✗' : '›');
    const separator = chalk.hex(this.colors.textDim)(':');
    return truncateToWidth(
      `${glyph} ${source}${separator} ${bodyStyle(this.resolveFeedEntryBody(entry))}`,
      width,
    );
  }

  private renderOpsFeedContent(
    width: number,
    maxLines = SWARM_OPS_FEED_RENDER_LINES,
    indent = false,
  ): string[] {
    const profile = resolveResponsiveLayout({ width });
    const entries = this.opsFeed
      .filter((entry) => isConversationFeedTag(entry.tag))
      .slice(-maxLines);
    if (entries.length === 0) {
      return [
        truncateToWidth(
          chalk.hex(this.colors.textDim)('awaiting team messages…'),
          width,
        ),
      ];
    }

    const lines: string[] = [];
    let previousThreadKey: string | undefined;
    for (const entry of entries) {
      const threadKey = feedThreadKey(entry);
      const showHeader = threadKey !== previousThreadKey;
      previousThreadKey = threadKey;
      lines.push(...this.renderConversationFeedEntry(entry, width, indent, showHeader, profile));
    }
    return lines.slice(-maxLines);
  }

  private renderConversationFeedEntry(
    entry: SwarmOpsFeedEntry,
    width: number,
    indent: boolean,
    showHeader: boolean,
    profile: ReturnType<typeof resolveResponsiveLayout>,
  ): string[] {
    const pad = indent ? '  ' : '';
    const innerWidth = Math.max(1, width - visibleWidth(pad));
    const bodyText = this.resolveFeedEntryBody(entry);
    const bodyStyled = chalk.hex(this.colors.text)(bodyText);

    if (!showHeader) {
      return [
        truncateToWidth(`${pad}  ${bodyStyled}`, width),
      ];
    }

    const headerPlain = this.formatFeedHeaderPlain(entry);
    const headerStyled = this.formatFeedHeaderStyled(entry);
    const separator = ': ';
    const combinedWidth = visibleWidth(headerPlain) + visibleWidth(separator) + visibleWidth(bodyText);
    const useTwoLines =
      profile === 'tiny' ||
      innerWidth < SWARM_FEED_NARROW_WIDTH ||
      combinedWidth > innerWidth;

    if (useTwoLines) {
      return [
        truncateToWidth(`${pad}${headerStyled}`, width),
        truncateToWidth(`${pad}  ${bodyStyled}`, width),
      ];
    }

    const bodyWidth = Math.max(
      SWARM_FEED_BODY_MIN_WIDTH,
      Math.floor(innerWidth * SWARM_FEED_BODY_WIDTH_RATIO),
    );
    const headerWidth = Math.max(0, innerWidth - bodyWidth - visibleWidth(separator));
    const header = headerWidth > 0
      ? truncateToWidth(headerStyled, headerWidth)
      : '';
    const body = truncateToWidth(bodyStyled, bodyWidth);
    if (header.length === 0) {
      return [truncateToWidth(`${pad}${body}`, width)];
    }
    return [truncateToWidth(`${pad}${header}${separator}${body}`, width)];
  }

  private formatFeedHeaderPlain(entry: SwarmOpsFeedEntry): string {
    return stripAnsiText(this.formatFeedHeaderStyled(entry));
  }

  private formatFeedHeaderStyled(entry: SwarmOpsFeedEntry): string {
    const from = this.formatExpertLabel(entry.fromExpertId, entry.fromName, entry.fromEmoji);
    const fromStyled = chalk.hex(this.colors.primary)(from);
    if (entry.toExpertId !== undefined) {
      const to = this.formatExpertLabel(entry.toExpertId);
      const toLabel = entry.tag === 'mention' ? `@${to}` : to;
      const toStyled = chalk.hex(this.colors.textDim)(toLabel);
      return `${fromStyled}${chalk.hex(this.colors.textDim)('→')}${toStyled}`;
    }
    if (entry.tag === 'block') {
      return `${fromStyled}${chalk.hex(this.colors.warning)(' ⚠')}`;
    }
    if (entry.tag === 'mention') {
      return chalk.hex(this.colors.warning)(`@${fromStyled}`);
    }
    return fromStyled;
  }

  private formatExpertLabel(
    expertId?: string,
    name?: string,
    emoji?: string,
  ): string {
    const slot = this.resolveExpertSlot(expertId, name);
    const trimmedEmoji = emoji?.trim();
    if (slot !== undefined) {
      return trimmedEmoji !== undefined && trimmedEmoji.length > 0 ? `${trimmedEmoji}${slot}` : slot;
    }
    if (name !== undefined && name.length > 0) return shortExpertName(name);
    if (expertId !== undefined && expertId.length > 0) return shortExpertId(expertId);
    return '?';
  }

  private resolveExpertSlot(expertId?: string, name?: string): string | undefined {
    if (expertId !== undefined) {
      const byId = this.expertSlotById.get(expertId);
      if (byId !== undefined) return byId;
    }
    if (name === undefined) return undefined;
    for (const member of this.members) {
      if (member.ultraSwarm?.name === name) return member.id;
    }
    return undefined;
  }

  private rebuildExpertSlotIndex(): void {
    this.expertSlotById.clear();
    for (const member of this.members) {
      const expertId = member.ultraSwarm?.expertId;
      if (expertId !== undefined) this.expertSlotById.set(expertId, member.id);
    }
  }

  private isUltraSwarmOpsFeedEnabled(): boolean {
    return this.title === 'UltraSwarm';
  }

  private resolveFeedEntryBody(entry: SwarmOpsFeedEntry): string {
    if (
      this.showRawFeed &&
      entry.rawBody !== undefined &&
      collapseWhitespace(entry.rawBody).length > 0
    ) {
      return collapseWhitespace(entry.rawBody);
    }
    return entry.body;
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
    const body = collapseWhitespace(input.body);
    if (body.length === 0) return;
    const rawBody =
      input.rawBody === undefined ? undefined : collapseWhitespace(input.rawBody);
    const storedRawBody =
      rawBody !== undefined && rawBody.length > 0 && rawBody !== body ? rawBody : undefined;
    const messageId = input.messageId?.trim();
    if (messageId !== undefined && messageId.length > 0) {
      if (this.seenCollaborationMessageIds.has(messageId)) return;
      this.seenCollaborationMessageIds.add(messageId);
      if (this.seenCollaborationMessageIds.size > SWARM_OPS_FEED_MAX_ENTRIES * 2) {
        // Bound memory; oldest ids drop first via recreation from recent feed.
        this.seenCollaborationMessageIds.clear();
        for (const entry of this.opsFeed) {
          if (entry.messageId !== undefined) {
            this.seenCollaborationMessageIds.add(entry.messageId);
          }
        }
        this.seenCollaborationMessageIds.add(messageId);
      }
    }
    const last = this.opsFeed.at(-1);
    if (
      last !== undefined &&
      last.tag === input.tag &&
      last.fromExpertId === input.fromExpertId &&
      last.fromName === input.fromName &&
      last.toExpertId === input.toExpertId &&
      last.body === body &&
      last.rawBody === storedRawBody
    ) {
      return;
    }
    this.opsFeed.push({
      atMs: Date.now(),
      tag: input.tag,
      messageId,
      fromExpertId: input.fromExpertId,
      fromName: input.fromName,
      fromEmoji: input.fromEmoji,
      toExpertId: input.toExpertId,
      body,
      rawBody: storedRawBody,
    });
    if (this.opsFeed.length > SWARM_OPS_FEED_MAX_ENTRIES) {
      this.opsFeed.splice(0, this.opsFeed.length - SWARM_OPS_FEED_MAX_ENTRIES);
    }
  }

  private appendToolFeed(input: {
    readonly tag: 'tool' | 'fail';
    readonly fromExpertId?: string;
    readonly fromName?: string;
    readonly fromEmoji?: string;
    readonly body: string;
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const body = collapseWhitespace(input.body);
    if (body.length === 0) return;
    const last = this.opsToolFeed.at(-1);
    if (
      last !== undefined &&
      last.tag === input.tag &&
      last.fromExpertId === input.fromExpertId &&
      last.fromName === input.fromName &&
      last.body === body
    ) {
      return;
    }
    this.opsToolFeed.push({
      atMs: Date.now(),
      tag: input.tag,
      fromExpertId: input.fromExpertId,
      fromName: input.fromName,
      fromEmoji: input.fromEmoji,
      body,
    });
    if (this.opsToolFeed.length > SWARM_OPS_FEED_MAX_ENTRIES) {
      this.opsToolFeed.splice(0, this.opsToolFeed.length - SWARM_OPS_FEED_MAX_ENTRIES);
    }
  }

  private renderStatusLine(width: number): string {
    const status = totalStatus(this.members, {
      failed: this.failed,
      aborted: this.aborted,
    });
    const prefix = this.renderActivityPrefix(status);
    if (prefix.length > 0) {
      const contentWidth = Math.max(0, width - visibleWidth(prefix));
      if (contentWidth <= 0) return truncateToWidth(prefix, width);
      return truncateToWidth(`${prefix}${this.renderStatusLineContent(contentWidth, status)}`, width);
    }
    return this.renderStatusLineContent(width, status);
  }

  private renderActivityPrefix(status: TotalStatus): string {
    if (this.toolCallActive && isTerminalTotalStatus(status)) {
      return activityPrefixForTotalStatus(status, this.colors);
    }
    if (this.toolCallActive) {
      const spinner = this.activitySpinnerText?.();
      if (status === 'working' && this.swarmStartedAtMs !== undefined) {
        const elapsed = chalk.hex(this.colors.textDim)(
          ` ${formatElapsedTime(this.swarmStartedAtMs)}`,
        );
        return `${spinner ?? ACTIVITY_SPINNER_PLACEHOLDER}${elapsed}`;
      }
      return spinner ?? '';
    }
    return activityPrefixForTotalStatus(status, this.colors);
  }

  private renderStatusLineContent(width: number, status: TotalStatus): string {
    if (status !== 'working') return this.renderProgressStatusLine(width, status);

    if (!this.inputComplete) {
      return this.renderOrchestratingStatusLine(width);
    }

    return this.renderProgressStatusLine(width, status);
  }

  private renderProgressStatusLine(width: number, status: TotalStatus): string {
    const label = renderStatusLabel(
      totalStatusLabel(status),
      totalStatusLabelToken(status, this.members),
      status === 'working',
      `agent-swarm:status:${status}`,
    );
    if (this.members.length === 0) return truncateToWidth(label, width);
    const barWidth = Math.max(0, width - visibleWidth(label) - TOTAL_STATUS_BAR_GAP);
    if (barWidth <= 0) return truncateToWidth(label, width);
    return truncateToWidth(
      `${label}${' '.repeat(TOTAL_STATUS_BAR_GAP)}${renderStatusPipBar(this.members, barWidth, this.colors)}`,
      width,
    );
  }

  private renderOrchestratingStatusLine(width: number): string {
    if (this.itemsStarted) {
      return truncateToWidth(
        renderStatusLabel(ORCHESTRATING_LABEL, 'primary', true, 'agent-swarm:status:orchestrating'),
        width,
      );
    }

    const promptTemplate = collapseWhitespace(this.promptTemplateText);
    const prompting = promptTemplate.length > 0;
    const label = renderStatusLabel(
      prompting ? PROMPTING_LABEL : ORCHESTRATING_LABEL,
      'primary',
      true,
      prompting ? 'agent-swarm:status:prompting' : 'agent-swarm:status:orchestrating',
    );
    if (promptTemplate.length === 0) return truncateToWidth(label, width);

    const availablePromptWidth = Math.max(
      0,
      width - visibleWidth(label) - PROMPTING_TEXT_TRAILING_GAP,
    );
    const separator = visibleWidth(promptTemplate) <= availablePromptWidth - 1 ? ' ' : '  ';
    const promptWidth = Math.max(0, availablePromptWidth - visibleWidth(separator));
    if (promptWidth <= 0) return truncateToWidth(label, width);
    const prompt = chalk.hex(this.colors.textDim)(truncateStartToWidth(promptTemplate, promptWidth));
    return truncateToWidth(`${label}${separator}${prompt}`, width);
  }

  private renderGrid(
    width: number,
    height: number | undefined,
    members: readonly AgentSwarmMember[],
    snapshots: readonly AgentSwarmSnapshot[],
    nowMs: number,
  ): string[] {
    const layout = calculateAgentSwarmGridLayout({
      width,
      height: height ?? Number.POSITIVE_INFINITY,
      count: members.length,
    });
    const columns = Math.max(1, layout.columns);
    const rows = layout.rows;
    const cellGap = ' '.repeat(layout.columnGap);
    const leftPadding = ' '.repeat(layout.leftPadding);
    const lines: string[] = [];

    for (let row = 0; row < rows; row += 1) {
      const cells: string[] = [];
      for (let col = 0; col < columns; col += 1) {
        const index = row * columns + col;
        const member = members[index];
        const snapshot = snapshots[index];
        if (member === undefined || snapshot === undefined) continue;
        cells.push(padAnsi(this.renderCell(member, snapshot, layout, nowMs), layout.cellWidth));
      }
      lines.push(leftPadding + cells.join(cellGap));
    }
    return lines;
  }

  private renderCell(
    member: AgentSwarmMember,
    snapshot: AgentSwarmSnapshot,
    layout: AgentSwarmGridLayout,
    nowMs: number,
  ): string {
    const width = layout.cellWidth;
    if (snapshot.phase === 'pending') {
      return renderPendingCell(member, width, this.colors);
    }
    if (snapshot.phase === 'cancelled' && snapshot.ticks <= 0) {
      return renderCancelledUnstartedCell(member, width, this.colors);
    }
    if (!layout.renderText) {
      return this.renderCompactCell(member, snapshot, layout.barCells, nowMs);
    }
    if (snapshot.phase === 'queued' && snapshot.ticks <= 0) {
      return renderQueuedCell(member, width, this.colors);
    }

    const estimate = this.progressEstimator.estimate({
      memberKey: member.id,
      phase: snapshot.phase,
      capacityTicks: layout.barCells * RENDERER_BRAILLE_PROGRESS_LEVELS.length,
      nowMs,
    });
    const id = chalk.hex(this.colors.primary)(member.id);
    const bar = brailleBar(
      estimate.displayTicks,
      snapshot.phase,
      layout.barCells,
      this.colors,
      snapshot.phaseElapsedMs,
      cancelledProgressColor(member, snapshot.phase, this.colors),
    );
    const prefix = `${id} ${bar} `;
    const labelWidth = Math.max(1, width - visibleWidth(prefix));
    const label = renderCellLabel(member, snapshot, labelWidth, this.colors, nowMs);
    return prefix + label;
  }

  private renderCompactCell(
    member: AgentSwarmMember,
    snapshot: AgentSwarmSnapshot,
    barCells: number,
    nowMs: number,
  ): string {
    const estimatePhase = snapshot.phase === 'pending' ? 'queued' : snapshot.phase;
    const estimate = this.progressEstimator.estimate({
      memberKey: member.id,
      phase: estimatePhase,
      capacityTicks: barCells * RENDERER_BRAILLE_PROGRESS_LEVELS.length,
      nowMs,
    });
    const id = chalk.hex(this.colors.primary)(member.id);
    const bar = brailleBar(
      estimate.displayTicks,
      estimatePhase,
      barCells,
      this.colors,
      snapshot.phaseElapsedMs,
      cancelledProgressColor(member, snapshot.phase, this.colors),
    );
    return `${id} ${bar}${compactTerminalMark(member, snapshot.phase, this.colors)}`;
  }

  /**
   * One dim line per running child with its latest observable activity: the
   * in-flight tool call while one is pending, otherwise the most recent
   * assistant text snippet. Only running members with something to show are
   * listed, so the section settles to nothing once the swarm finishes.
   */
  private renderChildActivitySection(width: number): string[] {
    const entries: string[] = [];
    for (const member of this.members) {
      if (member.phase !== 'running') continue;
      const activity = member.activeToolName !== undefined
        ? `using ${member.activeToolName}`
        : collapseWhitespace(latestNonEmptyLine(member.latestModelText));
      if (activity.length === 0) continue;
      entries.push(`${swarmMemberDisplayName(member)}: ${activity}`);
    }
    if (entries.length === 0) return [];
    const dim = this.colors.textDim;
    const lines = entries
      .slice(0, MAX_CHILD_ACTIVITY_LINES)
      .map((entry) => truncateWithColor(entry, width, dim));
    if (entries.length > MAX_CHILD_ACTIVITY_LINES) {
      const hidden = entries.length - MAX_CHILD_ACTIVITY_LINES;
      lines.push(truncateWithColor(`… +${String(hidden)} more`, width, dim));
    }
    return lines;
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

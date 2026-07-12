import {
  RENDERER_BRAILLE_PROGRESS_EMPTY,
  RENDERER_BRAILLE_PROGRESS_LEVELS,
  RENDERER_BRAILLE_PROGRESS_SEPARATOR,
  renderRendererDividerRow,
  renderRendererLabeledDividerRow,
  renderRendererSegmentedProgressBar,
  renderRendererSteppedProgressBar,
  truncateToWidth,
  visibleWidth,
  type Component,
  type RendererSteppedProgressBarCellProjection,
} from '#/tui/renderer';
import chalk from 'chalk';

import {
  AgentSwarmProgressEstimator,
  type AgentSwarmProgressEstimatorPhase,
} from '#/tui/components/messages/agent-swarm-progress-estimator';
import { FAILURE_MARK, SUCCESS_MARK } from '#/tui/constant/symbols';
import {
  formatSwarmMemberTodoLines,
  type TodoItem,
} from '#/tui/components/chrome/todo-panel';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import { renderAnimatedGradientText } from '#/tui/utils/appearance-effects';
import { renderParticleRail } from '#/tui/utils/appearance-effects';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';
import { renderRoundedPanel } from '#/tui/utils/panel-frame';
import { gradientText } from '#/tui/theme/gradient-text';

const TEXT_CELL_PREFERRED_WIDTH = 30;
const CELL_GAP = '  ';
const FRAME_INTERVAL_MS = 80;
const TEXT_BRAILLE_BAR_MIN_WIDTH = 6;
const BRAILLE_BAR_MAX_WIDTH = 8;
const PHASE_LABEL_WIDTH = 'Completed'.length;
const MIN_LABEL_WIDTH = PHASE_LABEL_WIDTH;
const MAX_LATEST_MODEL_CHARS = 2_000;
const COMPLETE_FILL_MS = 360;
const FAILED_PLACEHOLDER_RED_FACTOR = 0.75;
const FAILED_PLACEHOLDER_NON_RED_FACTOR = 0.25;
const STATUS_BAR_CHAR = '━';
const CANCELLED_MARK = '⊘ ';
const TOTAL_STATUS_BAR_GAP = 2;
const PROMPTING_TEXT_TRAILING_GAP = 1;
const ACTIVITY_SPINNER_PLACEHOLDER = '  ';
const AGENT_SWARM_LEFT_INDENT = ' ';
const AGENT_SWARM_RIGHT_GAP = 1;
const AGENT_SWARM_NON_GRID_LINES = 14;
/** Extra transcript rows reserved for the UltraSwarm feed box (border + feed + padding). */
export const AGENT_SWARM_OPS_FEED_LINE_BUDGET = 10;
const SWARM_OPS_FEED_MAX_ENTRIES = 48;
const SWARM_OPS_FEED_RENDER_LINES = 8;
const SWARM_OPS_FEED_RENDER_LINES_TINY = 4;
const CONVERSATION_FEED_TAGS = new Set<SwarmOpsFeedTag>(['msg', 'mention', 'block', 'council']);
const SWARM_FEED_BODY_MIN_WIDTH = 24;
const SWARM_FEED_BODY_WIDTH_RATIO = 0.65;
const SWARM_FEED_NARROW_WIDTH = 72;
const SWARM_FEED_SHORT_NAME_MAX = 6;
const SWARM_FEED_SHORT_ID_MAX = 6;
const COMPACT_TERMINAL_MARK_WIDTH = 1;
const ORCHESTRATING_LABEL = 'Orchestrating...';
const PROMPTING_LABEL = 'Prompting...';
const WORKING_LABEL = 'Working...';
const COMPLETED_LABEL = 'Completed.';
const FAILED_LABEL = 'Failed.';
const ABORTED_LABEL = 'Aborted.';
const CANCELLED_LABEL = 'Cancelled.';
const QUEUED_LABEL = 'Queued...';
const SUSPENDED_LABEL = 'Rate limited...';
const RESUMED_ITEM_LABEL = '(resumed)';
const CANCELLED_LABEL_DARKEN_FACTOR = 0.72;

const STATUS_BAR_ORDER = [
  'completed',
  'working',
  'suspended',
  'queued',
  'cancelled',
  'failed',
] as const;

type AgentSwarmPhase = AgentSwarmProgressEstimatorPhase;
type StatusBarPhase = typeof STATUS_BAR_ORDER[number];
type TotalStatus = 'working' | 'completed' | 'suspended' | 'failed' | 'aborted';
type ClearableMemberKey =
  | 'completedAtMs'
  | 'completedText'
  | 'failedAtMs'
  | 'failureText'
  | 'cancelledLabelText'
  | 'cancelledLabelColor'
  | 'cancelledMarkColor'
  | 'cancelledBarColor'
  | 'suspendedReason';

const COMPLETED_CLEAR_KEYS = [
  'failedAtMs',
  'failureText',
  'cancelledLabelText',
  'cancelledLabelColor',
  'cancelledMarkColor',
  'cancelledBarColor',
  'suspendedReason',
] as const satisfies readonly ClearableMemberKey[];
const FAILED_CLEAR_KEYS = [
  'completedAtMs',
  'completedText',
  'cancelledLabelText',
  'cancelledLabelColor',
  'cancelledMarkColor',
  'cancelledBarColor',
  'suspendedReason',
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
] as const satisfies readonly ClearableMemberKey[];
const CANCELLED_CLEAR_KEYS = [
  'completedAtMs',
  'completedText',
  'failedAtMs',
  'failureText',
  'suspendedReason',
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

type SwarmOpsFeedTag =
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

interface SwarmCollaborationFeedMessage {
  readonly from: { readonly expertId?: string; readonly name: string; readonly emoji?: string };
  readonly to?: { readonly expertId: string };
  readonly channel: 'standup' | 'lane' | 'direct' | 'blocker' | 'council';
  readonly body: string;
}

interface SwarmOpsFeedEntry {
  readonly atMs: number;
  readonly tag: SwarmOpsFeedTag;
  readonly fromExpertId?: string;
  readonly fromName?: string;
  readonly fromEmoji?: string;
  readonly toExpertId?: string;
  readonly body: string;
}

interface AgentSwarmMember {
  readonly id: string;
  agentId?: string;
  phase: AgentSwarmPhase;
  ticks: number;
  itemText: string;
  latestModelText: string;
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
  todos: TodoItem[];
}

interface AgentSwarmSnapshot {
  readonly phase: AgentSwarmPhase;
  readonly ticks: number;
  readonly latestModelText: string;
  readonly phaseElapsedMs: number;
}

interface AgentSwarmResultStatus {
  readonly index: number;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly verdict?: string;
  readonly evidenceIds?: readonly string[];
  readonly ultraSwarm?: UltraSwarmMemberMetadata;
  readonly completedText?: string;
  readonly failureText?: string;
}

interface UltraSwarmIntegrationReportAgent {
  readonly expertId: string;
  readonly name: string;
  readonly emoji?: string;
  readonly phase: string;
  readonly focus?: string;
  readonly outcome: string;
  readonly verdict: string;
  readonly summary?: string;
  readonly findings?: string;
  readonly risksAndGaps?: string;
}

interface UltraSwarmIntegrationReport {
  readonly headline: string;
  readonly agents: readonly UltraSwarmIntegrationReportAgent[];
  readonly openGaps?: string;
}

export interface AgentSwarmResultSummary {
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
  readonly parsed: boolean;
}

interface AgentSwarmSummary {
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface AgentSwarmGridLayoutInput {
  readonly width: number;
  readonly height: number;
  readonly count: number;
}

export interface AgentSwarmGridLayout {
  readonly renderText: boolean;
  readonly barCells: number;
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly columnGap: number;
  readonly leftPadding: number;
}

export interface AgentSwarmProgressOptions {
  readonly description: string;
  readonly title?: string | undefined;
  readonly requestRender?: () => void;
  readonly availableGridHeight?: () => number | undefined;
}

const PHASE_LABELS: Record<AgentSwarmPhase, string> = {
  pending: QUEUED_LABEL,
  queued: QUEUED_LABEL,
  suspended: SUSPENDED_LABEL,
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: ABORTED_LABEL,
};

export class AgentSwarmProgressComponent implements Component {
  private members: AgentSwarmMember[];
  private readonly progressEstimator = new AgentSwarmProgressEstimator();
  private description: string;
  private readonly title: string;
  private routingBadge: string | undefined;
  private readonly requestRender: (() => void) | undefined;
  private readonly availableGridHeight: (() => number | undefined) | undefined;
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
  private readonly expertSlotById = new Map<string, string>();
  private integrationReport: UltraSwarmIntegrationReport | undefined;

  constructor(options: AgentSwarmProgressOptions) {
    this.description = options.description;
    this.title = options.title ?? 'Agent Swarm';
    this.requestRender = options.requestRender;
    this.availableGridHeight = options.availableGridHeight;
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
    const phase = input.phase === undefined ? '' : ` @ ${input.phase}`;
    this.appendConversationFeed({
      tag: 'stop',
      fromExpertId: 'orchestrator',
      fromName: 'Orchestrator',
      fromEmoji: '⏸',
      body: `paused for steering${phase} · ${input.reason}`,
    });
    this.requestRender?.();
  }

  applySwarmCollaborationMessage(message: SwarmCollaborationFeedMessage): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    if (!isAgentConversationChannel(message.channel)) return;
    this.appendConversationFeed({
      tag: swarmCollaborationFeedTag(message.channel),
      fromExpertId: message.from.expertId,
      fromName: message.from.name,
      fromEmoji: message.from.emoji,
      toExpertId: message.to?.expertId,
      body: message.body,
    });
  }

  applySwarmCollaborationMention(message: SwarmCollaborationFeedMessage): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    this.appendConversationFeed({
      tag: 'mention',
      fromExpertId: message.from.expertId,
      fromName: message.from.name,
      fromEmoji: message.from.emoji,
      toExpertId: message.to?.expertId,
      body: message.body,
    });
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
  }): void {
    const member = this.findMemberForSubagent(input.agentId, input.swarmIndex);
    if (member === undefined) return;
    member.agentId = input.agentId;
    if (member.phase === 'pending') member.phase = 'queued';
    this.startAnimationIfNeeded();
  }

  markStarted(agentId: string): void {
    const member = this.findMemberByAgentId(agentId);
    if (member === undefined) return;
    const nowMs = Date.now();
    this.progressEstimator.markStarted(member.id, nowMs);
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
    member.ticks += 1;
    if (input.summary !== undefined && input.summary.length > 0) {
      const prefix = input.isError === true ? '⚠ ' : '';
      const line = `${prefix}${input.summary}`.slice(0, MAX_LATEST_MODEL_CHARS);
      member.latestModelText = line;
    }
    this.promoteToRunning(member);
    this.startAnimationIfNeeded();
  }

  appendModelDelta(input: {
    readonly agentId: string;
    readonly delta: string;
  }): void {
    const member = this.findMemberByAgentId(input.agentId);
    if (member === undefined || input.delta.length === 0) return;
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

  markFailed(agentId: string, failureText?: string): void {
    const member = this.findMemberByAgentId(agentId);
    if (member === undefined) return;
    const nowMs = Date.now();
    this.failMember(member, nowMs, failureText);
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
        ? this.renderUltraSwarmLayout(innerWidth, summary, sortedSnapshots, nowMs)
        : [
            '',
            ...this.renderIntegratedDashboard(innerWidth, summary),
            '',
            ...this.renderGrid(
              innerWidth,
              this.availableGridHeight?.(),
              sortedSnapshots,
              nowMs,
            ),
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
      return this.renderUltraSwarmLayout(width, summary, [], Date.now());
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
    snapshots: readonly AgentSwarmSnapshot[],
    nowMs: number,
  ): string[] {
    const profile = resolveResponsiveLayout({ width });
    const missionContent = this.renderMissionContent(width, summary);
    const teamContent = this.renderGrid(width, this.availableGridHeight?.(), snapshots, nowMs);
    const feedLimit = profile === 'tiny' ? SWARM_OPS_FEED_RENDER_LINES_TINY : SWARM_OPS_FEED_RENDER_LINES;
    const feedContent = this.renderOpsFeedContent(width, feedLimit);
    const reportContent = this.renderIntegrationReportContent(width);
    const statusFooter = ['', this.renderStatusLine(width), ''];

    const teamBody = teamContent.length > 0
      ? teamContent
      : [chalk.hex(this.colors.textDim)('awaiting agents…')];
    const feedHeader = chalk.hex(this.colors.textDim)('feed');
    const panelContent = [
      ...missionContent,
      '',
      ...teamBody,
      ...(reportContent.length > 0 ? ['', ...reportContent] : []),
      '',
      feedHeader,
      ...feedContent,
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
    const segments = [
      running > 0 ? `${String(running)} working` : undefined,
      summary.completed > 0 ? `${String(summary.completed)}/${String(total)} done` : undefined,
      summary.failed > 0 ? `${String(summary.failed)} failed` : undefined,
    ].filter((segment): segment is string => segment !== undefined);
    return segments.length > 0 ? segments.join(' · ') : `${String(total)} agents`;
  }

  private renderIntegrationReportContent(width: number): string[] {
    const report = this.integrationReport;
    if (report === undefined) return [];

    const lines: string[] = [chalk.hex(this.colors.textDim)('report')];
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

  private renderHeaderLines(width: number, summary: AgentSwarmSummary | undefined): string[] {
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
        label: chalk.hex(this.colors.accent)('SWARM FEED'),
        dividerStyle,
      }),
      ...this.renderOpsFeedContent(width, SWARM_OPS_FEED_RENDER_LINES, true),
    ];
    return lines;
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
    const bodyText = entry.body;
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

  private appendConversationFeed(input: {
    readonly tag: SwarmOpsFeedTag;
    readonly fromExpertId?: string;
    readonly fromName?: string;
    readonly fromEmoji?: string;
    readonly toExpertId?: string;
    readonly body: string;
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const body = collapseWhitespace(input.body);
    if (body.length === 0) return;
    const last = this.opsFeed.at(-1);
    if (
      last !== undefined &&
      last.tag === input.tag &&
      last.fromExpertId === input.fromExpertId &&
      last.fromName === input.fromName &&
      last.toExpertId === input.toExpertId &&
      last.body === body
    ) {
      return;
    }
    this.opsFeed.push({
      atMs: Date.now(),
      tag: input.tag,
      fromExpertId: input.fromExpertId,
      fromName: input.fromName,
      fromEmoji: input.fromEmoji,
      toExpertId: input.toExpertId,
      body,
    });
    if (this.opsFeed.length > SWARM_OPS_FEED_MAX_ENTRIES) {
      this.opsFeed.splice(0, this.opsFeed.length - SWARM_OPS_FEED_MAX_ENTRIES);
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
      totalStatusLabelColor(status, this.members, this.colors),
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
        renderStatusLabel(ORCHESTRATING_LABEL, this.colors.primary),
        width,
      );
    }

    const promptTemplate = collapseWhitespace(this.promptTemplateText);
    const label = renderStatusLabel(
      promptTemplate.length > 0 ? PROMPTING_LABEL : ORCHESTRATING_LABEL,
      this.colors.primary,
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
    snapshots: readonly AgentSwarmSnapshot[],
    nowMs: number,
  ): string[] {
    const layout = calculateAgentSwarmGridLayout({
      width,
      height: height ?? Number.POSITIVE_INFINITY,
      count: this.members.length,
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
        const member = this.members[index];
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
    const label = renderCellLabel(member, snapshot, labelWidth, this.colors);
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

  private failMember(member: AgentSwarmMember, nowMs: number, failureText?: string): void {
    if (member.phase !== 'failed') {
      this.progressEstimator.markFailed(member.id, nowMs);
      member.failedAtMs = nowMs;
    }
    const normalizedFailureText = normalizeFailureText(failureText);
    if (normalizedFailureText !== undefined) member.failureText = normalizedFailureText;
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

function isTerminalPhase(phase: AgentSwarmPhase): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled';
}

function terminalPhaseElapsedMs(member: AgentSwarmMember, nowMs: number): number {
  const startedAtMs = member.phase === 'completed'
    ? member.completedAtMs
    : member.phase === 'failed'
      ? member.failedAtMs
      : undefined;
  return startedAtMs === undefined ? 0 : Math.max(0, nowMs - startedAtMs);
}

export function agentSwarmItemsFromArgs(args: Record<string, unknown>): string[] {
  const items = args['items'];
  if (!Array.isArray(items)) return [];
  return items.map(String);
}

function agentSwarmResumeItemsFromArgs(args: Record<string, unknown>): string[] {
  const resumeAgentIds = args['resume_agent_ids'];
  if (
    typeof resumeAgentIds !== 'object' ||
    resumeAgentIds === null ||
    Array.isArray(resumeAgentIds)
  ) {
    return [];
  }
  return Object.keys(resumeAgentIds).map(() => RESUMED_ITEM_LABEL);
}

function ultraSwarmExpertItemsFromArgs(args: Record<string, unknown>): string[] {
  const experts = args['experts'];
  const requiredExperts = args['required_experts'];
  return [
    ...(Array.isArray(experts) ? experts.map(String) : []),
    ...(Array.isArray(requiredExperts) ? requiredExperts.map(String) : []),
  ];
}

export function agentSwarmPartialItemsCountFromArguments(argumentsText: string): number {
  return agentSwarmPartialItemsFromArguments(argumentsText).length;
}

function swarmWorkItemsStartedFromArguments(argumentsText: string): boolean {
  return (
    /"items"\s*:/.test(argumentsText) ||
    /"resume_agent_ids"\s*:/.test(argumentsText) ||
    /"experts"\s*:/.test(argumentsText) ||
    /"required_experts"\s*:/.test(argumentsText)
  );
}

export function agentSwarmPartialItemsFromArguments(argumentsText: string): string[] {
  const match = /"items"\s*:\s*\[/.exec(argumentsText);
  if (match === null) return [];
  const items: string[] = [];
  for (let i = match.index + match[0].length; i < argumentsText.length; i += 1) {
    const ch = argumentsText[i];
    if (ch === ']') return items;
    if (ch !== '"') continue;

    const parsed = parsePartialJsonString(argumentsText, i + 1);
    items.push(parsed.value);
    if (parsed.closed) {
      i = parsed.nextIndex;
      continue;
    }
    return items;
  }
  return items;
}

function agentSwarmPartialResumeItemsFromArguments(argumentsText: string): string[] {
  const match = /"resume_agent_ids"\s*:\s*\{/.exec(argumentsText);
  if (match === null) return [];
  return Array.from(
    { length: countPartialJsonObjectEntries(argumentsText, match.index + match[0].length) },
    () => RESUMED_ITEM_LABEL,
  );
}

function ultraSwarmPartialExpertItemsFromArguments(argumentsText: string): string[] {
  return [
    ...partialStringArrayFromArguments(argumentsText, 'experts'),
    ...partialStringArrayFromArguments(argumentsText, 'required_experts'),
  ];
}

function partialStringArrayFromArguments(argumentsText: string, field: string): string[] {
  const match = new RegExp(`"${field}"\\s*:\\s*\\[`).exec(argumentsText);
  if (match === null) return [];
  const items: string[] = [];
  for (let i = match.index + match[0].length; i < argumentsText.length; i += 1) {
    const ch = argumentsText[i];
    if (ch === ']') return items;
    if (ch !== '"') continue;

    const parsed = parsePartialJsonString(argumentsText, i + 1);
    items.push(parsed.value);
    if (parsed.closed) {
      i = parsed.nextIndex;
      continue;
    }
    return items;
  }
  return items;
}

export function agentSwarmDescriptionFromArgs(args: Record<string, unknown>): string {
  const description = args['description'];
  return typeof description === 'string' ? description : '';
}

function agentSwarmPromptTemplateFromArgs(args: Record<string, unknown>): string {
  const promptTemplate = args['prompt_template'];
  return typeof promptTemplate === 'string' ? promptTemplate : '';
}

function agentSwarmPartialPromptTemplateFromArguments(argumentsText: string): string {
  const match = /"prompt_template"\s*:\s*"/.exec(argumentsText);
  if (match === null) return '';
  return parsePartialJsonString(argumentsText, match.index + match[0].length).value;
}

export function agentSwarmResultSummaryFromOutput(output: string): AgentSwarmResultSummary {
  const statuses = parseAgentSwarmResultStatuses(output);
  let completed = 0;
  let failed = 0;
  let aborted = 0;
  for (const status of statuses) {
    if (status.status === 'completed') completed += 1;
    if (status.status === 'failed') failed += 1;
    if (status.status === 'cancelled') aborted += 1;
  }
  return {
    completed,
    failed,
    aborted,
    parsed: statuses.length > 0,
  };
}

function parseAgentSwarmResultStatuses(output: string): AgentSwarmResultStatus[] {
  const xmlStatuses = parseAgentSwarmXmlResultStatuses(output);
  if (xmlStatuses.length > 0) return xmlStatuses;
  const ultraXmlStatuses = parseUltraSwarmXmlResultStatuses(output);
  if (ultraXmlStatuses.length > 0) return ultraXmlStatuses;
  return parseAgentSwarmLegacyResultStatuses(output);
}

function forEachSubagentTag<T>(
  output: string,
  callback: (attrs: string, body: string, index: number) => T | undefined,
): T[] {
  const result: T[] = [];
  const tagPattern = /<subagent\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = tagPattern.exec(output)) !== null) {
    const attrs = match[1] ?? '';
    const closeIndex = output.indexOf('</subagent>', tagPattern.lastIndex);
    if (closeIndex < 0) break;
    const body = output.slice(tagPattern.lastIndex, closeIndex);
    index += 1;
    const value = callback(attrs, body, index);
    if (value !== undefined) result.push(value);
    tagPattern.lastIndex = closeIndex + '</subagent>'.length;
  }
  return result;
}

function parseAgentSwarmXmlResultStatuses(output: string): AgentSwarmResultStatus[] {
  return forEachSubagentTag(output, (attrs, body, tagIndex) => {
    const explicitIndex = Number(xmlAttribute(attrs, 'index'));
    const index =
      Number.isInteger(explicitIndex) && explicitIndex > 0 ? explicitIndex : tagIndex;
    const outcome = xmlAttribute(attrs, 'outcome');
    if (
      outcome !== 'completed' &&
      outcome !== 'failed' &&
      outcome !== 'aborted' &&
      outcome !== 'cancelled'
    ) {
      return undefined;
    }
    return {
      index,
      status: outcome === 'aborted' || outcome === 'cancelled' ? 'cancelled' : outcome,
      completedText: outcome === 'completed' ? body : undefined,
      failureText: outcome === 'failed' ? body : undefined,
    };
  });
}

function parseUltraSwarmXmlResultStatuses(output: string): AgentSwarmResultStatus[] {
  const result: AgentSwarmResultStatus[] = [];
  const tagPattern = /<expert\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = tagPattern.exec(output)) !== null) {
    const attrs = match[1] ?? '';
    const closeIndex = output.indexOf('</expert>', tagPattern.lastIndex);
    if (closeIndex < 0) break;
    const body = output.slice(tagPattern.lastIndex, closeIndex);
    index += 1;
    const outcome = xmlAttribute(attrs, 'outcome');
    if (
      outcome === 'completed' ||
      outcome === 'failed' ||
      outcome === 'aborted' ||
      outcome === 'cancelled'
    ) {
      result.push({
        index,
        status: outcome === 'aborted' || outcome === 'cancelled' ? 'cancelled' : outcome,
        verdict: xmlAttribute(attrs, 'verdict'),
        evidenceIds: commaSeparatedXmlAttribute(attrs, 'evidence_ids'),
        ultraSwarm: {
          expertId: xmlAttribute(attrs, 'expert_id') ?? xmlAttribute(attrs, 'name') ?? `expert-${String(index)}`,
          name: xmlAttribute(attrs, 'name') ?? `Expert ${String(index)}`,
          division: xmlAttribute(attrs, 'division'),
          emoji: xmlAttribute(attrs, 'emoji'),
          coverageLane: xmlAttribute(attrs, 'coverage_lane'),
          selectionReason: selectionReasonFromUltraSwarmBody(body),
          focus: xmlAttribute(attrs, 'focus'),
          dependsOn: commaSeparatedXmlAttribute(attrs, 'depends_on'),
          taskIds: commaSeparatedXmlAttribute(attrs, 'work_node_ids'),
        },
        completedText: outcome === 'completed' ? stripUltraSwarmMetadata(body) : undefined,
        failureText: outcome === 'failed' ? stripUltraSwarmMetadata(body) : undefined,
      });
    }
    tagPattern.lastIndex = closeIndex + '</expert>'.length;
  }
  return result;
}

function parseUltraSwarmIntegrationReport(output: string): UltraSwarmIntegrationReport | undefined {
  const reportMatch = /<integration_report\b([^>]*)>([\s\S]*?)<\/integration_report>/i.exec(output);
  if (reportMatch === null) return undefined;

  const inner = reportMatch[2] ?? '';
  const headline = xmlElementText(inner, 'headline') ?? '';
  const openGaps = xmlElementText(inner, 'open_gaps');
  const agents: UltraSwarmIntegrationReportAgent[] = [];
  const agentPattern = /<agent\b([^>]*)>([\s\S]*?)<\/agent>/gi;
  let agentMatch: RegExpExecArray | null;
  while ((agentMatch = agentPattern.exec(inner)) !== null) {
    const attrs = agentMatch[1] ?? '';
    const body = agentMatch[2] ?? '';
    const expertId = xmlAttribute(attrs, 'expert_id');
    const name = xmlAttribute(attrs, 'name');
    if (expertId === undefined || name === undefined) continue;
    agents.push({
      expertId,
      name,
      emoji: xmlAttribute(attrs, 'emoji'),
      phase: xmlAttribute(attrs, 'phase') ?? 'unknown',
      focus: xmlAttribute(attrs, 'focus'),
      outcome: xmlAttribute(attrs, 'outcome') ?? 'unknown',
      verdict: xmlAttribute(attrs, 'verdict') ?? 'UNKNOWN',
      summary: xmlElementText(body, 'summary'),
      findings: xmlElementText(body, 'findings'),
      risksAndGaps: xmlElementText(body, 'risks_and_gaps'),
    });
  }

  if (agents.length === 0 && headline.length === 0) return undefined;
  return { headline, agents, openGaps };
}

function xmlElementText(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  const value = match?.[1]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function stripUltraSwarmMetadata(body: string): string {
  return body.replaceAll(/<selection_reason>[\s\S]*?<\/selection_reason>\n?/g, '').trim();
}

function selectionReasonFromUltraSwarmBody(body: string): string | undefined {
  const match = /<selection_reason>([\s\S]*?)<\/selection_reason>/.exec(body);
  return match?.[1]?.trim();
}

function commaSeparatedXmlAttribute(attrs: string, name: string): readonly string[] | undefined {
  const value = xmlAttribute(attrs, name);
  if (value === undefined || value.trim().length === 0) return undefined;
  const items = value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  return items.length === 0 ? undefined : items;
}

export function isSwarmProgressToolName(toolName: string): boolean {
  return toolName === 'AgentSwarm' || toolName === 'UltraSwarm';
}

export function swarmProgressTitleForToolName(toolName: string): string {
  return toolName === 'UltraSwarm' ? 'UltraSwarm' : 'Agent Swarm';
}

function xmlAttribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match?.[1];
}

function forEachAgentBlock<T>(
  output: string,
  callback: (block: string, index: number) => T | undefined,
): T[] {
  const result: T[] = [];
  for (const block of output.split(/\n(?=\[agent \d+\]\n)/)) {
    const indexMatch = /^\[agent (\d+)\]$/m.exec(block);
    if (indexMatch === null) continue;
    const value = callback(block, Number(indexMatch[1]));
    if (value !== undefined) result.push(value);
  }
  return result;
}

function parseAgentSwarmLegacyResultStatuses(output: string): AgentSwarmResultStatus[] {
  return forEachAgentBlock(output, (block, index) => {
    const statusMatch = /^status: (completed|failed|aborted|cancelled)$/m.exec(block);
    if (statusMatch === null) return undefined;
    const status = statusMatch[1] as 'completed' | 'failed' | 'aborted' | 'cancelled';
    return {
      index,
      status: status === 'aborted' || status === 'cancelled' ? 'cancelled' : status,
      completedText: status === 'completed' ? parseAgentSwarmCompletedText(block) : undefined,
      failureText: status === 'failed' ? parseAgentSwarmFailureText(block) : undefined,
    };
  });
}

function parseAgentSwarmCompletedText(block: string): string | undefined {
  const marker = '\n[summary]\n';
  const markerIndex = block.indexOf(marker);
  if (markerIndex < 0) return undefined;
  return normalizeFinalOutputText(block.slice(markerIndex + marker.length));
}

function parseAgentSwarmFailureText(block: string): string | undefined {
  const match = /^subagent error:\s*([\s\S]*)$/m.exec(block);
  if (match === null) return undefined;
  return normalizeFailureText(match[1]);
}

function textGridLayout(
  columns: number,
  rows: number,
  cellWidth: number,
  gapWidth: number,
  idWidth: number,
): AgentSwarmGridLayout {
  return {
    renderText: true,
    barCells: barCellsForTextCellWidth(cellWidth, idWidth),
    columns,
    rows,
    cellWidth,
    columnGap: gapWidth,
    leftPadding: 0,
  };
}

export function calculateAgentSwarmGridLayout(
  input: AgentSwarmGridLayoutInput,
): AgentSwarmGridLayout {
  const count = Math.max(0, Math.floor(input.count));
  const width = Math.max(0, Math.floor(input.width));
  const height = Math.max(0, Math.floor(input.height));
  const idWidth = agentSwarmGridIdWidth(count);

  if (count === 0) {
    return {
      renderText: true,
      barCells: 1,
      columns: 0,
      rows: 0,
      cellWidth: 0,
      columnGap: 0,
      leftPadding: 0,
    };
  }

  const textGapWidth = visibleWidth(CELL_GAP);
  const compactGapWidth = textGapWidth;
  const textColumns = columnsForCellWidth(width, count, TEXT_CELL_PREFERRED_WIDTH, textGapWidth);
  const textRows = rowsForColumns(count, textColumns);
  const textCellWidth = gridCellWidth(width, textColumns, textGapWidth);
  if (textRows <= height && textCellWidth >= minTextCellWidth(idWidth)) {
    return textGridLayout(textColumns, textRows, textCellWidth, textGapWidth, idWidth);
  }
  const targetTextColumns = height <= 0 ? count : Math.min(count, Math.ceil(count / height));
  const targetTextCellWidth = gridCellWidth(width, targetTextColumns, textGapWidth);
  const targetTextRows = rowsForColumns(count, targetTextColumns);
  if (height > 0 && targetTextRows <= height && targetTextCellWidth >= minTextCellWidth(idWidth)) {
    return textGridLayout(targetTextColumns, targetTextRows, targetTextCellWidth, textGapWidth, idWidth);
  }

  const compactColumns = compactColumnsForLayout(width, count, height, idWidth, compactGapWidth);
  const compactCellWidthBudget = gridCellWidth(width, compactColumns, compactGapWidth);
  const compactBarCells = compactBarCellsForCellWidth(compactCellWidthBudget, idWidth);
  const compactActualCellWidth = compactCellWidth(idWidth, compactBarCells);
  return {
    renderText: false,
    barCells: compactBarCells,
    columns: compactColumns,
    rows: rowsForColumns(count, compactColumns),
    cellWidth: compactActualCellWidth,
    columnGap: compactGapWidth,
    leftPadding: 0,
  };
}

export function agentSwarmGridHeightForTerminalRows(
  rows: number | undefined,
  followingRows = 0,
  options?: { readonly opsFeed?: boolean },
): number | undefined {
  if (rows === undefined || !Number.isFinite(rows)) return undefined;
  const rowsAfterSwarm = Number.isFinite(followingRows)
    ? Math.max(0, Math.floor(followingRows))
    : 0;
  const nonGridLines =
    AGENT_SWARM_NON_GRID_LINES +
    (options?.opsFeed === true ? AGENT_SWARM_OPS_FEED_LINE_BUDGET : 0);
  return Math.max(0, Math.floor(rows) - rowsAfterSwarm - nonGridLines);
}

function agentSwarmGridIdWidth(count: number): number {
  return Math.max(3, String(Math.max(1, count)).length);
}

function columnsForCellWidth(
  width: number,
  count: number,
  cellWidth: number,
  gapWidth: number,
): number {
  if (count <= 1) return count <= 0 ? 0 : 1;
  const columns = Math.floor((width + gapWidth) / (Math.max(1, cellWidth) + gapWidth));
  return Math.max(1, Math.min(count, columns));
}

function rowsForColumns(count: number, columns: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / Math.max(1, columns));
}

function gridCellWidth(width: number, columns: number, gapWidth: number): number {
  if (columns <= 0) return 0;
  return Math.max(
    1,
    Math.floor((width - gapWidth * Math.max(0, columns - 1)) / columns),
  );
}

function minTextCellWidth(idWidth: number): number {
  return idWidth + TEXT_BRAILLE_BAR_MIN_WIDTH + 4 + MIN_LABEL_WIDTH;
}

function barCellsForTextCellWidth(cellWidth: number, idWidth: number): number {
  const fixedWidth = idWidth + 1 + 2 + 1 + MIN_LABEL_WIDTH;
  const availableForBar = cellWidth - fixedWidth;
  return availableForBar >= TEXT_BRAILLE_BAR_MIN_WIDTH
    ? Math.min(BRAILLE_BAR_MAX_WIDTH, availableForBar)
    : TEXT_BRAILLE_BAR_MIN_WIDTH;
}

function compactColumnsForLayout(
  width: number,
  count: number,
  height: number,
  idWidth: number,
  gapWidth: number,
): number {
  const maxColumns = columnsForCellWidth(width, count, compactCellWidth(idWidth, 1), gapWidth);
  if (height <= 0) return maxColumns;
  const targetColumns = Math.min(count, Math.ceil(count / height));
  return Math.max(1, Math.min(targetColumns, maxColumns));
}

function compactBarCellsForCellWidth(cellWidth: number, idWidth: number): number {
  return Math.max(
    1,
    cellWidth - compactFixedWidth(idWidth) - COMPACT_TERMINAL_MARK_WIDTH,
  );
}

function compactCellWidth(idWidth: number, barCells: number): number {
  return compactFixedWidth(idWidth) + Math.max(1, barCells) + COMPACT_TERMINAL_MARK_WIDTH;
}

function compactFixedWidth(idWidth: number): number {
  return idWidth + 1 + 2;
}

function summarizeSnapshots(snapshots: readonly AgentSwarmSnapshot[]): AgentSwarmSummary {
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  for (const snapshot of snapshots) {
    if (snapshot.phase === 'completed') completed += 1;
    if (snapshot.phase === 'failed') failed += 1;
    if (snapshot.phase === 'cancelled') cancelled += 1;
  }
  return {
    active: snapshots.length - completed - failed - cancelled,
    completed,
    failed,
    cancelled,
  };
}

function brailleBar(
  ticks: number,
  phase: AgentSwarmPhase,
  width: number,
  colors: ColorPalette,
  phaseElapsedMs: number,
  phaseColorOverride?: string,
): string {
  const innerWidth = Math.max(1, width);
  if (phase === 'pending') return '';
  if (phase === 'failed') return bracketBar(failedBrailleBar(ticks, innerWidth, phaseElapsedMs, colors), colors);
  const displayTicks = phase === 'completed' ? completedDisplayTicks(ticks, innerWidth, phaseElapsedMs) : ticks;
  if (phase === 'cancelled') {
    const cancelledColor = phaseColorOverride ?? colors.warning;
    return bracketBar(
      accumulatedBrailleBar(displayTicks, innerWidth, cancelledColor, colors, () => cancelledColor),
      colors,
    );
  }
  const colorMap: Record<Exclude<AgentSwarmPhase, 'pending' | 'failed' | 'cancelled'>, string> = {
    queued: colors.textDim,
    suspended: colors.textDim,
    running: colors.success,
    completed: colors.success,
  };
  return bracketBar(accumulatedBrailleBar(displayTicks, innerWidth, colorMap[phase], colors), colors);
}

function cancelledProgressColor(
  member: AgentSwarmMember,
  phase: AgentSwarmPhase,
  colors: ColorPalette,
): string | undefined {
  if (phase !== 'cancelled') return undefined;
  return member.cancelledBarColor ?? colors.warning;
}

function bracketBar(content: string, colors: ColorPalette): string {
  const bracket = chalk.hex(colors.textMuted);
  return bracket('[') + content + bracket(']');
}

function phaseColor(phase: AgentSwarmPhase, colors: ColorPalette): string {
  const map: Record<AgentSwarmPhase, string> = {
    pending: colors.textDim,
    queued: colors.textDim,
    suspended: colors.textDim,
    running: colors.textDim,
    completed: colors.success,
    failed: colors.error,
    cancelled: colors.warning,
  };
  return map[phase];
}

interface StatusBarCount {
  readonly phase: StatusBarPhase;
  readonly count: number;
}

function renderStatusPipBar(
  members: readonly AgentSwarmMember[],
  width: number,
  colors: ColorPalette,
): string {
  const safeWidth = Math.max(1, width);
  const counts = statusBarCounts(members);
  return renderRendererSegmentedProgressBar({
    width: safeWidth,
    char: STATUS_BAR_CHAR,
    emptyStyle: (text) => chalk.hex(colors.textMuted)(text),
    segments: counts.map((entry) => ({
      value: entry.count,
      style: (text) => chalk.hex(statusBarColor(entry.phase, colors))(text),
    })),
  });
}

function renderStatusLabel(label: string, color: string): string {
  return ` ${chalk.hex(color)(label)}`;
}

function activityPrefixForTotalStatus(status: TotalStatus, colors: ColorPalette): string {
  const marks: Record<TotalStatus, string> = {
    completed: SUCCESS_MARK.trimEnd(),
    failed: FAILURE_MARK.trimEnd(),
    aborted: CANCELLED_MARK.trimEnd(),
    working: '',
    suspended: '',
  };
  const mark = marks[status];
  return mark.length > 0
    ? ` ${chalk.hex(totalStatusColor(status, colors))(mark)}`
    : ACTIVITY_SPINNER_PLACEHOLDER;
}

function statusBarCounts(members: readonly AgentSwarmMember[]): StatusBarCount[] {
  const counts = new Map<StatusBarPhase, number>();
  for (const member of members) {
    const phase = statusBarPhase(member.phase);
    counts.set(phase, (counts.get(phase) ?? 0) + 1);
  }
  return STATUS_BAR_ORDER.flatMap((phase) => {
    const count = counts.get(phase) ?? 0;
    return count > 0 ? [{ phase, count }] : [];
  });
}

function statusBarPhase(phase: AgentSwarmPhase): StatusBarPhase {
  const map: Record<AgentSwarmPhase, StatusBarPhase> = {
    pending: 'queued',
    queued: 'queued',
    suspended: 'suspended',
    running: 'working',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
  };
  return map[phase];
}

function statusBarColor(phase: StatusBarPhase, colors: ColorPalette): string {
  const map: Record<StatusBarPhase, string> = {
    queued: colors.textMuted,
    working: colors.primary,
    suspended: colors.textMuted,
    completed: colors.success,
    failed: colors.error,
    cancelled: colors.warning,
  };
  return map[phase];
}

function totalStatus(
  members: readonly AgentSwarmMember[],
  force: { readonly failed: boolean; readonly aborted: boolean },
): TotalStatus {
  if (force.aborted) return 'aborted';
  const phases = new Set(members.map((m) => m.phase));
  const hasActive = phases.has('pending') || phases.has('queued') || phases.has('suspended') || phases.has('running');
  if (!hasActive && members.length > 0) {
    if (phases.has('cancelled')) return 'aborted';
    if (phases.has('completed')) return 'completed';
    return 'failed';
  }
  if (force.failed) return 'failed';
  if (phases.has('suspended') && !phases.has('running')) return 'suspended';
  return 'working';
}

function isTerminalTotalStatus(status: TotalStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted';
}

function totalStatusLabel(status: TotalStatus): string {
  const map: Record<TotalStatus, string> = {
    working: WORKING_LABEL,
    completed: COMPLETED_LABEL,
    suspended: SUSPENDED_LABEL,
    failed: FAILED_LABEL,
    aborted: ABORTED_LABEL,
  };
  return map[status];
}

function totalStatusColor(status: TotalStatus, colors: ColorPalette): string {
  const map: Record<TotalStatus, string> = {
    working: colors.success,
    completed: colors.success,
    suspended: colors.textDim,
    failed: colors.error,
    aborted: colors.warning,
  };
  return map[status];
}

function totalStatusLabelColor(
  status: TotalStatus,
  members: readonly AgentSwarmMember[],
  colors: ColorPalette,
): string {
  if (status === 'working' && !members.some((member) => member.phase === 'completed')) {
    return colors.primary;
  }
  return totalStatusColor(status, colors);
}

function renderCellLabel(
  member: AgentSwarmMember,
  snapshot: AgentSwarmSnapshot,
  width: number,
  colors: ColorPalette,
): string {
  const latestLine = latestNonEmptyLine(snapshot.latestModelText);
  if (snapshot.phase === 'running') {
    return truncateWithColor(runningCellLabelText(member), width, colors.textDim);
  }
  if (snapshot.phase === 'failed' && member.failureText !== undefined) {
    return truncateWithColor(`${FAILURE_MARK}${member.failureText}`, width, colors.error);
  }
  if (snapshot.phase === 'completed') {
    return renderCompletedCellLabel(
      completedCellText(member, member.completedText ?? latestLine),
      width,
      colors,
    );
  }
  if (snapshot.phase === 'cancelled') {
    return renderCancelledCellLabel(member, width, colors);
  }
  return truncateWithColor(PHASE_LABELS[snapshot.phase], width, phaseColor(snapshot.phase, colors));
}

function runningCellLabelText(member: AgentSwarmMember): string {
  const latestLine = latestNonEmptyLine(member.latestModelText);
  const itemText = collapseWhitespace(member.itemText);
  const text = latestLine.length > 0 ? latestLine : itemText;
  return text.length > 0 ? text : PHASE_LABELS.running;
}

function ultraSwarmMemberLabel(metadata: UltraSwarmMemberMetadata): string {
  return metadata.emoji === undefined ? metadata.name : `${metadata.emoji} ${metadata.name}`;
}

function swarmMemberDisplayName(member: AgentSwarmMember): string {
  const metadata = member.ultraSwarm;
  if (metadata === undefined) return member.id;
  return metadata.emoji === undefined ? metadata.name : `${metadata.emoji} ${metadata.name}`;
}

function swarmCollaborationFeedTag(
  channel: SwarmCollaborationFeedMessage['channel'],
): SwarmOpsFeedTag {
  switch (channel) {
    case 'standup':
      return 'standup';
    case 'blocker':
      return 'block';
    case 'council':
      return 'council';
    default:
      return 'msg';
  }
}

function feedThreadKey(entry: SwarmOpsFeedEntry): string {
  return `${entry.fromExpertId ?? entry.fromName ?? ''}|${entry.toExpertId ?? ''}|${entry.tag}`;
}

function shortExpertName(name: string): string {
  const collapsed = collapseWhitespace(name);
  if (visibleWidth(collapsed) <= SWARM_FEED_SHORT_NAME_MAX) return collapsed;
  const firstToken = collapsed.split(' ')[0] ?? collapsed;
  if (visibleWidth(firstToken) <= SWARM_FEED_SHORT_NAME_MAX) return firstToken;
  return truncateToWidth(firstToken, SWARM_FEED_SHORT_NAME_MAX, '…');
}

function shortExpertId(expertId: string): string {
  const parts = expertId.split('-').filter((part) => part.length > 0);
  const candidate = parts.length >= 2 ? parts[parts.length - 2]! : parts[0] ?? expertId;
  if (visibleWidth(candidate) <= SWARM_FEED_SHORT_ID_MAX) return candidate;
  return truncateToWidth(candidate, SWARM_FEED_SHORT_ID_MAX, '…');
}

function stripAnsiText(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function isAgentConversationChannel(
  channel: SwarmCollaborationFeedMessage['channel'],
): boolean {
  return channel === 'direct' || channel === 'blocker' || channel === 'lane';
}

function isConversationFeedTag(tag: SwarmOpsFeedTag): boolean {
  return CONVERSATION_FEED_TAGS.has(tag);
}

function completedCellText(member: AgentSwarmMember, fallback: string): string {
  if (member.verdict === undefined) return fallback;
  const expert = member.ultraSwarm?.name === undefined ? '' : `${member.ultraSwarm.name}: `;
  return `${expert}${member.verdict}`;
}

function renderCancelledCellLabel(
  member: AgentSwarmMember,
  width: number,
  colors: ColorPalette,
): string {
  const labelText = member.cancelledLabelText ?? ABORTED_LABEL;
  const labelColor = member.cancelledLabelColor ?? colors.warning;
  const markColor = member.cancelledMarkColor ?? colors.warning;
  const labelStyle = chalk.hex(labelColor);
  return truncateToWidth(
    chalk.hex(markColor)(CANCELLED_MARK) + labelStyle(labelText),
    width,
    labelStyle('…'),
  );
}

function renderCompletedCellLabel(
  text: string,
  width: number,
  colors: ColorPalette,
): string {
  const finalText = normalizeFinalOutputText(text);
  const label = finalText === undefined ? SUCCESS_MARK.trimEnd() : `${SUCCESS_MARK}${finalText}`;
  return truncateWithColor(label, width, colors.success);
}

function compactTerminalMark(
  member: AgentSwarmMember,
  phase: AgentSwarmPhase,
  colors: ColorPalette,
): string {
  if (phase === 'completed') return chalk.hex(colors.success)(SUCCESS_MARK.trimEnd());
  if (phase === 'failed') return chalk.hex(colors.error)(FAILURE_MARK.trimEnd());
  if (phase === 'cancelled') {
    return chalk.hex(member.cancelledMarkColor ?? colors.warning)(CANCELLED_MARK.trimEnd());
  }
  return '';
}

function renderPendingCell(
  member: AgentSwarmMember,
  width: number,
  colors: ColorPalette,
): string {
  const id = chalk.hex(colors.primary)(member.id);
  const prefix = `${id} `;
  const itemText = collapseWhitespace(member.itemText);
  const label = itemText.length > 0 ? itemText : QUEUED_LABEL;
  const labelWidth = Math.max(1, width - visibleWidth(prefix));
  return prefix + truncateWithColor(label, labelWidth, colors.textDim);
}

function renderQueuedCell(
  member: AgentSwarmMember,
  width: number,
  colors: ColorPalette,
): string {
  const id = chalk.hex(colors.primary)(member.id);
  const prefix = `${id} `;
  const labelWidth = Math.max(1, width - visibleWidth(prefix));
  const itemText = collapseWhitespace(member.itemText);
  const label = member.ultraSwarm !== undefined && itemText.length > 0 ? itemText : QUEUED_LABEL;
  return prefix + truncateWithColor(label, labelWidth, colors.textDim);
}

function renderCancelledUnstartedCell(
  member: AgentSwarmMember,
  width: number,
  colors: ColorPalette,
): string {
  const id = chalk.hex(colors.primary)(member.id);
  const prefix = `${id} `;
  const labelWidth = Math.max(1, width - visibleWidth(prefix));
  return prefix + renderCancelledCellLabel(member, labelWidth, colors);
}

function truncateWithColor(text: string, width: number, color: string): string {
  const colorize = chalk.hex(color);
  return truncateToWidth(colorize(text), width, colorize('…'));
}

function truncateStartToWidth(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  const ellipsis = '…';
  const ellipsisWidth = visibleWidth(ellipsis);
  if (width <= ellipsisWidth) return truncateToWidth(ellipsis, width);

  const targetWidth = width - ellipsisWidth;
  const segments = Array.from(text);
  let tail = '';
  let tailWidth = 0;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index] ?? '';
    const segmentWidth = visibleWidth(segment);
    if (tailWidth + segmentWidth > targetWidth) break;
    tail = segment + tail;
    tailWidth += segmentWidth;
  }
  return ellipsis + tail;
}

function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function normalizeFailureText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const nestedFailureText = nestedAgentSwarmFailureText(text);
  const normalized = stripAgentSwarmPrefix(collapseWhitespace(nestedFailureText ?? text));
  return normalized.length > 0 ? normalized : undefined;
}

function nestedAgentSwarmFailureText(text: string): string | undefined {
  const xmlFailureText = nestedAgentSwarmXmlFailureText(text);
  if (xmlFailureText !== undefined) return nestedAgentSwarmFailureText(xmlFailureText) ?? xmlFailureText;

  if (!/^\s*agent_swarm:\s*failed\b/m.test(text)) return undefined;
  const match = /^\s*subagent error:\s*([\s\S]*?)(?=\n\[agent \d+\]\n|$)/m.exec(text);
  if (match === null) return undefined;
  const failureText = match[1];
  if (failureText === undefined) return undefined;
  return nestedAgentSwarmFailureText(failureText) ?? failureText;
}

function nestedAgentSwarmXmlFailureText(text: string): string | undefined {
  if (!/<agent_swarm_result\b/.test(text)) return undefined;
  const failed = parseAgentSwarmXmlResultStatuses(text).find((entry) => {
    return entry.status === 'failed' && entry.failureText !== undefined;
  });
  return failed?.failureText;
}

function stripAgentSwarmPrefix(text: string): string {
  return text.replace(/^agent_swarm:\s*(?:failed|completed)?\s*/i, '').trim();
}

function normalizeFinalOutputText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const normalized = collapseWhitespace(text);
  return normalized.length > 0 ? normalized : undefined;
}

function latestNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = collapseWhitespace(lines[index] ?? '');
    if (line.length > 0) return line;
  }
  return '';
}

function countPartialJsonObjectEntries(text: string, startIndex: number): number {
  let count = 0;
  let expectKey = true;
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '}') return count;
    if (ch === ',') {
      expectKey = true;
      continue;
    }
    if (ch !== '"') continue;

    const parsed = parsePartialJsonString(text, i + 1);
    if (expectKey) {
      if (parsed.closed || parsed.value.length > 0) count += 1;
      expectKey = false;
    }
    if (!parsed.closed) return count;
    i = parsed.nextIndex;
  }
  return count;
}

function parsePartialJsonString(
  text: string,
  startIndex: number,
): { value: string; closed: boolean; nextIndex: number } {
  let value = '';
  for (let i = startIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') return { value, closed: true, nextIndex: i };
    if (ch !== '\\') {
      value += ch;
      continue;
    }

    const escaped = text[i + 1];
    if (escaped === undefined) return { value, closed: false, nextIndex: i };
    switch (escaped) {
      case 'n': value += '\n'; break;
      case 't': value += '\t'; break;
      case 'r': value += '\r'; break;
      case 'b': value += '\b'; break;
      case 'f': value += '\f'; break;
      case '"':
      case '\\':
      case '/':
        value += escaped;
        break;
      case 'u': {
        const hex = text.slice(i + 2, i + 6);
        if (hex.length < 4) return { value, closed: false, nextIndex: i };
        const code = Number.parseInt(hex, 16);
        if (Number.isNaN(code)) return { value, closed: false, nextIndex: i };
        value += String.fromCodePoint(code);
        i += 4;
        break;
      }
      default:
        value += escaped;
    }
    i += 1;
  }
  return { value, closed: false, nextIndex: text.length };
}

function padAnsi(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  return truncated + ' '.repeat(Math.max(0, width - visibleWidth(truncated)));
}

function completedDisplayTicks(ticks: number, width: number, phaseElapsedMs: number): number {
  const fullBarTicks = width * RENDERER_BRAILLE_PROGRESS_LEVELS.length;
  if (ticks >= fullBarTicks) return fullBarTicks;
  const fillProgress = Math.max(0, Math.min(1, phaseElapsedMs / COMPLETE_FILL_MS));
  return Math.min(fullBarTicks, Math.ceil(ticks + (fullBarTicks - ticks) * fillProgress));
}

function failedBrailleBar(
  ticks: number,
  width: number,
  phaseElapsedMs: number,
  colors: ColorPalette,
): string {
  const redCellCount = Math.ceil(
    completedDisplayTicks(ticks, width, phaseElapsedMs) / RENDERER_BRAILLE_PROGRESS_LEVELS.length,
  );
  const placeholderColor = darkenRedHexColor(colors.error);
  return accumulatedBrailleBar(
    ticks,
    width,
    colors.error,
    colors,
    (cellIndex) => cellIndex < redCellCount ? placeholderColor : colors.textDim,
  );
}

function darkenRedHexColor(hex: string): string {
  return darkenHexColor(
    hex,
    FAILED_PLACEHOLDER_RED_FACTOR,
    FAILED_PLACEHOLDER_NON_RED_FACTOR,
    FAILED_PLACEHOLDER_NON_RED_FACTOR,
  );
}

function cancelledLabelColor(colors: ColorPalette): string {
  return darkenHexColor(colors.warning, CANCELLED_LABEL_DARKEN_FACTOR);
}

function darkenHexColor(
  hex: string,
  redFactor: number,
  greenFactor = redFactor,
  blueFactor = redFactor,
): string {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (match === null) return hex;
  const darken = (channel: string, factor: number): string =>
    Math.max(0, Math.min(255, Math.round(Number.parseInt(channel, 16) * factor)))
      .toString(16)
      .padStart(2, '0');
  return `#${darken(match[1]!, redFactor)}${darken(match[2]!, greenFactor)}${darken(
    match[3]!,
    blueFactor,
  )}`;
}

function accumulatedBrailleBar(
  ticks: number,
  width: number,
  filledColor: string,
  colors: ColorPalette,
  emptyColorForCell?: (cellIndex: number) => string,
): string {
  return renderRendererSteppedProgressBar({
    width,
    ticks,
    levels: RENDERER_BRAILLE_PROGRESS_LEVELS,
    emptyChar: RENDERER_BRAILLE_PROGRESS_EMPTY,
    separatorChar: RENDERER_BRAILLE_PROGRESS_SEPARATOR,
    styleForCell: (cell) => rendererBrailleCellStyle(cell, filledColor, colors, emptyColorForCell),
  });
}

function rendererBrailleCellStyle(
  cell: RendererSteppedProgressBarCellProjection,
  filledColor: string,
  colors: ColorPalette,
  emptyColorForCell: ((cellIndex: number) => string) | undefined,
): (text: string) => string {
  if (cell.filled) return (text) => chalk.hex(filledColor)(text);
  return (text) => chalk.hex(emptyColorForCell?.(cell.index) ?? colors.textDim)(text);
}

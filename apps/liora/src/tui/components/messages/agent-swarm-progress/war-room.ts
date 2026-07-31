import {
  collapseWhitespace,
  humanizeFeedBody,
  isAgentConversationChannel,
  swarmCollaborationFeedTag,
} from '#/tui/features/agent-swarm/agent-swarm-cell-render';
import {
  appendAgentSwarmConversationFeedEntry,
  appendAgentSwarmToolFeedEntry,
  rebuildAgentSwarmExpertSlotIndex,
} from '#/tui/features/agent-swarm/agent-swarm-feed-render';
import {
  collectAgentSwarmWarRoomHints,
  type WarRoomDebateTurn,
  type WarRoomFileLease,
} from '#/tui/features/agent-swarm/agent-swarm-header-render';
import { SWARM_OPS_FEED_MAX_ENTRIES } from '#/tui/features/agent-swarm/agent-swarm-progress-constants';
import type {
  AgentSwarmMember,
  AgentSwarmPauseRequest,
  AgentSwarmRestaffRequest,
  SwarmCollaborationFeedMessage,
  SwarmOpsFeedEntry,
  SwarmOpsFeedTag,
} from '#/tui/features/agent-swarm/agent-swarm-progress-types';
import {
  buildCouncilDecisionFeedDraft,
  buildSwarmPausedFeedDraft,
  buildSwarmRestaffingFeedDraft,
  trimAgentSwarmDebateReel,
} from '#/tui/features/agent-swarm/agent-swarm-war-room-feed';
import { resolveWarRoomReason } from '#/tui/features/agent-swarm/war-room-action';
import { findAgentSwarmMemberByAgentId, trackAgentSwarmMemberCodeWriteActivity } from '#/tui/features/agent-swarm/agent-swarm-member-state';

export interface AgentSwarmProgressWarRoomLayoutSlice {
  readonly debateReel: readonly WarRoomDebateTurn[];
  readonly feedEvidenceIds: ReadonlySet<string>;
  readonly feedPathHints: ReadonlySet<string>;
  readonly fileLeases: ReadonlyMap<string, WarRoomFileLease>;
  readonly opsFeed: readonly SwarmOpsFeedEntry[];
  readonly opsToolFeed: readonly SwarmOpsFeedEntry[];
  readonly showRawFeed: boolean;
  readonly expertSlotById: ReadonlyMap<string, string>;
  readonly swarmPaused: boolean;
  readonly swarmPausedReason: string | undefined;
  readonly swarmPausedPhase: string | undefined;
  readonly restaffing: boolean;
  readonly restaffingReason: string | undefined;
  readonly isUltraSwarm: boolean;
}

/**
 * UltraSwarm war-room state: ops feed, debate reel, file leases, and action
 * dock (pause/restaff/raw). Owned by `AgentSwarmProgressComponent` and wired
 * into layout render via {@link layoutSlice}.
 */
export class AgentSwarmProgressWarRoom {
  readonly opsFeed: SwarmOpsFeedEntry[] = [];
  readonly opsToolFeed: SwarmOpsFeedEntry[] = [];
  /** Dedupe collaboration feed lines even when message + mention both fire. */
  private readonly seenCollaborationMessageIds = new Set<string>();
  readonly expertSlotById = new Map<string, string>();
  /** Debate / steer turns for the war-room debate reel. */
  readonly debateReel: WarRoomDebateTurn[] = [];
  /** Soft file-lease claims reported by workers or lease events. */
  readonly fileLeases = new Map<string, WarRoomFileLease>();
  /** Evidence ids scraped from humanized collaboration bodies. */
  readonly feedEvidenceIds = new Set<string>();
  /** Path-like tokens scraped from humanized collaboration bodies. */
  readonly feedPathHints = new Set<string>();
  /** War-room action dock: swarm is paused for steering. */
  private swarmPaused = false;
  private swarmPausedReason: string | undefined;
  private swarmPausedPhase: string | undefined;
  /** War-room action dock: restaff in flight. */
  private restaffing = false;
  private restaffingReason: string | undefined;
  /** When true, feed shows raw protocol bodies for entries that have them. */
  private showRawFeed = false;

  constructor(
    private readonly title: string,
    private readonly requestRender: (() => void) | undefined,
    private readonly onRequestPause: ((request: AgentSwarmPauseRequest) => void) | undefined,
    private readonly onRequestRestaff: ((request: AgentSwarmRestaffRequest) => void) | undefined,
    private readonly getMembers: () => readonly AgentSwarmMember[],
  ) {}

  layoutSlice(): AgentSwarmProgressWarRoomLayoutSlice {
    return {
      debateReel: this.debateReel,
      feedEvidenceIds: this.feedEvidenceIds,
      feedPathHints: this.feedPathHints,
      fileLeases: this.fileLeases,
      opsFeed: this.opsFeed,
      opsToolFeed: this.opsToolFeed,
      showRawFeed: this.showRawFeed,
      expertSlotById: this.expertSlotById,
      swarmPaused: this.swarmPaused,
      swarmPausedReason: this.swarmPausedReason,
      swarmPausedPhase: this.swarmPausedPhase,
      restaffing: this.restaffing,
      restaffingReason: this.restaffingReason,
      isUltraSwarm: this.isUltraSwarmOpsFeedEnabled(),
    };
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

  /** Clear paused dock state after resume / redirect continues the run. */
  applySwarmResumed(): void {
    if (!this.swarmPaused) return;
    this.swarmPaused = false;
    this.swarmPausedReason = undefined;
    this.swarmPausedPhase = undefined;
    this.requestRender?.();
  }

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

  requestPause(input: AgentSwarmPauseRequest = {}): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const reason = resolveWarRoomReason(
      'pause',
      input.reason === undefined ? undefined : collapseWhitespace(input.reason),
    );
    this.onRequestPause?.({ reason, phase: input.phase });
    if (!this.swarmPaused) {
      this.applySwarmPaused({ reason, phase: input.phase });
    } else {
      this.requestRender?.();
    }
  }

  requestRestaff(input: AgentSwarmRestaffRequest = {}): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const reason = resolveWarRoomReason(
      'restaff',
      input.reason === undefined ? undefined : collapseWhitespace(input.reason),
    );
    this.onRequestRestaff?.({ reason, phase: input.phase });
    this.applySwarmRestaffing({ active: true, reason });
  }

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

  appendMemberToolFeed(input: {
    readonly agentId: string;
    readonly body: string;
    readonly isError?: boolean;
    readonly toolName?: string;
  }): void {
    if (!this.isUltraSwarmOpsFeedEnabled()) return;
    const member = findAgentSwarmMemberByAgentId(this.getMembers(), input.agentId);
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

  rebuildExpertSlotIndex(): void {
    this.expertSlotById.clear();
    for (const [expertId, slot] of rebuildAgentSwarmExpertSlotIndex(this.getMembers())) {
      this.expertSlotById.set(expertId, slot);
    }
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

  private isUltraSwarmOpsFeedEnabled(): boolean {
    return this.title === 'Fleet';
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
}

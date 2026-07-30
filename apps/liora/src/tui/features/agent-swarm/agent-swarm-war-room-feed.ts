import { collapseWhitespace } from '#/tui/features/agent-swarm/agent-swarm-cell-render';
import type { SwarmOpsFeedTag } from '#/tui/features/agent-swarm/agent-swarm-progress-types';
import type { WarRoomDebateTurn } from '#/tui/features/agent-swarm/agent-swarm-header-render';
import { WAR_ROOM_DEBATE_REEL_MAX } from '#/tui/features/agent-swarm/agent-swarm-progress-constants';

export interface AgentSwarmConversationFeedDraft {
  readonly tag: SwarmOpsFeedTag;
  readonly messageId?: string;
  readonly fromExpertId?: string;
  readonly fromName?: string;
  readonly fromEmoji?: string;
  readonly toExpertId?: string;
  readonly body: string;
  readonly rawBody?: string;
}

export function buildCouncilDecisionFeedDraft(input: {
  readonly decision: string;
  readonly reason?: string;
}): AgentSwarmConversationFeedDraft {
  const body = input.reason === undefined || input.reason.trim().length === 0
    ? `council ${input.decision}`
    : `council ${input.decision} · ${input.reason}`;
  return {
    tag: 'council',
    fromExpertId: 'council',
    fromName: 'Council',
    fromEmoji: '⚑',
    body,
  };
}

export function buildSwarmPausedFeedDraft(input: {
  readonly reason: string;
  readonly phase?: string;
}): {
  readonly feed: AgentSwarmConversationFeedDraft;
  readonly pausedReason: string;
  readonly pausedPhase: string | undefined;
} {
  const pausedReason = collapseWhitespace(input.reason);
  const pausedPhase = input.phase === undefined ? undefined : collapseWhitespace(input.phase);
  const phase = pausedPhase === undefined || pausedPhase.length === 0
    ? ''
    : ` @ ${pausedPhase}`;
  const reason =
    pausedReason.length === 0
      ? 'steering'
      : pausedReason;
  return {
    pausedReason,
    pausedPhase,
    feed: {
      tag: 'stop',
      fromExpertId: 'orchestrator',
      fromName: 'Orchestrator',
      fromEmoji: '⏸',
      body: `paused for steering${phase} · ${reason}`,
    },
  };
}

export function buildSwarmRestaffingFeedDraft(reason: string | undefined): AgentSwarmConversationFeedDraft {
  const normalizedReason = reason === undefined ? undefined : collapseWhitespace(reason);
  const displayReason =
    normalizedReason === undefined || normalizedReason.length === 0
      ? 'closing gaps'
      : normalizedReason;
  return {
    tag: 'staff',
    fromExpertId: 'orchestrator',
    fromName: 'Orchestrator',
    fromEmoji: '↻',
    body: `restaffing · ${displayReason}`,
  };
}

export function trimAgentSwarmDebateReel(
  debateReel: WarRoomDebateTurn[],
  maxStored = WAR_ROOM_DEBATE_REEL_MAX * 4,
): void {
  if (debateReel.length > maxStored) {
    debateReel.splice(0, debateReel.length - maxStored);
  }
}

export function buildWarRoomActionDockState(input: {
  readonly swarmPaused: boolean;
  readonly swarmPausedReason: string | undefined;
  readonly swarmPausedPhase: string | undefined;
  readonly restaffing: boolean;
  readonly restaffingReason: string | undefined;
  readonly showRawFeed: boolean;
}) {
  return {
    swarmPaused: input.swarmPaused,
    swarmPausedReason: input.swarmPausedReason,
    swarmPausedPhase: input.swarmPausedPhase,
    restaffing: input.restaffing,
    restaffingReason: input.restaffingReason,
    showRawFeed: input.showRawFeed,
  };
}

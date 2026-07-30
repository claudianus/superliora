import { truncateToWidth, visibleWidth } from '#/tui/renderer';
import { humanizeCollaborationEvent, looksLikeProtocolMessage } from '@superliora/sdk';

import type {
  AgentSwarmMember,
  SwarmCollaborationFeedMessage,
  SwarmOpsFeedEntry,
  SwarmOpsFeedTag,
  UltraSwarmMemberMetadata,
  WarRoomDebatePhase,
} from '#/tui/components/messages/agent-swarm-progress/index';

import { collapseWhitespace } from '#/tui/features/agent-swarm/agent-swarm-cell-text';

const SWARM_FEED_SHORT_NAME_MAX = 6;
const SWARM_FEED_SHORT_ID_MAX = 6;

const CONVERSATION_FEED_TAGS = new Set<SwarmOpsFeedTag>([
  'msg',
  'mention',
  'block',
  'council',
  // War-room dock / orchestrator signals (pause, restaff).
  'stop',
  'staff',
]);

export function ultraSwarmMemberLabel(metadata: UltraSwarmMemberMetadata): string {
  return metadata.emoji === undefined ? metadata.name : `${metadata.emoji} ${metadata.name}`;
}

export function swarmMemberDisplayName(member: AgentSwarmMember): string {
  const metadata = member.ultraSwarm;
  if (metadata === undefined) return member.id;
  return metadata.emoji === undefined ? metadata.name : `${metadata.emoji} ${metadata.name}`;
}

export function swarmCollaborationFeedTag(
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

export function feedThreadKey(entry: SwarmOpsFeedEntry): string {
  return `${entry.fromExpertId ?? entry.fromName ?? ''}|${entry.toExpertId ?? ''}|${entry.tag}`;
}

export function shortExpertName(name: string): string {
  const collapsed = collapseWhitespace(name);
  if (visibleWidth(collapsed) <= SWARM_FEED_SHORT_NAME_MAX) return collapsed;
  const firstToken = collapsed.split(' ')[0] ?? collapsed;
  if (visibleWidth(firstToken) <= SWARM_FEED_SHORT_NAME_MAX) return firstToken;
  return truncateToWidth(firstToken, SWARM_FEED_SHORT_NAME_MAX, '…');
}

export function formatDebatePhaseLabel(phase: WarRoomDebatePhase): string {
  switch (phase) {
    case 'counter-critique':
      return 'counter-critique';
    case 'critic':
    case 'rebuttal':
    case 'consensus':
    case 'steer':
      return phase;
  }
}

export function shortExpertId(expertId: string): string {
  const parts = expertId.split('-').filter((part) => part.length > 0);
  const candidate = parts.length >= 2 ? parts[parts.length - 2]! : parts[0] ?? expertId;
  if (visibleWidth(candidate) <= SWARM_FEED_SHORT_ID_MAX) return candidate;
  return truncateToWidth(candidate, SWARM_FEED_SHORT_ID_MAX, '…');
}

export function stripAnsiText(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

export function isAgentConversationChannel(
  channel: SwarmCollaborationFeedMessage['channel'],
): boolean {
  return channel === 'direct' || channel === 'blocker' || channel === 'lane';
}

export function isConversationFeedTag(tag: SwarmOpsFeedTag): boolean {
  return CONVERSATION_FEED_TAGS.has(tag);
}

/**
 * Protocol/XML collaboration payloads become a short human-readable feed line.
 * Plain language messages pass through unchanged.
 */
export function humanizeFeedBody(
  body: string,
  meta: {
    readonly channel?: string;
    readonly tag?: string;
    readonly fromName?: string;
    readonly fromExpertId?: string;
    readonly toExpertId?: string;
  },
): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return trimmed;
  if (!looksLikeProtocolMessage(trimmed)) return collapseWhitespace(trimmed);

  const humanized = humanizeCollaborationEvent({
    body: trimmed,
    channel: meta.channel,
    tag: meta.tag,
    fromName: meta.fromName,
    fromExpertId: meta.fromExpertId,
    toExpertId: meta.toExpertId,
  });
  if (!humanized.humanized) return collapseWhitespace(trimmed);

  const headline = humanized.headline.trim();
  const text = humanized.body.trim();
  if (headline.length === 0) return text;
  if (text.length === 0) return headline;
  if (text.startsWith(headline)) return text;
  return collapseWhitespace(`${headline}: ${text}`);
}

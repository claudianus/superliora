import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import type { AgentSwarmProgressEstimator } from '#/tui/components/messages/agent-swarm-progress/estimator';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  renderAgentSwarmOpsFeedContent,
  renderAgentSwarmOpsFeedSection,
  renderAgentSwarmToolFeedSection,
  type SwarmFeedRenderContext,
} from '#/tui/features/agent-swarm/agent-swarm-feed-render';
import { renderAgentSwarmGrid } from '#/tui/features/agent-swarm/agent-swarm-grid-render';
import {
  collectAgentSwarmEvidenceWallIds,
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
  type WarRoomDebateTurn,
  type WarRoomFileLease,
} from '#/tui/features/agent-swarm/agent-swarm-header-render';
import {
  renderUltraSwarmWarRoomPanel,
  ultraSwarmFeedRenderLineLimit,
} from '#/tui/features/agent-swarm/agent-swarm-paint-orchestration';
import {
  AGENT_SWARM_LEFT_INDENT,
  AGENT_SWARM_RIGHT_GAP,
} from '#/tui/features/agent-swarm/agent-swarm-progress-constants';
import type {
  AgentSwarmMember,
  AgentSwarmSnapshot,
  AgentSwarmSummary,
  SwarmOpsFeedEntry,
} from '#/tui/features/agent-swarm/agent-swarm-progress-types';
import type { UltraSwarmIntegrationReport } from '#/tui/features/agent-swarm/agent-swarm-result-parser';
import {
  renderAgentSwarmStatusLine,
  type SwarmStatusLineContext,
} from '#/tui/features/agent-swarm/agent-swarm-status-line-render';
import { buildWarRoomActionDockState } from '#/tui/features/agent-swarm/agent-swarm-war-room-feed';

export interface AgentSwarmProgressLayoutRenderInput {
  readonly title: string;
  readonly description: string;
  readonly routingBadge: string | undefined;
  readonly colors: ColorPalette;
  readonly members: readonly AgentSwarmMember[];
  readonly integrationReport: UltraSwarmIntegrationReport | undefined;
  readonly debateReel: readonly WarRoomDebateTurn[];
  readonly feedEvidenceIds: ReadonlySet<string>;
  readonly feedPathHints: ReadonlySet<string>;
  readonly fileLeases: ReadonlyMap<string, WarRoomFileLease>;
  readonly opsFeed: readonly SwarmOpsFeedEntry[];
  readonly opsToolFeed: readonly SwarmOpsFeedEntry[];
  readonly showRawFeed: boolean;
  readonly expertSlotById: ReadonlyMap<string, string>;
  readonly failed: boolean;
  readonly aborted: boolean;
  readonly toolCallActive: boolean;
  readonly activitySpinnerText: (() => string) | undefined;
  readonly swarmStartedAtMs: number | undefined;
  readonly inputComplete: boolean;
  readonly itemsStarted: boolean;
  readonly promptTemplateText: string;
  readonly swarmPaused: boolean;
  readonly swarmPausedReason: string | undefined;
  readonly swarmPausedPhase: string | undefined;
  readonly restaffing: boolean;
  readonly restaffingReason: string | undefined;
  readonly isUltraSwarm: boolean;
  readonly availableGridHeight: number | undefined;
  readonly progressEstimator: AgentSwarmProgressEstimator;
}

function feedRenderContext(input: AgentSwarmProgressLayoutRenderInput): SwarmFeedRenderContext {
  return {
    colors: input.colors,
    showRawFeed: input.showRawFeed,
    expertSlotById: input.expertSlotById,
    members: input.members,
  };
}

function statusLineContext(input: AgentSwarmProgressLayoutRenderInput): SwarmStatusLineContext {
  return {
    members: input.members,
    failed: input.failed,
    aborted: input.aborted,
    toolCallActive: input.toolCallActive,
    activitySpinnerText: input.activitySpinnerText,
    swarmStartedAtMs: input.swarmStartedAtMs,
    inputComplete: input.inputComplete,
    itemsStarted: input.itemsStarted,
    promptTemplateText: input.promptTemplateText,
    colors: input.colors,
  };
}

function isWarRoomActive(input: AgentSwarmProgressLayoutRenderInput): boolean {
  return isAgentSwarmWarRoomActive({
    members: input.members,
    opsFeedLength: input.opsFeed.length,
    opsToolFeedLength: input.opsToolFeed.length,
    debateReelLength: input.debateReel.length,
    fileLeaseCount: input.fileLeases.size,
    itemsStarted: input.itemsStarted,
  });
}

function renderGrid(
  input: AgentSwarmProgressLayoutRenderInput,
  width: number,
  members: readonly AgentSwarmMember[],
  snapshots: readonly AgentSwarmSnapshot[],
  nowMs: number,
): string[] {
  return renderAgentSwarmGrid({
    width,
    height: input.availableGridHeight,
    members,
    snapshots,
    nowMs,
    colors: input.colors,
    estimate: (estimateInput) => input.progressEstimator.estimate(estimateInput),
  });
}

function renderMissionContent(
  input: AgentSwarmProgressLayoutRenderInput,
  width: number,
  summary: AgentSwarmSummary | undefined,
): string[] {
  return renderAgentSwarmMissionContent(width, {
    title: input.title,
    description: input.description,
    routingBadge: input.routingBadge,
    summary,
    members: input.members,
    colors: input.colors,
  });
}

function renderUltraSwarmLayout(
  input: AgentSwarmProgressLayoutRenderInput,
  width: number,
  summary: AgentSwarmSummary,
  members: readonly AgentSwarmMember[],
  snapshots: readonly AgentSwarmSnapshot[],
  nowMs: number,
): string[] {
  const profile = resolveResponsiveLayout({ width });
  return renderUltraSwarmWarRoomPanel(width, profile, input.colors, {
    missionContent: renderMissionContent(input, width, summary),
    teamContent: renderGrid(input, width, members, snapshots, nowMs),
    activityContent: renderAgentSwarmChildActivitySection(width, input.members, input.colors),
    reportContent: renderAgentSwarmIntegrationReportContent(width, input.integrationReport, input.colors),
    debateContent: renderAgentSwarmDebateReelContent(width, profile, input.debateReel, input.colors),
    evidenceContent: renderAgentSwarmEvidenceWallContent(
      width,
      collectAgentSwarmEvidenceWallIds(input.members, input.feedEvidenceIds, input.feedPathHints),
      input.colors,
    ),
    fileMapContent: renderAgentSwarmFileMapContent(width, input.fileLeases, input.colors, isWarRoomActive(input)),
    feedContent: renderAgentSwarmOpsFeedContent(
      input.opsFeed,
      width,
      ultraSwarmFeedRenderLineLimit(profile),
      false,
      profile,
      feedRenderContext(input),
    ),
    toolFeedContent: renderAgentSwarmToolFeedSection(width, input.opsToolFeed, feedRenderContext(input)),
    actionDock: renderAgentSwarmActionDockHint(width, buildWarRoomActionDockState({
      swarmPaused: input.swarmPaused,
      swarmPausedReason: input.swarmPausedReason,
      swarmPausedPhase: input.swarmPausedPhase,
      restaffing: input.restaffing,
      restaffingReason: input.restaffingReason,
      showRawFeed: input.showRawFeed,
    }), input.colors),
    statusFooter: ['', renderAgentSwarmStatusLine(width, statusLineContext(input)), ''],
  });
}

export function renderAgentSwarmEmptyLayout(
  input: AgentSwarmProgressLayoutRenderInput,
  width: number,
  summary: AgentSwarmSummary,
  nowMs: number,
): string[] {
  if (input.isUltraSwarm) {
    return renderUltraSwarmLayout(input, width, summary, [], [], nowMs);
  }
  return [
    '',
    ...renderAgentSwarmHeaderLines(width, input.title, input.description, input.colors),
    '',
    renderAgentSwarmStatusLine(width, statusLineContext(input)),
    '',
  ];
}

export function renderAgentSwarmProgressLayout(
  input: AgentSwarmProgressLayoutRenderInput,
  width: number,
  summary: AgentSwarmSummary,
  sortedMembers: readonly AgentSwarmMember[],
  sortedSnapshots: readonly AgentSwarmSnapshot[],
  nowMs: number,
): string[] {
  if (input.members.length === 0) {
    return renderAgentSwarmEmptyLayout(input, width, summary, nowMs);
  }
  if (input.isUltraSwarm) {
    return renderUltraSwarmLayout(input, width, summary, sortedMembers, sortedSnapshots, nowMs);
  }
  const headerLines = renderAgentSwarmHeaderLines(width, input.title, input.description, input.colors);
  const statusLine = renderAgentSwarmStatusLine(width, statusLineContext(input));
  return [
    '',
    ...headerLines,
    '',
    statusLine,
    '',
    ...renderGrid(input, width, sortedMembers, sortedSnapshots, nowMs),
    ...renderAgentSwarmChildActivitySection(width, input.members, input.colors),
    ...renderAgentSwarmMemberTodoSection(width, input.members, input.colors),
    ...(input.isUltraSwarm
      ? renderAgentSwarmOpsFeedSection(width, input.opsFeed, feedRenderContext(input))
      : []),
    '',
    '',
  ];
}

export function indentAgentSwarmProgressLines(lines: readonly string[], width: number): string[] {
  return indentAgentSwarmLines(lines, width, AGENT_SWARM_LEFT_INDENT, AGENT_SWARM_RIGHT_GAP);
}

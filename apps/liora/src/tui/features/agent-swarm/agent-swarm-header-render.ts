import {
  renderRendererDividerRow,
  renderRendererLabeledDividerRow,
  truncateToWidth,
  visibleWidth,
} from '#/tui/renderer';
import chalk from 'chalk';

import type {
  AgentSwarmMember,
  AgentSwarmSummary,
  WarRoomDebatePhase,
} from '#/tui/components/messages/agent-swarm-progress';
import { formatSwarmMemberTodoLines } from '#/tui/components/chrome/todo-panel';
import type { ResponsiveLayoutProfile } from '#/tui/controllers/responsive-layout';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  collapseWhitespace,
  formatDebatePhaseLabel,
  latestNonEmptyLine,
  shortExpertName,
  swarmMemberDisplayName,
  truncateWithColor,
} from '#/tui/features/agent-swarm/agent-swarm-cell-render';
import { renderAnimatedGradientText } from '#/tui/features/appearance/appearance-effects';
import type { UltraSwarmIntegrationReport } from '#/tui/features/agent-swarm/agent-swarm-result-parser';

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
/** Max per-child activity lines shown under the swarm grid before collapsing. */
const MAX_CHILD_ACTIVITY_LINES = 6;

export interface WarRoomDebateTurn {
  readonly atMs: number;
  readonly phase: WarRoomDebatePhase;
  readonly expertName?: string;
  readonly headline: string;
  readonly debateId?: string;
}

export interface WarRoomFileLease {
  readonly path: string;
  readonly owner: string;
  readonly atMs: number;
}

export interface WarRoomActionDockState {
  readonly swarmPaused: boolean;
  readonly swarmPausedReason?: string;
  readonly swarmPausedPhase?: string;
  readonly restaffing: boolean;
  readonly restaffingReason?: string;
  readonly showRawFeed: boolean;
}

function renderMissionStats(summary: AgentSwarmSummary, members: readonly AgentSwarmMember[]): string {
  const total = summary.active + summary.completed + summary.failed + summary.cancelled;
  const running = members.filter((member) => member.phase === 'running').length;
  const evidenceCount = members.reduce(
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

export function renderAgentSwarmMissionContent(
  width: number,
  input: {
    readonly title: string;
    readonly description: string;
    readonly routingBadge: string | undefined;
    readonly summary: AgentSwarmSummary | undefined;
    readonly members: readonly AgentSwarmMember[];
    readonly colors: ColorPalette;
  },
): string[] {
  const { title, description, routingBadge, summary, members, colors } = input;
  const gradientTitle = renderAnimatedGradientText(title, `agent-swarm:title:${title}`);
  const renderedDescription = description.length > 0
    ? chalk.hex(colors.text)(description)
    : '';
  const stats = summary === undefined ? '' : renderMissionStats(summary, members);
  const headlineParts = [gradientTitle];
  if (routingBadge !== undefined) {
    headlineParts.push(`${chalk.hex(colors.textDim)('·')} ${chalk.hex(colors.primary)(routingBadge)}`);
  }
  if (renderedDescription.length > 0) {
    headlineParts.push(`${chalk.hex(colors.textDim)('·')} ${renderedDescription}`);
  }
  if (stats.length > 0) headlineParts.push(`${chalk.hex(colors.textDim)('·')} ${stats}`);
  return [truncateToWidth(headlineParts.join(' '), width)];
}

export function renderAgentSwarmIntegrationReportContent(
  width: number,
  report: UltraSwarmIntegrationReport | undefined,
  colors: ColorPalette,
): string[] {
  if (report === undefined) return [];

  const lines: string[] = [chalk.hex(colors.textDim)('integration report')];
  if (report.headline.length > 0) {
    lines.push(chalk.hex(colors.textDim)(truncateToWidth(report.headline, width)));
  }

  for (const agent of report.agents) {
    const emojiPrefix = agent.emoji === undefined || agent.emoji.length === 0 ? '' : `${agent.emoji} `;
    const header = `${emojiPrefix}${agent.name} · ${agent.phase} · ${agent.verdict}`;
    lines.push(chalk.hex(colors.text)(truncateToWidth(header, width)));
    const detail = agent.summary ?? agent.findings ?? agent.risksAndGaps;
    if (detail !== undefined && detail.length > 0) {
      lines.push(chalk.hex(colors.textDim)(truncateToWidth(`  ${detail}`, width)));
    }
  }

  if (report.openGaps !== undefined && report.openGaps.length > 0) {
    lines.push(chalk.hex(colors.textDim)(truncateToWidth('open gaps', width)));
    for (const gapLine of report.openGaps.split('\n')) {
      const trimmed = gapLine.trim();
      if (trimmed.length === 0) continue;
      lines.push(chalk.hex(colors.textDim)(truncateToWidth(`  ${trimmed}`, width)));
    }
  }

  return lines;
}

export function renderAgentSwarmDebateReelContent(
  width: number,
  profile: ResponsiveLayoutProfile,
  debateReel: readonly WarRoomDebateTurn[],
  colors: ColorPalette,
): string[] {
  if (debateReel.length === 0) return [];
  const limit = profile === 'tiny' ? WAR_ROOM_DEBATE_REEL_MAX_TINY : WAR_ROOM_DEBATE_REEL_MAX;
  const turns = debateReel.slice(-limit);
  const lines: string[] = [chalk.hex(colors.textDim)('debate reel')];
  for (const turn of turns) {
    const phaseLabel = formatDebatePhaseLabel(turn.phase);
    const line = `debate · ${phaseLabel}: ${turn.headline}`;
    lines.push(chalk.hex(colors.text)(truncateToWidth(line, width)));
  }
  return lines;
}

export function collectAgentSwarmEvidenceWallIds(
  members: readonly AgentSwarmMember[],
  feedEvidenceIds: ReadonlySet<string>,
  feedPathHints: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (raw: string): void => {
    const id = collapseWhitespace(raw);
    if (id.length === 0 || seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };
  for (const member of members) {
    for (const id of member.evidenceIds ?? []) push(id);
  }
  for (const id of feedEvidenceIds) push(id);
  // Path hints from humanized feed bodies surface as soft evidence chips.
  for (const path of feedPathHints) push(path);
  return ordered.slice(0, WAR_ROOM_EVIDENCE_WALL_MAX);
}

export function renderAgentSwarmEvidenceWallContent(
  width: number,
  ids: readonly string[],
  colors: ColorPalette,
): string[] {
  if (ids.length === 0) return [];
  const lines: string[] = [chalk.hex(colors.textDim)('evidence wall')];
  for (const id of ids) {
    lines.push(chalk.hex(colors.text)(truncateToWidth(`evidence · ${id}`, width)));
  }
  return lines;
}

export function collectAgentSwarmWarRoomHints(
  text: string,
): { readonly evidenceIds: readonly string[]; readonly pathHints: readonly string[] } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { evidenceIds: [], pathHints: [] };
  const evidenceIds: string[] = [];
  for (const match of trimmed.matchAll(WAR_ROOM_EVIDENCE_ID_TOKEN)) {
    const id = match[0]?.trim();
    if (id !== undefined && id.length > 0) evidenceIds.push(id);
  }
  const pathHints: string[] = [];
  for (const match of trimmed.matchAll(WAR_ROOM_PATH_TOKEN)) {
    const path = match[1]?.trim();
    if (path !== undefined && path.length > 0) pathHints.push(path);
  }
  return { evidenceIds, pathHints };
}

export function renderAgentSwarmFileMapContent(
  width: number,
  fileLeases: ReadonlyMap<string, WarRoomFileLease>,
  colors: ColorPalette,
  isWarRoomActive: boolean,
): string[] {
  const leases = Array.from(fileLeases.values())
    .sort((a, b) => a.atMs - b.atMs)
    .slice(-WAR_ROOM_FILE_MAP_MAX);
  if (leases.length === 0) {
    // Empty state only when swarm is active (team staffed or feed/ops live).
    if (!isWarRoomActive) return [];
    return [
      chalk.hex(colors.textDim)(truncateToWidth('file map · no leases yet', width)),
    ];
  }
  const lines: string[] = [chalk.hex(colors.textDim)('file map')];
  for (const lease of leases) {
    const owner = shortExpertName(lease.owner);
    const line = `file · ${lease.path} @ ${owner}`;
    lines.push(chalk.hex(colors.text)(truncateToWidth(line, width)));
  }
  return lines;
}

export function isAgentSwarmWarRoomActive(input: {
  readonly members: readonly AgentSwarmMember[];
  readonly opsFeedLength: number;
  readonly opsToolFeedLength: number;
  readonly debateReelLength: number;
  readonly fileLeaseCount: number;
  readonly itemsStarted: boolean;
}): boolean {
  if (input.members.some((member) => member.ultraSwarm !== undefined)) return true;
  if (input.opsFeedLength > 0) return true;
  if (input.opsToolFeedLength > 0) return true;
  if (input.debateReelLength > 0) return true;
  if (input.fileLeaseCount > 0) return true;
  if (input.itemsStarted) return true;
  return false;
}

function formatActionDockLine(state: WarRoomActionDockState): string {
  const pauseLabel = state.swarmPaused ? 'resume' : 'pause';
  const restaffLabel = state.restaffing ? 'restaff…' : 'restaff';
  const rawLabel = state.showRawFeed ? 'raw · on' : 'raw';
  return `actions · ${pauseLabel} · ${restaffLabel} · ${rawLabel}`;
}

function formatActionDockStatusLine(state: WarRoomActionDockState): string | undefined {
  const parts: string[] = [];
  if (state.swarmPaused) {
    const reason =
      state.swarmPausedReason === undefined || state.swarmPausedReason.length === 0
        ? 'steering'
        : state.swarmPausedReason;
    const phase =
      state.swarmPausedPhase === undefined || state.swarmPausedPhase.length === 0
        ? ''
        : ` @ ${state.swarmPausedPhase}`;
    parts.push(`paused${phase} · ${reason}`);
  }
  if (state.restaffing) {
    const reason =
      state.restaffingReason === undefined || state.restaffingReason.length === 0
        ? 'closing gaps'
        : state.restaffingReason;
    parts.push(`restaffing · ${reason}`);
  }
  if (state.showRawFeed) {
    parts.push('feed · raw protocol');
  }
  if (parts.length === 0) return undefined;
  return `status · ${parts.join(' · ')}`;
}

export function renderAgentSwarmActionDockHint(
  width: number,
  state: WarRoomActionDockState,
  colors: ColorPalette,
): string[] {
  const lines: string[] = [
    chalk.hex(colors.textDim)(truncateToWidth(formatActionDockLine(state), width)),
  ];
  const status = formatActionDockStatusLine(state);
  if (status !== undefined) {
    lines.push(chalk.hex(colors.warning)(truncateToWidth(status, width)));
  }
  return lines;
}

/**
 * One dim line per running child with its latest observable activity: the
 * in-flight tool call while one is pending, otherwise the most recent
 * assistant text snippet. Only running members with something to show are
 * listed, so the section settles to nothing once the swarm finishes.
 */
export function renderAgentSwarmChildActivitySection(
  width: number,
  members: readonly AgentSwarmMember[],
  colors: ColorPalette,
): string[] {
  const entries: string[] = [];
  for (const member of members) {
    if (member.phase !== 'running') continue;
    const activity = member.activeToolName !== undefined
      ? `using ${member.activeToolName}`
      : collapseWhitespace(latestNonEmptyLine(member.latestModelText));
    if (activity.length === 0) continue;
    entries.push(`${swarmMemberDisplayName(member)}: ${activity}`);
  }
  if (entries.length === 0) return [];
  const dim = colors.textDim;
  const lines = entries
    .slice(0, MAX_CHILD_ACTIVITY_LINES)
    .map((entry) => truncateWithColor(entry, width, dim));
  if (entries.length > MAX_CHILD_ACTIVITY_LINES) {
    const hidden = entries.length - MAX_CHILD_ACTIVITY_LINES;
    lines.push(truncateWithColor(`… +${String(hidden)} more`, width, dim));
  }
  return lines;
}

/** Classic (non-UltraSwarm) header divider: gradient title + optional description. */
export function renderAgentSwarmHeaderLines(
  width: number,
  title: string,
  description: string,
  colors: ColorPalette,
): string[] {
  const dividerStyle = (text: string): string => chalk.hex(colors.primary)(text);
  if (width <= 3) {
    return [renderRendererDividerRow({ width, style: dividerStyle })];
  }

  const gradientTitle = renderAnimatedGradientText(title, `agent-swarm:title:${title}`);
  const renderedDescription = description.length > 0
    ? chalk.hex(colors.primary)(` ${renderRendererDividerRow({ width: 1 })} `) +
      chalk.hex(colors.text)(description)
    : '';
  return [
    renderRendererLabeledDividerRow({
      width,
      label: gradientTitle + renderedDescription,
      dividerStyle,
    }),
  ];
}

/** Per-member todo checklist section shown below the classic grid. */
export function renderAgentSwarmMemberTodoSection(
  width: number,
  members: readonly AgentSwarmMember[],
  colors: ColorPalette,
): string[] {
  const lines: string[] = [];
  for (const member of members) {
    if (member.todos.length === 0) continue;
    const memberLines = formatSwarmMemberTodoLines(
      member.todos,
      width,
      colors,
      swarmMemberDisplayName(member),
    );
    if (memberLines.length === 0) continue;
    lines.push(chalk.hex(colors.textDim)(swarmMemberDisplayName(member)));
    lines.push(...memberLines);
  }
  return lines;
}

/** Left-indents and right-trims every rendered line to the outer panel width. */
export function indentAgentSwarmLines(
  lines: readonly string[],
  width: number,
  leftIndent: string,
  rightGap: number,
): string[] {
  const contentWidth = Math.max(0, width - visibleWidth(leftIndent) - rightGap);
  return lines.map((line) =>
    truncateToWidth(leftIndent + truncateToWidth(line, contentWidth), width)
  );
}

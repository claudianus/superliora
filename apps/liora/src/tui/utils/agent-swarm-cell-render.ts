import {
  RENDERER_BRAILLE_PROGRESS_EMPTY,
  RENDERER_BRAILLE_PROGRESS_LEVELS,
  RENDERER_BRAILLE_PROGRESS_SEPARATOR,
  renderRendererSegmentedProgressBar,
  renderRendererSteppedProgressBar,
  truncateToWidth,
  visibleWidth,
  type RendererSteppedProgressBarCellProjection,
} from '#/tui/renderer';
import chalk from 'chalk';
import { humanizeCollaborationEvent, looksLikeProtocolMessage } from '@superliora/sdk';

import type { AgentSwarmProgressEstimatorPhase as AgentSwarmPhase } from '#/tui/components/messages/agent-swarm-progress-estimator';
import type {
  AgentSwarmMember,
  AgentSwarmSnapshot,
  AgentSwarmSummary,
  SwarmCollaborationFeedMessage,
  SwarmOpsFeedEntry,
  SwarmOpsFeedTag,
  TotalStatus,
  UltraSwarmMemberMetadata,
  WarRoomDebatePhase,
} from '#/tui/components/messages/agent-swarm-progress';
import { FAILURE_MARK, SUCCESS_MARK } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  getActiveAppearancePreferences,
  renderPulseGlyph,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';

export const ORCHESTRATING_LABEL = 'Orchestrating...';
export const PROMPTING_LABEL = 'Prompting...';
const WORKING_LABEL = 'Working...';
const COMPLETED_LABEL = 'Completed.';
const FAILED_LABEL = 'Failed.';
export const ABORTED_LABEL = 'Aborted.';
export const CANCELLED_LABEL = 'Cancelled.';
const QUEUED_LABEL = 'Queued...';
const SUSPENDED_LABEL = 'Rate limited...';
const CANCELLED_LABEL_DARKEN_FACTOR = 0.72;

/** Pulse glyph cycle prefixed to running grid cells. */
const RUNNING_CELL_PULSE_GLYPHS = ['●', '◆', '✦', '◆'];
const RUNNING_CELL_PULSE_FALLBACK = '●';
/**
 * Code-write pulse (Phase 5-A): appended to running cells whose latest tool
 * activity is Write/Edit so parallel code writing is visible at a glance.
 */
const CODE_WRITE_PULSE_GLYPHS = ['✎', '✐', '✎', '✐'];
const CODE_WRITE_PULSE_FALLBACK = '✎';
/** Quiet window after the last write tool before the ✎ pulse fades. */
export const CODE_WRITE_QUIET_MS = 4_000;
const CODE_WRITE_TOOL_NAMES = new Set(['write', 'edit']);
const CODE_WRITE_BODY_TOKEN = /^(?:write|edit)\b/i;
/** Max visible width of the per-cell model alias badge (` · <alias>`). */
const MODEL_ALIAS_BADGE_MAX_WIDTH = 16;
/** How long the completed/failed fill animation runs before settling. */
export const COMPLETE_FILL_MS = 360;
const FAILED_PLACEHOLDER_RED_FACTOR = 0.75;
const FAILED_PLACEHOLDER_NON_RED_FACTOR = 0.25;
const STATUS_BAR_CHAR = '━';
const CANCELLED_MARK = '⊘ ';
export const ACTIVITY_SPINNER_PLACEHOLDER = '  ';
const SWARM_FEED_SHORT_NAME_MAX = 6;
const SWARM_FEED_SHORT_ID_MAX = 6;

const STATUS_BAR_ORDER = [
  'completed',
  'working',
  'suspended',
  'queued',
  'cancelled',
  'failed',
] as const;
type StatusBarPhase = typeof STATUS_BAR_ORDER[number];

const CONVERSATION_FEED_TAGS = new Set<SwarmOpsFeedTag>([
  'msg',
  'mention',
  'block',
  'council',
  // War-room dock / orchestrator signals (pause, restaff).
  'stop',
  'staff',
]);

const PHASE_LABELS: Record<AgentSwarmPhase, string> = {
  pending: QUEUED_LABEL,
  queued: QUEUED_LABEL,
  suspended: SUSPENDED_LABEL,
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: ABORTED_LABEL,
};

interface StatusBarCount {
  readonly phase: StatusBarPhase;
  readonly count: number;
}

export function isTerminalPhase(phase: AgentSwarmPhase): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled';
}

export function summarizeSnapshots(snapshots: readonly AgentSwarmSnapshot[]): AgentSwarmSummary {
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

export function brailleBar(
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

export function cancelledProgressColor(
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

export function renderStatusPipBar(
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

/**
 * Status label with premium motion (PREMIUM.md §7.2): active states
 * (Working…/Orchestrating…/Prompting…) pulse on the shared animation clock;
 * terminal states stay static. Falls back to plain themed text when motion
 * is unavailable.
 */
export function renderStatusLabel(label: string, token: ColorToken, active: boolean, seed: string): string {
  const styled = active
    ? renderPulseText(label, seed, token)
    : currentTheme.fg(token, label);
  return ` ${styled}`;
}

export function activityPrefixForTotalStatus(status: TotalStatus, colors: ColorPalette): string {
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

export function totalStatus(
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

export function isTerminalTotalStatus(status: TotalStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'aborted';
}

export function totalStatusLabel(status: TotalStatus): string {
  const map: Record<TotalStatus, string> = {
    working: WORKING_LABEL,
    completed: COMPLETED_LABEL,
    suspended: SUSPENDED_LABEL,
    failed: FAILED_LABEL,
    aborted: ABORTED_LABEL,
  };
  return map[status];
}

export function totalStatusColor(status: TotalStatus, colors: ColorPalette): string {
  const map: Record<TotalStatus, string> = {
    working: colors.success,
    completed: colors.success,
    suspended: colors.textDim,
    failed: colors.error,
    aborted: colors.warning,
  };
  return map[status];
}

export function totalStatusLabelToken(
  status: TotalStatus,
  members: readonly AgentSwarmMember[],
): ColorToken {
  if (status === 'working' && !members.some((member) => member.phase === 'completed')) {
    return 'primary';
  }
  switch (status) {
    case 'working':
    case 'completed':
      return 'success';
    case 'suspended':
      return 'textDim';
    case 'failed':
      return 'error';
    case 'aborted':
      return 'warning';
  }
}

export function renderCellLabel(
  member: AgentSwarmMember,
  snapshot: AgentSwarmSnapshot,
  width: number,
  colors: ColorPalette,
  nowMs: number,
): string {
  const latestLine = latestNonEmptyLine(snapshot.latestModelText);
  if (snapshot.phase === 'running') {
    return renderRunningCellLabel(member, width, colors, nowMs);
  }
  if (snapshot.phase === 'failed' && member.failureText !== undefined) {
    return renderFailedCellLabel(member, width, colors);
  }
  if (snapshot.phase === 'completed') {
    return renderCompletedCellLabel(
      member,
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

/**
 * Running cell label: a time-seeded pulse glyph, the latest activity text,
 * then dim suffixes for per-member elapsed time and the model alias. The
 * suffixes reserve their width first so they survive narrow-cell truncation.
 * While the member's latest tool activity is a code write (Phase 5-A), a
 * clock-driven ✎ pulse joins the cell glyph and the action text picks up a
 * brand-tone emphasis so parallel writes stand out at a glance.
 */
export function renderRunningCellLabel(
  member: AgentSwarmMember,
  width: number,
  colors: ColorPalette,
  nowMs: number,
): string {
  const writePulse = isMemberWritingCode(member, nowMs) ? renderCodeWritePulseGlyph(member) : '';
  const writePrefix = writePulse.length > 0 ? `${writePulse} ` : '';
  const pulse = `${renderPulseGlyph(
    RUNNING_CELL_PULSE_GLYPHS,
    `agent-swarm-cell:${member.id}`,
    RUNNING_CELL_PULSE_FALLBACK,
    'primary',
  )} `;
  const suffix = `${runningElapsedSuffix(member, nowMs)}${modelAliasSuffix(member)}`;
  const textWidth = Math.max(
    1,
    width - visibleWidth(pulse) - visibleWidth(writePrefix) - visibleWidth(suffix),
  );
  const textColor = writePrefix.length > 0 ? colors.primary : colors.textDim;
  const text = truncateWithColor(runningCellLabelText(member), textWidth, textColor);
  return truncateToWidth(`${pulse}${writePrefix}${text}${suffix}`, width);
}

/**
 * Phase 5-A: whether the member's latest tool activity is a code write that
 * is still fresh (inside the quiet window) and not in a terminal phase.
 */
export function isMemberWritingCode(member: AgentSwarmMember, nowMs: number): boolean {
  return (
    member.codeWriteAtMs !== undefined &&
    !isTerminalPhase(member.phase) &&
    nowMs - member.codeWriteAtMs <= CODE_WRITE_QUIET_MS
  );
}

/**
 * Clock-driven ✎ glyph for members actively writing code (Phase 5-A).
 * Reuses the shared pulse primitive on the ambient animation clock and
 * renders nothing when motion is gated (off / SSH / NO_COLOR / CI) so
 * static output stays byte-identical.
 */
function renderCodeWritePulseGlyph(member: AgentSwarmMember): string {
  if (!shouldRenderAmbientEffects(getActiveAppearancePreferences())) return '';
  return renderPulseGlyph(
    CODE_WRITE_PULSE_GLYPHS,
    `agent-swarm-write:${member.id}`,
    CODE_WRITE_PULSE_FALLBACK,
    'primary',
  );
}

/**
 * Phase 5-A write detection: prefer the explicit tool name carried by the
 * feed event; fall back to the leading body token (`Edit src/a.ts +3 -1`)
 * for callers that only pass a rendered body.
 */
export function isCodeWriteToolActivity(toolName: string | undefined, body: string): boolean {
  if (toolName !== undefined && toolName.length > 0) {
    return CODE_WRITE_TOOL_NAMES.has(toolName.trim().toLowerCase());
  }
  return CODE_WRITE_BODY_TOKEN.test(body.trim());
}

export function renderFailedCellLabel(
  member: AgentSwarmMember,
  width: number,
  colors: ColorPalette,
): string {
  const mainText = `${FAILURE_MARK}${member.failureText ?? ''}`;
  const suffix = `${retryNoteSuffix(member)}${modelAliasSuffix(member)}`;
  return renderMainWithDimSuffix(mainText, suffix, width, colors.error);
}

function runningElapsedSuffix(member: AgentSwarmMember, nowMs: number): string {
  if (member.startedAtMs === undefined) return '';
  return currentTheme.dimFg('textMuted', ` (${formatElapsedTime(member.startedAtMs, nowMs)})`);
}

function retryNoteSuffix(member: AgentSwarmMember): string {
  if (member.retryNote === undefined) return '';
  return currentTheme.dimFg('textMuted', ` · ${member.retryNote}`);
}

function modelAliasSuffix(member: AgentSwarmMember): string {
  if (member.modelAlias === undefined) return '';
  const alias = truncateToWidth(member.modelAlias, MODEL_ALIAS_BADGE_MAX_WIDTH, '…');
  return currentTheme.dimFg('textMuted', ` · ${alias}`);
}

/**
 * Render a colored main label followed by a pre-styled dim suffix, shrinking
 * the main text (with an ellipsis) so the suffix stays intact when possible.
 */
function renderMainWithDimSuffix(
  mainText: string,
  dimSuffix: string,
  width: number,
  mainColor: string,
): string {
  if (dimSuffix.length === 0) return truncateWithColor(mainText, width, mainColor);
  const suffixWidth = visibleWidth(dimSuffix);
  if (suffixWidth >= width) {
    return truncateToWidth(dimSuffix, width, currentTheme.dimFg('textMuted', '…'));
  }
  const colorize = chalk.hex(mainColor);
  const mainWidth = Math.max(1, width - suffixWidth);
  return truncateToWidth(colorize(mainText), mainWidth, colorize('…')) + dimSuffix;
}

export function runningCellLabelText(member: AgentSwarmMember): string {
  const latestLine = latestNonEmptyLine(member.latestModelText);
  const itemText = collapseWhitespace(member.itemText);
  const text = latestLine.length > 0 ? latestLine : itemText;
  return text.length > 0 ? text : PHASE_LABELS.running;
}

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

function completedCellText(member: AgentSwarmMember, fallback: string): string {
  if (member.verdict === undefined) return fallback;
  const expert = member.ultraSwarm?.name === undefined ? '' : `${member.ultraSwarm.name}: `;
  return `${expert}${member.verdict}`;
}

export function renderCancelledCellLabel(
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
  member: AgentSwarmMember,
  text: string,
  width: number,
  colors: ColorPalette,
): string {
  const finalText = normalizeFinalOutputText(text);
  const label = finalText === undefined ? SUCCESS_MARK.trimEnd() : `${SUCCESS_MARK}${finalText}`;
  return renderMainWithDimSuffix(label, modelAliasSuffix(member), width, colors.success);
}

export function compactTerminalMark(
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

export function renderPendingCell(
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

export function renderQueuedCell(
  member: AgentSwarmMember,
  width: number,
  colors: ColorPalette,
): string {
  const id = chalk.hex(colors.primary)(member.id);
  const prefix = `${id} `;
  const suffix = modelAliasSuffix(member);
  const labelWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix));
  const itemText = collapseWhitespace(member.itemText);
  const label = member.ultraSwarm !== undefined && itemText.length > 0 ? itemText : QUEUED_LABEL;
  return truncateToWidth(prefix + truncateWithColor(label, labelWidth, colors.textDim) + suffix, width);
}

export function renderCancelledUnstartedCell(
  member: AgentSwarmMember,
  width: number,
  colors: ColorPalette,
): string {
  const id = chalk.hex(colors.primary)(member.id);
  const prefix = `${id} `;
  const labelWidth = Math.max(1, width - visibleWidth(prefix));
  return prefix + renderCancelledCellLabel(member, labelWidth, colors);
}

export function truncateWithColor(text: string, width: number, color: string): string {
  const colorize = chalk.hex(color);
  return truncateToWidth(colorize(text), width, colorize('…'));
}

export function truncateStartToWidth(text: string, width: number): string {
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

export function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
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

export function latestNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = collapseWhitespace(lines[index] ?? '');
    if (line.length > 0) return line;
  }
  return '';
}

export function padAnsi(text: string, width: number): string {
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

export function cancelledLabelColor(colors: ColorPalette): string {
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

export function normalizeFinalOutputText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const normalized = collapseWhitespace(text);
  return normalized.length > 0 ? normalized : undefined;
}

import { truncateToWidth, visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';

import type { AgentSwarmProgressEstimatorPhase as AgentSwarmPhase } from '#/tui/components/messages/agent-swarm-progress-estimator';
import type {
  AgentSwarmMember,
  AgentSwarmSnapshot,
} from '#/tui/components/messages/agent-swarm-progress';
import { FAILURE_MARK, SUCCESS_MARK } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  getActiveAppearancePreferences,
  renderPulseGlyph,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';
import { ABORTED_LABEL, isTerminalPhase } from '#/tui/utils/agent-swarm-cell-status';
import {
  collapseWhitespace,
  latestNonEmptyLine,
  normalizeFinalOutputText,
  truncateWithColor,
} from '#/tui/utils/agent-swarm-cell-text';

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
const CANCELLED_MARK = '⊘ ';
const QUEUED_LABEL = 'Queued...';

const PHASE_LABELS: Record<AgentSwarmPhase, string> = {
  pending: QUEUED_LABEL,
  queued: QUEUED_LABEL,
  suspended: 'Rate limited...',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: ABORTED_LABEL,
};

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

export function runningCellLabelText(member: AgentSwarmMember): string {
  const latestLine = latestNonEmptyLine(member.latestModelText);
  const itemText = collapseWhitespace(member.itemText);
  const text = latestLine.length > 0 ? latestLine : itemText;
  return text.length > 0 ? text : PHASE_LABELS.running;
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

function renderCodeWritePulseGlyph(member: AgentSwarmMember): string {
  if (!shouldRenderAmbientEffects(getActiveAppearancePreferences())) return '';
  return renderPulseGlyph(
    CODE_WRITE_PULSE_GLYPHS,
    `agent-swarm-write:${member.id}`,
    CODE_WRITE_PULSE_FALLBACK,
    'primary',
  );
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

function completedCellText(member: AgentSwarmMember, fallback: string): string {
  if (member.verdict === undefined) return fallback;
  const expert = member.ultraSwarm?.name === undefined ? '' : `${member.ultraSwarm.name}: `;
  return `${expert}${member.verdict}`;
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

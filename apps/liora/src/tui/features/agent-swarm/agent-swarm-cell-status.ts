import { renderRendererSegmentedProgressBar } from '#/tui/renderer';
import chalk from 'chalk';

import type { AgentSwarmProgressEstimatorPhase as AgentSwarmPhase } from '#/tui/components/messages/agent-swarm-progress-estimator';
import type {
  AgentSwarmMember,
  AgentSwarmSnapshot,
  AgentSwarmSummary,
  TotalStatus,
} from '#/tui/components/messages/agent-swarm-progress';
import { FAILURE_MARK, SUCCESS_MARK } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import { renderPulseText } from '#/tui/features/appearance/appearance-effects';

export const ORCHESTRATING_LABEL = 'Orchestrating...';
export const PROMPTING_LABEL = 'Prompting...';
const WORKING_LABEL = 'Working...';
const COMPLETED_LABEL = 'Completed.';
const FAILED_LABEL = 'Failed.';
export const ABORTED_LABEL = 'Aborted.';
export const CANCELLED_LABEL = 'Cancelled.';
const QUEUED_LABEL = 'Queued...';
const SUSPENDED_LABEL = 'Rate limited...';

const STATUS_BAR_CHAR = '━';
const CANCELLED_MARK = '⊘ ';
export const ACTIVITY_SPINNER_PLACEHOLDER = '  ';

const STATUS_BAR_ORDER = [
  'completed',
  'working',
  'suspended',
  'queued',
  'cancelled',
  'failed',
] as const;
type StatusBarPhase = typeof STATUS_BAR_ORDER[number];

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

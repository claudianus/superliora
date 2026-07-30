import { RENDERER_BRAILLE_PROGRESS_LEVELS, visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';

import type { AgentSwarmProgressEstimatorPhase } from '#/tui/components/messages/agent-swarm-progress/estimator';
import type {
  AgentSwarmMember,
  AgentSwarmSnapshot,
} from '#/tui/components/messages/agent-swarm-progress/index';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  brailleBar,
  cancelledProgressColor,
  compactTerminalMark,
  padAnsi,
  renderCancelledUnstartedCell,
  renderCellLabel,
  renderPendingCell,
  renderQueuedCell,
} from '#/tui/features/agent-swarm/agent-swarm-cell-render';
import {
  calculateAgentSwarmGridLayout,
  type AgentSwarmGridLayout,
} from '#/tui/features/agent-swarm/agent-swarm-grid-layout';

/** Progress-estimator lookup, injected so this module stays free of estimator state. */
export type AgentSwarmGridEstimateFn = (input: {
  readonly memberKey: string;
  readonly phase: AgentSwarmProgressEstimatorPhase;
  readonly capacityTicks: number;
  readonly nowMs: number;
}) => { readonly displayTicks: number };

export function renderAgentSwarmGrid(input: {
  readonly width: number;
  readonly height: number | undefined;
  readonly members: readonly AgentSwarmMember[];
  readonly snapshots: readonly AgentSwarmSnapshot[];
  readonly nowMs: number;
  readonly colors: ColorPalette;
  readonly estimate: AgentSwarmGridEstimateFn;
}): string[] {
  const { width, height, members, snapshots, nowMs, colors, estimate } = input;
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
      cells.push(
        padAnsi(renderAgentSwarmCell(member, snapshot, layout, nowMs, colors, estimate), layout.cellWidth),
      );
    }
    lines.push(leftPadding + cells.join(cellGap));
  }
  return lines;
}

function renderAgentSwarmCell(
  member: AgentSwarmMember,
  snapshot: AgentSwarmSnapshot,
  layout: AgentSwarmGridLayout,
  nowMs: number,
  colors: ColorPalette,
  estimate: AgentSwarmGridEstimateFn,
): string {
  const width = layout.cellWidth;
  if (snapshot.phase === 'pending') {
    return renderPendingCell(member, width, colors);
  }
  if (snapshot.phase === 'cancelled' && snapshot.ticks <= 0) {
    return renderCancelledUnstartedCell(member, width, colors);
  }
  if (!layout.renderText) {
    return renderAgentSwarmCompactCell(member, snapshot, layout.barCells, nowMs, colors, estimate);
  }
  if (snapshot.phase === 'queued' && snapshot.ticks <= 0) {
    return renderQueuedCell(member, width, colors);
  }

  const estimated = estimate({
    memberKey: member.id,
    phase: snapshot.phase,
    capacityTicks: layout.barCells * RENDERER_BRAILLE_PROGRESS_LEVELS.length,
    nowMs,
  });
  const id = chalk.hex(colors.primary)(member.id);
  const bar = brailleBar(
    estimated.displayTicks,
    snapshot.phase,
    layout.barCells,
    colors,
    snapshot.phaseElapsedMs,
    cancelledProgressColor(member, snapshot.phase, colors),
  );
  const prefix = `${id} ${bar} `;
  const labelWidth = Math.max(1, width - visibleWidth(prefix));
  const label = renderCellLabel(member, snapshot, labelWidth, colors, nowMs);
  return prefix + label;
}

function renderAgentSwarmCompactCell(
  member: AgentSwarmMember,
  snapshot: AgentSwarmSnapshot,
  barCells: number,
  nowMs: number,
  colors: ColorPalette,
  estimate: AgentSwarmGridEstimateFn,
): string {
  const estimatePhase = snapshot.phase === 'pending' ? 'queued' : snapshot.phase;
  const estimated = estimate({
    memberKey: member.id,
    phase: estimatePhase,
    capacityTicks: barCells * RENDERER_BRAILLE_PROGRESS_LEVELS.length,
    nowMs,
  });
  const id = chalk.hex(colors.primary)(member.id);
  const bar = brailleBar(
    estimated.displayTicks,
    estimatePhase,
    barCells,
    colors,
    snapshot.phaseElapsedMs,
    cancelledProgressColor(member, snapshot.phase, colors),
  );
  return `${id} ${bar}${compactTerminalMark(member, snapshot.phase, colors)}`;
}

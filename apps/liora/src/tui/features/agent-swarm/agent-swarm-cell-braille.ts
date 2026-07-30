import {
  RENDERER_BRAILLE_PROGRESS_EMPTY,
  RENDERER_BRAILLE_PROGRESS_LEVELS,
  RENDERER_BRAILLE_PROGRESS_SEPARATOR,
  renderRendererSteppedProgressBar,
  type RendererSteppedProgressBarCellProjection,
} from '#/tui/renderer';
import chalk from 'chalk';

import type { AgentSwarmProgressEstimatorPhase as AgentSwarmPhase } from '#/tui/components/messages/agent-swarm-progress-estimator';
import type { AgentSwarmMember } from '#/tui/components/messages/agent-swarm-progress';
import type { ColorPalette } from '#/tui/theme/colors';

/** How long the completed/failed fill animation runs before settling. */
export const COMPLETE_FILL_MS = 360;
const FAILED_PLACEHOLDER_RED_FACTOR = 0.75;
const FAILED_PLACEHOLDER_NON_RED_FACTOR = 0.25;
const CANCELLED_LABEL_DARKEN_FACTOR = 0.72;

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

export function cancelledLabelColor(colors: ColorPalette): string {
  return darkenHexColor(colors.warning, CANCELLED_LABEL_DARKEN_FACTOR);
}

function bracketBar(content: string, colors: ColorPalette): string {
  const bracket = chalk.hex(colors.textMuted);
  return bracket('[') + content + bracket(']');
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

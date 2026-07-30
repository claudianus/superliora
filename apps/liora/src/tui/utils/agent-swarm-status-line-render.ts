import { truncateToWidth, visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';

import type { AgentSwarmMember, TotalStatus } from '#/tui/components/messages/agent-swarm-progress';
import type { ColorPalette } from '#/tui/theme/colors';
import {
  ACTIVITY_SPINNER_PLACEHOLDER,
  ORCHESTRATING_LABEL,
  PROMPTING_LABEL,
  activityPrefixForTotalStatus,
  collapseWhitespace,
  isTerminalTotalStatus,
  renderStatusLabel,
  renderStatusPipBar,
  totalStatus,
  totalStatusLabel,
  totalStatusLabelToken,
  truncateStartToWidth,
} from '#/tui/utils/agent-swarm-cell-render';
import { formatElapsedTime } from '#/tui/utils/elapsed-time';

const TOTAL_STATUS_BAR_GAP = 2;
const PROMPTING_TEXT_TRAILING_GAP = 1;

export interface SwarmStatusLineContext {
  readonly members: readonly AgentSwarmMember[];
  readonly failed: boolean;
  readonly aborted: boolean;
  readonly toolCallActive: boolean;
  readonly activitySpinnerText: (() => string) | undefined;
  readonly swarmStartedAtMs: number | undefined;
  readonly inputComplete: boolean;
  readonly itemsStarted: boolean;
  readonly promptTemplateText: string;
  readonly colors: ColorPalette;
}

export function renderAgentSwarmStatusLine(width: number, context: SwarmStatusLineContext): string {
  const status = totalStatus(context.members, {
    failed: context.failed,
    aborted: context.aborted,
  });
  const prefix = renderActivityPrefix(status, context);
  if (prefix.length > 0) {
    const contentWidth = Math.max(0, width - visibleWidth(prefix));
    if (contentWidth <= 0) return truncateToWidth(prefix, width);
    return truncateToWidth(`${prefix}${renderStatusLineContent(contentWidth, status, context)}`, width);
  }
  return renderStatusLineContent(width, status, context);
}

function renderActivityPrefix(status: TotalStatus, context: SwarmStatusLineContext): string {
  const { colors } = context;
  if (context.toolCallActive && isTerminalTotalStatus(status)) {
    return activityPrefixForTotalStatus(status, colors);
  }
  if (context.toolCallActive) {
    const spinner = context.activitySpinnerText?.();
    if (status === 'working' && context.swarmStartedAtMs !== undefined) {
      const elapsed = chalk.hex(colors.textDim)(` ${formatElapsedTime(context.swarmStartedAtMs)}`);
      return `${spinner ?? ACTIVITY_SPINNER_PLACEHOLDER}${elapsed}`;
    }
    return spinner ?? '';
  }
  return activityPrefixForTotalStatus(status, colors);
}

function renderStatusLineContent(
  width: number,
  status: TotalStatus,
  context: SwarmStatusLineContext,
): string {
  if (status !== 'working') return renderProgressStatusLine(width, status, context);

  if (!context.inputComplete) {
    return renderOrchestratingStatusLine(width, context);
  }

  return renderProgressStatusLine(width, status, context);
}

function renderProgressStatusLine(
  width: number,
  status: TotalStatus,
  context: SwarmStatusLineContext,
): string {
  const label = renderStatusLabel(
    totalStatusLabel(status),
    totalStatusLabelToken(status, context.members),
    status === 'working',
    `agent-swarm:status:${status}`,
  );
  if (context.members.length === 0) return truncateToWidth(label, width);
  const barWidth = Math.max(0, width - visibleWidth(label) - TOTAL_STATUS_BAR_GAP);
  if (barWidth <= 0) return truncateToWidth(label, width);
  return truncateToWidth(
    `${label}${' '.repeat(TOTAL_STATUS_BAR_GAP)}${renderStatusPipBar(context.members, barWidth, context.colors)}`,
    width,
  );
}

function renderOrchestratingStatusLine(width: number, context: SwarmStatusLineContext): string {
  if (context.itemsStarted) {
    return truncateToWidth(
      renderStatusLabel(ORCHESTRATING_LABEL, 'primary', true, 'agent-swarm:status:orchestrating'),
      width,
    );
  }

  const promptTemplate = collapseWhitespace(context.promptTemplateText);
  const prompting = promptTemplate.length > 0;
  const label = renderStatusLabel(
    prompting ? PROMPTING_LABEL : ORCHESTRATING_LABEL,
    'primary',
    true,
    prompting ? 'agent-swarm:status:prompting' : 'agent-swarm:status:orchestrating',
  );
  if (promptTemplate.length === 0) return truncateToWidth(label, width);

  const availablePromptWidth = Math.max(0, width - visibleWidth(label) - PROMPTING_TEXT_TRAILING_GAP);
  const separator = visibleWidth(promptTemplate) <= availablePromptWidth - 1 ? ' ' : '  ';
  const promptWidth = Math.max(0, availablePromptWidth - visibleWidth(separator));
  if (promptWidth <= 0) return truncateToWidth(label, width);
  const prompt = chalk.hex(context.colors.textDim)(truncateStartToWidth(promptTemplate, promptWidth));
  return truncateToWidth(`${label}${separator}${prompt}`, width);
}

/**
 * Pure result-body routing for ToolCallComponent's `buildContent` tail.
 * Swarm summaries and AskUserQuestion live in tool-call-result-body; this
 * module handles the remaining result routing and renderer dispatch.
 */

import { Text, type Component } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import { isSwarmProgressToolName } from '../agent-swarm-progress';
import { interpretExitPlanModeOutcome, isExitPlanModeOutcomeOutput } from './plan';
import {
  buildAgentSwarmResultSummaryComponents,
  buildAskUserQuestionResultComponents,
} from './result-body';
import { pickResultRenderer } from '../tool-renderers/registry';

export function buildToolCallResultContentComponents(params: {
  readonly toolCall: ToolCallBlockData;
  readonly result: ToolResultBlockData;
  readonly expanded: boolean;
  readonly isSingleSubagentView: boolean;
}): Component[] {
  const { toolCall, result, expanded, isSingleSubagentView } = params;

  if (isSwarmProgressToolName(toolCall.name)) {
    return buildAgentSwarmResultSummaryComponents(result);
  }

  if (!result.output) return [];

  if (isSingleSubagentView) return [];

  if (result.output.trimStart().startsWith('<system')) return [];

  if (toolCall.name === 'ExitPlanMode' && isExitPlanModeOutcomeOutput(result.output)) {
    const outcome = interpretExitPlanModeOutcome(result.output);
    if (outcome.kind === 'rejected' && outcome.feedback !== undefined) {
      const trimmed = outcome.feedback.trim();
      if (trimmed.length > 0) {
        const labelTone = (text: string) => currentTheme.boldFg('warning', text);
        const items: Component[] = [new Text(labelTone('↪ Suggestion'), 2, 0)];
        for (const line of trimmed.split('\n')) {
          items.push(new Text(line, 4, 0));
        }
        return items;
      }
    }
    return [];
  }

  if (toolCall.name === 'TodoList' && !result.is_error) return [];
  if (toolCall.name === 'EnterPlanMode' && !result.is_error) return [];

  if (
    toolCall.name === 'AskUserQuestion' &&
    toolCall.args['background'] !== true &&
    !result.is_error
  ) {
    const askComponents = buildAskUserQuestionResultComponents(result.output);
    if (askComponents !== undefined) return askComponents;
  }

  const renderer = pickResultRenderer(toolCall.name);
  return renderer(toolCall, result, {
    expanded: true,
    showCommand: expanded,
  });
}

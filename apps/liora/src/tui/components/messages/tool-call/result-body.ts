/**
 * Pure result-body builders for ToolCallComponent's `buildContent` tail:
 * the agent-swarm completion summary line and the AskUserQuestion Q/A list.
 * No component instance state.
 */

import { Text, type Component } from '#/tui/renderer';
import { FAILURE_MARK, SUCCESS_MARK } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ToolResultBlockData } from '#/tui/types';

import { agentSwarmResultSummaryFromOutput } from '../agent-swarm-progress/index';

const ABORTED_MARK = '⊘';

export function buildAgentSwarmResultSummaryComponents(result: ToolResultBlockData): Component[] {
  const summary = agentSwarmResultSummaryFromOutput(result.output);
  const dim = (s: string): string => currentTheme.fg('textDim', s);
  const segments: string[] = [];

  if (summary.completed > 0) {
    segments.push(
      currentTheme.fg('success', `${SUCCESS_MARK.trimEnd()} ${String(summary.completed)} completed`),
    );
  }
  if (summary.failed > 0) {
    segments.push(
      currentTheme.fg('error', `${FAILURE_MARK.trimEnd()} ${String(summary.failed)} failed`),
    );
  }
  if (summary.aborted > 0) {
    segments.push(
      currentTheme.fg('warning', `${ABORTED_MARK} ${String(summary.aborted)} aborted`),
    );
  }

  if (segments.length > 0) {
    return [new Text(`${dim('Agent swarm: ')}${segments.join(dim(' · '))}`, 2, 0)];
  }

  const isAborted = result.is_error === true && /\b(?:aborted|cancelled)\b/i.test(result.output);
  const colorToken = isAborted ? 'warning' : result.is_error === true ? 'error' : 'success';
  const label = isAborted
    ? `${ABORTED_MARK} Aborted.`
    : result.is_error === true
      ? `${FAILURE_MARK.trimEnd()} Failed.`
      : `${SUCCESS_MARK.trimEnd()} Completed.`;
  return [new Text(`${dim('Agent swarm: ')}${currentTheme.fg(colorToken, label)}`, 2, 0)];
}

/**
 * Renders AskUserQuestion's JSON payload as a friendly Q/A list. Returns
 * `undefined` on parse failure so the caller falls back to raw display.
 */
export function buildAskUserQuestionResultComponents(output: string): Component[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;

  const accent = (text: string) => currentTheme.fg('primary', text);

  const answers = (parsed as { answers?: unknown }).answers;
  const note = (parsed as { note?: unknown }).note;

  const hasAnswers =
    typeof answers === 'object' && answers !== null && Object.keys(answers).length > 0;

  if (!hasAnswers) {
    const noteText =
      typeof note === 'string' && note.length > 0 ? note : 'User dismissed the question.';
    return [new Text(currentTheme.dim(`  ${noteText}`), 0, 0)];
  }

  const items: Component[] = [];
  for (const [question, answer] of Object.entries(answers as Record<string, unknown>)) {
    const answerText = typeof answer === 'string' ? answer : JSON.stringify(answer);
    items.push(new Text(`  ${currentTheme.dim('Q')}  ${question}`, 0, 0));
    items.push(new Text(`  ${accent('→')}  ${answerText}`, 0, 0));
  }
  return items;
}

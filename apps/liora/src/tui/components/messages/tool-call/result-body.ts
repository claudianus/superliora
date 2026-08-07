/**
 * Pure result-body builders for ToolCallComponent's `buildContent` tail:
 * the AskUserQuestion Q/A list. No component instance state.
 */

import { Text, type Component } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';

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

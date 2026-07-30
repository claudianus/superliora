import type { ContextMessage } from '@superliora/sdk';

import type { GoalReplayLifecycleChange } from './session-replay-types';

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export function extractBashTag(
  text: string,
  tag: 'bash-input' | 'bash-stdout' | 'bash-stderr',
): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return match?.[1] === undefined ? undefined : unescapeBashXml(match[1]);
}

function unescapeBashXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
}

const RESUME_NORMALIZATION_GOAL_PAUSE_REASONS = new Set([
  'Paused after agent resume',
  'Paused after session resume',
]);

export function isResumeNormalizationGoalPause(change: GoalReplayLifecycleChange): boolean {
  return (
    change.status === 'paused' &&
    change.reason !== undefined &&
    RESUME_NORMALIZATION_GOAL_PAUSE_REASONS.has(change.reason)
  );
}

export function goalLifecycleReplayContent(change: GoalReplayLifecycleChange): string {
  switch (change.status) {
    case 'paused':
      return 'Goal paused';
    case 'active':
      return 'Goal resumed';
    case 'blocked':
      return 'Goal blocked';
    case 'complete':
    case undefined:
      return 'Goal updated';
  }
}

export function isModelBlockedGoalLifecycle(change: GoalReplayLifecycleChange): boolean {
  return change.status === 'blocked' && change.actor === 'model';
}

export function goalOutcomeReminderFromSystemMessage(
  message: ContextMessage,
): string | undefined | null {
  if (message.origin?.kind !== 'system_trigger') return null;
  if (message.origin.name !== 'goal_completion' && message.origin.name !== 'goal_blocked') {
    return null;
  }
  return undefined;
}

export function isGoalForkClearedSystemReminder(message: ContextMessage): boolean {
  return message.origin?.kind === 'system_trigger' && message.origin.name === 'goal_fork_cleared';
}

export function extractCronPrompt(text: string): string {
  const open = '<prompt>\n';
  const close = '\n</prompt>';
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start >= 0 && end >= start + open.length) {
    return text.slice(start + open.length, end);
  }
  return stripCronEnvelope(text);
}

export function stripCronEnvelope(text: string): string {
  const lines = text.split('\n');
  if (
    lines.length >= 2 &&
    lines[0]?.startsWith('<cron-fire ') &&
    lines.at(-1) === '</cron-fire>'
  ) {
    return lines.slice(1, -1).join('\n');
  }
  return text;
}

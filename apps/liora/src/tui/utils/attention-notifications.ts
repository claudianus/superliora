import type { BackgroundTaskInfo, GoalSnapshot } from '@superliora/sdk';

import type { TUIState } from '#/tui/tui-state';

import { formatBackgroundTaskTranscript } from './background-task-status';
import { notifyUserAttentionOnce, type UserAttentionOptions } from './terminal-notification';

export function notifyGoalCompletedAttention(
  state: TUIState,
  goal: GoalSnapshot,
  options?: UserAttentionOptions,
): void {
  notifyUserAttentionOnce(
    state,
    `goal-complete:${goal.goalId}`,
    {
      title: 'SuperLiora goal complete',
      body: goal.objective,
    },
    options,
  );
}

export function notifyGoalBlockedAttention(
  state: TUIState,
  goal: GoalSnapshot,
  reason?: string,
  options?: UserAttentionOptions,
): void {
  notifyUserAttentionOnce(
    state,
    `goal-blocked:${goal.goalId}`,
    {
      title: 'SuperLiora goal blocked',
      body: reason ?? goal.terminalReason ?? goal.objective,
    },
    options,
  );
}

export function notifyBackgroundTaskAttention(
  state: TUIState,
  info: BackgroundTaskInfo,
  options?: UserAttentionOptions,
): void {
  const status = formatBackgroundTaskTranscript(info);
  notifyUserAttentionOnce(
    state,
    `background-task:${info.taskId}:${info.status}`,
    {
      title: 'SuperLiora background task finished',
      body: status.detail !== undefined ? `${status.headline} — ${status.detail}` : status.headline,
    },
    options,
  );
}

export function notifySubagentAttention(
  state: TUIState,
  subagentId: string,
  outcome: 'completed' | 'failed',
  detail?: string,
  options?: UserAttentionOptions,
): void {
  notifyUserAttentionOnce(
    state,
    `subagent:${subagentId}:${outcome}`,
    {
      title: outcome === 'completed' ? 'SuperLiora subagent finished' : 'SuperLiora subagent failed',
      body: detail,
    },
    options,
  );
}

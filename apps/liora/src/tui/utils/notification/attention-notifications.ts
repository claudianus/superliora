import type { BackgroundTaskInfo, GoalSnapshot } from '@superliora/sdk';

import type { TUIState } from '#/tui/tui-state';

import { formatBackgroundTaskTranscript } from '#/tui/utils/background/background-task-status';
import { ttui } from '#/tui/utils/tui-i18n';
import { notifyUserAttentionOnce, type UserAttentionOptions } from '#/tui/utils/terminal/terminal-notification';

export function notifyGoalCompletedAttention(
  state: TUIState,
  goal: GoalSnapshot,
  options?: UserAttentionOptions,
): void {
  notifyUserAttentionOnce(
    state,
    `goal-complete:${goal.goalId}`,
    {
      title: ttui('tui.notice.attention.goalComplete'),
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
      title: ttui('tui.notice.attention.goalBlocked'),
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
      title: ttui('tui.notice.attention.backgroundTask'),
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
      title:
        outcome === 'completed'
          ? ttui('tui.notice.attention.subagentFinished')
          : ttui('tui.notice.attention.subagentFailed'),
      body: detail,
    },
    options,
  );
}

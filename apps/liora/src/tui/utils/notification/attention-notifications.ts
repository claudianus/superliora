import type { BackgroundTaskInfo } from '@superliora/sdk';

import type { TUIState } from '#/tui/tui-state';

import { formatBackgroundTaskTranscript } from '#/tui/utils/background/background-task-status';
import { ttui } from '#/tui/utils/tui-i18n';
import { notifyUserAttentionOnce, type UserAttentionOptions } from '#/tui/utils/terminal/terminal-notification';


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

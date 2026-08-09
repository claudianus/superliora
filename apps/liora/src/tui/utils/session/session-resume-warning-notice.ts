/**
 * Loop49a — surface session resume warnings as a named TUI notice.
 *
 * `getResumeState().warning` was status-line only across startup, lifecycle,
 * and session-browser resume paths — easy to miss when history is replaying.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export type SessionResumeWarningNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'session-resume-warning';
};

export function formatSessionResumeWarningNotice(
  warning: string,
): SessionResumeWarningNotice {
  const text = warning.trim();
  const preview = `${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`;
  return {
    title: ttui('tui.notice.sessionResume.title'),
    detail:
      text.length > 0
        ? text
        : ttui('tui.notice.sessionResume.detailFallback'),
    status: ttui('tui.notice.sessionResume.status', { preview }),
    coalesceKey: 'session-resume-warning',
  };
}

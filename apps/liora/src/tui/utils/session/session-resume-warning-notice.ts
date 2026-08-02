/**
 * Loop49a — surface session resume warnings as a named TUI notice.
 *
 * `getResumeState().warning` was status-line only across startup, lifecycle,
 * and session-browser resume paths — easy to miss when history is replaying.
 */

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
  return {
    title: 'Session resume warning',
    detail:
      text.length > 0
        ? text
        : 'Session resumed with a warning. Review history and state before continuing.',
    status: `Resume warning: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
    coalesceKey: 'session-resume-warning',
  };
}

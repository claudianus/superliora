/**
 * Loop48a — promote `session.getSessionWarnings()` from status-line only to
 * named TUI notices (same recovery surface as mid-session wire warnings).
 */

import { ttui } from '#/tui/utils/tui-i18n';

export type SessionWarningLike = {
  readonly code?: string;
  readonly message: string;
  /** Typically `error`, `warning`, or `info`; the wire may carry anything. */
  readonly severity?: string;
};

export type SessionWarningNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: string;
  readonly statusColor: 'error' | 'warning';
};

export function formatSessionWarningNotice(
  warning: SessionWarningLike,
): SessionWarningNotice {
  const code = warning.code ?? '';
  const message = warning.message;
  const statusColor = warning.severity === 'error' ? 'error' : 'warning';

  if (
    code === 'agents-md-oversized' ||
    (message.includes('AGENTS.md') &&
      (message.includes('exceeds the recommended') ||
        message.includes('hard injection cap')))
  ) {
    return {
      title: ttui('tui.notice.agentsMd.title'),
      detail: message,
      status: message.includes('hard injection cap')
        ? ttui('tui.notice.agentsMd.statusHardCap')
        : ttui('tui.notice.agentsMd.statusTrim'),
      coalesceKey: 'agents-md-oversized',
      statusColor,
    };
  }

  const title =
    code.length > 0
      ? ttui('tui.notice.sessionWarning.titleWithCode', { code })
      : ttui('tui.notice.sessionWarning.title');
  const preview = `${message.slice(0, 80)}${message.length > 80 ? '…' : ''}`;
  return {
    title,
    detail: message,
    status: ttui('tui.notice.sessionWarning.status', { preview }),
    coalesceKey: code.length > 0 ? `session-warning-${code}` : 'session-warning',
    statusColor,
  };
}

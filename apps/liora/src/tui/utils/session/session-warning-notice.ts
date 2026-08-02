/**
 * Loop48a — promote `session.getSessionWarnings()` from status-line only to
 * named TUI notices (same recovery surface as mid-session wire warnings).
 */

export type SessionWarningLike = {
  readonly code?: string;
  readonly message: string;
  readonly severity?: 'error' | 'warning' | 'info' | string;
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
      title: 'AGENTS.md oversized',
      detail: message,
      status: message.includes('hard injection cap')
        ? 'AGENTS.md hard-capped — trim project instructions'
        : 'AGENTS.md oversized — consider trimming',
      coalesceKey: 'agents-md-oversized',
      statusColor,
    };
  }

  const title =
    code.length > 0
      ? `Session warning (${code})`
      : 'Session warning';
  return {
    title,
    detail: message,
    status: `Session warning: ${message.slice(0, 80)}${message.length > 80 ? '…' : ''}`,
    coalesceKey: code.length > 0 ? `session-warning-${code}` : 'session-warning',
    statusColor,
  };
}

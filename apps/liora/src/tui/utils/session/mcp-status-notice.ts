/**
 * Loop52a — surface MCP connect failures / needs-auth as named TUI notices.
 *
 * Spinner row + status line alone are easy to miss when the transcript is busy.
 * Successful connects stay quiet (no notice spam).
 */

import { ttui } from '#/tui/utils/tui-i18n';

export type McpStatusNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: string;
  readonly color: 'warning' | 'error';
};

export function formatMcpStatusNotice(input: {
  readonly name: string;
  readonly status: string;
  readonly error?: string;
}): McpStatusNotice | undefined {
  const name = input.name.length > 0 ? input.name : 'server';
  if (input.status === 'needs-auth') {
    return {
      title: ttui('tui.notice.mcpAuth.title'),
      detail: ttui('tui.notice.mcpAuth.detail', { name }),
      status: ttui('tui.notice.mcpAuth.status', { name }),
      coalesceKey: `mcp-status-needs-auth-${name}`,
      color: 'warning',
    };
  }
  if (input.status === 'failed') {
    const err =
      input.error !== undefined && input.error.trim().length > 0
        ? input.error.trim()
        : 'unknown error';
    return {
      title: ttui('tui.notice.mcpConnectFailed.title'),
      detail: ttui('tui.notice.mcpConnectFailed.detail', { name, error: err }),
      status: ttui('tui.notice.mcpConnectFailed.status', { name }),
      coalesceKey: `mcp-status-failed-${name}`,
      color: 'error',
    };
  }
  return undefined;
}

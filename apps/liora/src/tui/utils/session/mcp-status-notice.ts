/**
 * Loop52a — surface MCP connect failures / needs-auth as named TUI notices.
 *
 * Spinner row + status line alone are easy to miss when the transcript is busy.
 * Successful connects stay quiet (no notice spam).
 */

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
      title: 'MCP needs auth',
      detail: `MCP server "${name}" requires authentication before tools are available. Complete OAuth/login for this server, then reconnect or restart the session.`,
      status: `MCP needs auth: ${name}`,
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
      title: 'MCP connect failed',
      detail: `MCP server "${name}" failed to connect: ${err}. Check server config, network, and credentials; retry or remove the server if it is optional.`,
      status: `MCP failed: ${name}`,
      coalesceKey: `mcp-status-failed-${name}`,
      color: 'error',
    };
  }
  return undefined;
}

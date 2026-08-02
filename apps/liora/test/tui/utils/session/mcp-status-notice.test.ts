import { describe, expect, it } from 'vitest';

import { formatMcpStatusNotice } from '../../../../src/tui/utils/session/mcp-status-notice';

describe('formatMcpStatusNotice', () => {
  it('returns undefined for connected/connecting', () => {
    expect(formatMcpStatusNotice({ name: 'a', status: 'connected' })).toBeUndefined();
    expect(formatMcpStatusNotice({ name: 'a', status: 'connecting' })).toBeUndefined();
  });

  it('formats needs-auth', () => {
    const notice = formatMcpStatusNotice({ name: 'github', status: 'needs-auth' });
    expect(notice).toBeDefined();
    expect(notice!.title).toBe('MCP needs auth');
    expect(notice!.detail).toContain('github');
    expect(notice!.coalesceKey).toBe('mcp-status-needs-auth-github');
    expect(notice!.color).toBe('warning');
  });

  it('formats failed with error detail', () => {
    const notice = formatMcpStatusNotice({
      name: 'docs',
      status: 'failed',
      error: 'ECONNREFUSED',
    });
    expect(notice).toBeDefined();
    expect(notice!.title).toBe('MCP connect failed');
    expect(notice!.detail).toContain('ECONNREFUSED');
    expect(notice!.status).toBe('MCP failed: docs');
    expect(notice!.color).toBe('error');
  });
});

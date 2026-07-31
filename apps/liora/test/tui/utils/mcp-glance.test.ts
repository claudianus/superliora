import { describe, expect, it } from 'vitest';

import {
  buildMcpSettingsLines,
  formatMcpLiveSessionLine,
} from '#/tui/utils/mcp/mcp-glance';

describe('mcp glance', () => {
  it('formats live session line with status breakdown and tool count', () => {
    const line = formatMcpLiveSessionLine([
      { name: 'a', transport: 'stdio', status: 'connected', toolCount: 3 },
      { name: 'b', transport: 'http', status: 'disabled', toolCount: 0 },
      { name: 'c', transport: 'stdio', status: 'failed', toolCount: 0 },
    ]);
    expect(line).toContain('3 server(s)');
    expect(line).toContain('1 connected');
    expect(line).toContain('1 disabled');
    expect(line).toContain('1 failed');
    expect(line).toContain('3 tools available');
  });

  it('builds tip panel with live rows and config scopes', () => {
    const lines = buildMcpSettingsLines({
      live: [
        { name: 'filesystem', transport: 'stdio', status: 'connected', toolCount: 2 },
        { name: 'remote', transport: 'http', status: 'pending', toolCount: 0 },
      ],
      config: {
        configured: 2,
        paths: ['user: ~/.superliora/mcp.json (2)'],
      },
    });
    const text = lines.join('\n');
    expect(text).toContain('Live session: 2 server(s)');
    expect(text).toContain('filesystem — connected');
    expect(text).toContain('mcp.json: 2 server(s)');
    expect(text).toContain('/mcp status');
  });

  it('falls back when no session', () => {
    const text = buildMcpSettingsLines({}).join('\n');
    expect(text).toContain('open a session to inspect MCP connection status');
    expect(text).toContain('no entries yet');
  });
});

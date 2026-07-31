import { describe, expect, it } from 'vitest';

import {
  buildExtensionsSessionLiveLines,
  buildExtensionsSettingsLines,
} from '#/tui/utils/agent/extensions-glance';

describe('extensions glance', () => {
  it('buildExtensionsSessionLiveLines surfaces live plugin/skill/MCP counts', () => {
    const lines = buildExtensionsSessionLiveLines({
      plugins: [
        {
          id: 'p1',
          displayName: 'Alpha',
          enabled: true,
          hasErrors: false,
          hookCount: 2,
          skillCount: 1,
          mcpServerCount: 1,
          enabledMcpServerCount: 1,
          commandCount: 0,
          state: 'ok',
          scope: 'user',
          source: 'local-path',
          agentCount: 0,
        },
        {
          id: 'p2',
          displayName: 'Beta',
          enabled: false,
          hasErrors: true,
          hookCount: 0,
          skillCount: 0,
          mcpServerCount: 0,
          enabledMcpServerCount: 0,
          commandCount: 0,
          state: 'error',
          scope: 'user',
          source: 'local-path',
          agentCount: 0,
        },
      ],
      skills: [
        { name: 'write-tui', source: 'builtin', path: '/builtin/write-tui' },
        { name: 'custom', source: 'user', path: '/home/skills/custom' },
      ],
      skillsDisabled: ['custom'],
      mcpServers: [
        { name: 'fs', transport: 'stdio', status: 'connected', toolCount: 4 },
        { name: 'web', transport: 'http', status: 'disabled', toolCount: 0 },
      ],
    }).join('\n');

    expect(lines).toContain('Plugins: 2 installed · 1 enabled · 1 with errors');
    expect(lines).toContain('Skills: 2 in catalog · 1 slash-enabled · 1 disabled');
    expect(lines).toContain('MCP: 2 server(s)');
    expect(lines).toContain('4 tools available');
    expect(lines).toContain('Hooks: 2 from 1 enabled plugin(s)');
  });

  it('buildExtensionsSettingsLines puts session live block before tips', () => {
    const text = buildExtensionsSettingsLines({
      plugins: [],
      skills: [],
      mcpServers: [],
      skillsDisabled: [],
    }).join('\n');
    const liveIdx = text.indexOf('── Session (live)');
    const auditIdx = text.indexOf('── Audit surfaces');
    expect(liveIdx).toBeGreaterThanOrEqual(0);
    expect(auditIdx).toBeGreaterThan(liveIdx);
    expect(text).toContain('Plugins: 0 installed');
    expect(text).toContain('/extensions');
  });

  it('falls back when session is unavailable', () => {
    const lines = buildExtensionsSessionLiveLines({ sessionUnavailable: true }).join('\n');
    expect(lines).toContain('session unavailable');
    expect(lines).not.toContain('installed');
  });

  it('falls back when no session data loaded', () => {
    const lines = buildExtensionsSessionLiveLines({}).join('\n');
    expect(lines).toContain('open a session to count installed plugins');
    expect(lines).toContain('open a session to inspect MCP connection status');
  });
});

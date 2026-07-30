import { describe, expect, it } from 'vitest';

import type { McpServerInfo, PluginSummary, SkillSummary } from '@superliora/sdk';

import {
  EXTENSIONS_TAB_ORDER,
  buildHookRows,
  buildMcpRows,
  buildPluginRows,
  buildSkillRows,
  extensionsTabSummary,
  resolveExtensionsTab,
  rowsForExtensionsTab,
} from '#/tui/utils/agent/extensions-rows';

function plugin(partial: Partial<PluginSummary> & { readonly id: string }): PluginSummary {
  return {
    id: partial.id,
    displayName: partial.displayName ?? partial.id,
    version: partial.version,
    enabled: partial.enabled ?? true,
    state: partial.state ?? 'ok',
    skillCount: partial.skillCount ?? 0,
    mcpServerCount: partial.mcpServerCount ?? 0,
    enabledMcpServerCount: partial.enabledMcpServerCount ?? 0,
    hookCount: partial.hookCount ?? 0,
    commandCount: partial.commandCount ?? 0,
    hasErrors: partial.hasErrors ?? false,
    source: partial.source ?? 'local-path',
  };
}

describe('extensions tab contract', () => {
  it('keeps fixed tab order plugins → hooks → skills → mcp', () => {
    expect([...EXTENSIONS_TAB_ORDER]).toEqual(['plugins', 'hooks', 'skills', 'mcp']);
  });

  it('resolves slash arg aliases', () => {
    expect(resolveExtensionsTab('mcp')).toBe('mcp');
    expect(resolveExtensionsTab('skill')).toBe('skills');
    expect(resolveExtensionsTab(undefined)).toBe('plugins');
  });
});

describe('row builders', () => {
  it('surfaces plugin enablement for audit', () => {
    const rows = buildPluginRows([
      plugin({ id: 'a', displayName: 'Alpha', enabled: true, skillCount: 2, hookCount: 1 }),
      plugin({ id: 'b', enabled: false, hasErrors: true }),
    ]);
    expect(rows[0]!.status).toBe('활성');
    expect(rows[0]!.detail).toContain('훅 1');
    expect(rows[1]!.status).toBe('오류');
  });

  it('aggregates hooks from plugins without always-approve language', () => {
    const rows = buildHookRows([plugin({ id: 'h', hookCount: 3, enabled: true })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toContain('훅 3');
    expect(rows[0]!.detail).toContain('always-approve');
  });

  it('builds skill and mcp rows', () => {
    const skills: SkillSummary[] = [
      {
        name: 'commit',
        description: 'Write a commit',
        path: '/skills/commit',
        source: 'builtin',
      },
    ];
    const mcp: McpServerInfo[] = [
      {
        name: 'docs',
        transport: 'stdio',
        status: 'connected',
        toolCount: 4,
      },
    ];
    expect(buildSkillRows(skills)[0]!.title).toBe('commit');
    expect(buildMcpRows(mcp)[0]!.status).toBe('연결됨');

    const snapshot = {
      plugins: [plugin({ id: 'p', hookCount: 2 })],
      skills,
      mcpServers: mcp,
    };
    expect(rowsForExtensionsTab('skills', snapshot)).toHaveLength(1);
    expect(extensionsTabSummary(snapshot)).toContain('훅 2');
  });
});

import { describe, expect, it } from 'vitest';

import {
  CLAUDE_IMPORT_SYMLINK_GUIDANCE_KO,
  listClaudeSkillSourcesFromEntries,
  mergeMcpServersForImport,
  planSkillsImport,
} from '#/utils/claude/claude-import-apply';
import type { McpServerFileConfig } from '#/utils/mcp/mcp-config-file';

describe('listClaudeSkillSourcesFromEntries', () => {
  it('keeps directories with SKILL.md only', () => {
    const sources = listClaudeSkillSourcesFromEntries('/home/u/.claude/skills', 'global', [
      { name: 'foo', isDirectory: true, hasSkillMd: true },
      { name: 'bar', isDirectory: true, hasSkillMd: false },
      { name: 'baz.md', isDirectory: false, hasSkillMd: false },
      { name: '.hidden', isDirectory: true, hasSkillMd: true },
    ]);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.name).toBe('foo');
    expect(sources[0]!.rootKind).toBe('global');
  });
});

describe('planSkillsImport', () => {
  it('skips existing dest names and duplicate sources', () => {
    const { toCopy, skipped } = planSkillsImport(
      [
        { name: 'a', sourcePath: '/p/.claude/skills/a', rootKind: 'project' },
        { name: 'b', sourcePath: '/p/.claude/skills/b', rootKind: 'project' },
        { name: 'a', sourcePath: '/h/.claude/skills/a', rootKind: 'global' },
      ],
      ['b'],
    );
    expect(toCopy.map((s) => s.name)).toEqual(['a']);
    expect(skipped).toEqual([
      { name: 'b', reason: 'already in ~/.superliora/skills' },
      { name: 'a', reason: 'duplicate source (project wins over global)' },
    ]);
  });
});

describe('mergeMcpServersForImport', () => {
  const stdio = (command: string): McpServerFileConfig => ({
    transport: 'stdio',
    command,
    enabled: true,
  });

  it('adds new servers and skips collisions', () => {
    const result = mergeMcpServersForImport(
      { existing: stdio('old') },
      { existing: stdio('new-cmd'), fresh: stdio('npx') },
    );
    expect(result.added).toEqual(['fresh']);
    expect(result.skipped).toEqual([
      { name: 'existing', reason: 'already in ~/.superliora/mcp.json' },
    ]);
    expect(Object.keys(result.toAdd)).toEqual(['fresh']);
  });
});

describe('CLAUDE_IMPORT_SYMLINK_GUIDANCE_KO', () => {
  it('documents symlink paths without secrets', () => {
    const text = CLAUDE_IMPORT_SYMLINK_GUIDANCE_KO.join('\n');
    expect(text).toContain('ln -s');
    expect(text).toContain('.superliora/skills');
    expect(text).not.toMatch(/sk-|API_KEY=/i);
  });

  it('documents Claude plugin package import path and hot-reload fallback', () => {
    const text = CLAUDE_IMPORT_SYMLINK_GUIDANCE_KO.join('\n');
    expect(text).toContain('.claude-plugin/plugin.json');
    expect(text).toContain('Extensions → Plugins');
    expect(text).toContain('hot-reload');
  });
});

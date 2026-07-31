import { describe, expect, it, vi } from 'vitest';

import { showSkillsSettings } from '#/tui/commands/config/skills-settings';

vi.mock('#/utils/skills/skills-state', () => ({
  loadSkillsState: vi.fn(async () => ({ disabled: ['disabled-skill'] })),
}));

function makeSkillsHost(options: { searchSkillActive?: boolean; hasSession?: boolean } = {}) {
  const transcriptContainer = { addChild: vi.fn() };
  const getTools = vi.fn(async () =>
    options.searchSkillActive === true
      ? [{ name: 'SearchSkill', active: true }]
      : [{ name: 'Grep', active: true }],
  );
  const listSkills = vi.fn(async () => [
    { name: 'write-tui', description: 'TUI skill', source: 'builtin', path: '/builtin/write-tui' },
    { name: 'custom', description: 'User skill', source: 'user', path: '/home/skills/custom' },
    { name: 'disabled-skill', description: 'Off', source: 'project', path: '/proj/disabled' },
  ]);
  return {
    harness: { homeDir: '/home/.superliora' },
    state: {
      transcriptContainer,
      appState: {},
      renderer: { invalidateFrame: vi.fn() },
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => ({ listSkills, getTools })),
  } as never;
}

describe('skills settings', () => {
  it('mounts read-only skills panel with live catalog and SearchSkill tips', async () => {
    const host = makeSkillsHost({ searchSkillActive: true });
    showSkillsSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
    expect(lines).toContain('Skills (read-only)');
    expect(lines).toContain('Installed skills: 3 in catalog · 2 slash-enabled · 1 disabled');
    expect(lines).toContain('Catalog sources (live): builtin 1 · user 1 · project 1');
    expect(lines).toContain('SearchSkill');
    expect(lines).toContain('metadata.risk=high');
    expect(host.requireSession().listSkills).toHaveBeenCalled();
  });

  it('works without session', async () => {
    const host = makeSkillsHost({ hasSession: false });
    showSkillsSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    expect(panel.buildLines(1).join('\n')).toContain('open a session to count catalog');
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildSkillsSettingsLines,
  summarizeSkillsCatalog,
} from '#/tui/utils/skills/skills-glance';

describe('skills glance live catalog', () => {
  it('summarizes installed, enabled, and source breakdown', () => {
    const catalog = summarizeSkillsCatalog(
      [
        { name: 'write-tui', source: 'builtin' },
        { name: 'custom', source: 'user' },
        { name: 'proj', source: 'project' },
      ],
      ['custom'],
    );
    expect(catalog).toEqual({
      installedCount: 3,
      enabledCount: 2,
      disabledCount: 1,
      bySource: { builtin: 1, user: 1, project: 1 },
    });
  });

  it('surfaces live catalog counts when wired', () => {
    const lines = buildSkillsSettingsLines({
      homeDir: '/home/.superliora',
      catalog: {
        installedCount: 5,
        enabledCount: 4,
        disabledCount: 1,
        bySource: { builtin: 3, user: 2 },
      },
      searchSkillActive: true,
    }).join('\n');
    expect(lines).toContain('Installed skills: 5 in catalog · 4 slash-enabled · 1 disabled');
    expect(lines).toContain('Catalog sources (live): builtin 3 · user 2');
    expect(lines).toContain('SearchSkill: active in this session');
  });

  it('falls back when session catalog is absent', () => {
    const lines = buildSkillsSettingsLines({
      homeDir: '/home/.superliora',
    }).join('\n');
    expect(lines).toContain('open a session to count catalog');
    expect(lines).not.toContain('Catalog sources (live)');
  });
});

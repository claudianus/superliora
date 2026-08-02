import { describe, expect, it, vi } from 'vitest';

import {
  SKILLS_MANAGE_TIP,
  SKILLS_RISK_FILTER_TIP,
  SKILLS_SEARCH_SKILL_TIP,
  SKILLS_TRACE_SKILL_TIP,
  showSkillsSettings,
} from '#/tui/commands/config/skills/skills-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

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
      centerModalStack: [] as readonly unknown[],
      appState: {},
      renderer: { invalidateFrame: vi.fn() },
    },
    requireSession:
      options.hasSession === false
        ? vi.fn(() => {
            throw new Error('no session');
          })
        : vi.fn(() => ({ listSkills, getTools })),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
}

function selectSkillsAction(host: SlashCommandHost, value: string): void {
  const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ChoicePickerComponent
    | undefined;
  expect(picker).toBeDefined();
  (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
}

describe('skills settings tips', () => {
  it('exports SearchSkill, risk filter, Trace→Skill, and manage tips (glance copy, not menu rows)', () => {
    expect(SKILLS_SEARCH_SKILL_TIP).toContain('SearchSkill');
    expect(SKILLS_RISK_FILTER_TIP).toContain('metadata.risk=high');
    expect(SKILLS_TRACE_SKILL_TIP).toContain('Trace→Skill');
    expect(SKILLS_MANAGE_TIP).toContain('Extensions → Skills');
  });
});

describe('showSkillsSettings', () => {
  it('mounts ChoicePicker with status, manage, and tip actions — tip-free', () => {
    const host = makeSkillsHost();
    showSkillsSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
      .options;
    expect(options.map((o) => o.value)).toEqual([
      'status',
      'manage',
    ]);
    expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
  });

  it('routes manage to Extensions hub', () => {
    const host = makeSkillsHost();
    showSkillsSettings(host);
    selectSkillsAction(host, 'manage');
    expect(host.mountCenterModal).toHaveBeenCalledTimes(2);
    const hub = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(hub).toBeDefined();
    const title = (hub as unknown as { opts: { title?: string } }).opts.title;
    expect(title).toBe('Extensions');
  });

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
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
    selectSkillsAction(host, 'status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('open a session to count catalog');
  });
});

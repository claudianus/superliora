import { describe, it, expect } from 'vitest';

import type { LioraSlashCommand } from '#/tui/commands/index';
import { BUILTIN_SLASH_COMMANDS, slashCommandsForHelp } from '#/tui/commands/hub/registry';
import {
  ADVANCED_HELP_INTRO,
  advancedKeyboardShortcuts,
  HelpPanelComponent,
} from '#/tui/components/dialogs/help/help-panel';
import { KEYMAP_ALL } from '#/tui/keymap';

function cmd(name: string, description: string, aliases: string[] = []): LioraSlashCommand {
  return {
    name,
    aliases,
    description,
  };
}

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('HelpPanelComponent', () => {
  it('renders keyboard shortcuts from keymap + slash commands', () => {
    const panel = new HelpPanelComponent({
      commands: [cmd('exit', 'Exit', ['quit', 'q'])],
      onClose: () => {},
    });
    const out = strip(panel.render(120).join('\n'));
    expect(out).toMatch(/help/);
    expect(out).toMatch(/Keyboard shortcuts/);
    expect(out).toMatch(/Ctrl-K/);
    expect(out).toMatch(/Open the Command Hub menu/);
    expect(out).toMatch(/Shift-Tab/);
    expect(out).toMatch(/Switch Build \/ Ask mode/);
    expect(out).toMatch(/Ctrl-S/);
    expect(out).toMatch(/Ctrl-B/);
    expect(out).toMatch(/Ctrl-X/);
    expect(out).toMatch(/Shift-Enter/);
    expect(out).toMatch(/session undo/);
    expect(out).not.toMatch(/Ctrl-Shift-Tab/);
    expect(out).toMatch(/Ctrl-O/);
    expect(out).toMatch(/Cycle transcript density/);
    expect(out).toMatch(/Ctrl-T/);
    expect(out).not.toMatch(/Ctrl-Y/);
    expect(out).toMatch(/Slash commands/);
    expect(out).toMatch(/\/exit \(\/quit, \/q\)/);
    expect(out).toMatch(/Exit/);
  });

  it('preserves provided command order while keeping skill commands last', () => {
    const panel = new HelpPanelComponent({
      commands: [
        cmd('zebra', 'Z'),
        cmd('skill:bravo', 'B'),
        cmd('alpha', 'A'),
        cmd('mcp-config', 'M'),
      ],
      maxVisible: 200,
      onClose: () => {},
    });
    const out = strip(panel.render(120).join('\n'));
    const alphaIdx = out.indexOf('/alpha');
    const mcpConfigIdx = out.indexOf('/mcp-config');
    const zebraIdx = out.indexOf('/zebra');
    const skillBravoIdx = out.indexOf('/skill:bravo');
    expect(zebraIdx).toBeGreaterThan(-1);
    expect(zebraIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(mcpConfigIdx);
    expect(zebraIdx).toBeLessThan(skillBravoIdx);
    expect(mcpConfigIdx).toBeLessThan(skillBravoIdx);
  });

  it('floats plan, goal, then jobs to the front of the command list', () => {
    const panel = new HelpPanelComponent({
      commands: [cmd('zebra', 'Z'), cmd('jobs', 'J'), cmd('goal', 'G'), cmd('plan', 'P')],
      maxVisible: 200,
      onClose: () => {},
    });
    const out = strip(panel.render(120).join('\n'));
    const planIdx = out.indexOf('/plan');
    const goalIdx = out.indexOf('/goal');
    const jobsIdx = out.indexOf('/jobs');
    const zebraIdx = out.indexOf('/zebra');
    expect(planIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(goalIdx);
    expect(goalIdx).toBeLessThan(jobsIdx);
    expect(jobsIdx).toBeLessThan(zebraIdx);
  });

  it('renders the advanced intro and section title when provided', () => {
    const panel = new HelpPanelComponent({
      commands: [cmd('plan', 'Steer Plan mode')],
      intro: ADVANCED_HELP_INTRO,
      shortcuts: advancedKeyboardShortcuts(),
      commandSectionTitle: 'Advanced controls',
      maxVisible: 200,
      onClose: () => {},
    });
    const out = strip(panel.render(120).join('\n'));
    expect(out).toContain(ADVANCED_HELP_INTRO.split('\n')[0]!);
    expect(out).toMatch(/Advanced controls/);
    expect(out).toMatch(/\/plan/);
    expect(out).not.toMatch(/Ctrl-Shift-Tab/);
  });

  it('keeps plan and goal reachable in the windowed advanced help panel', () => {
    const advancedPanel = new HelpPanelComponent({
      commands: slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'advanced'),
      intro: ADVANCED_HELP_INTRO,
      shortcuts: advancedKeyboardShortcuts(),
      commandSectionTitle: 'Advanced controls',
      maxVisible: 24,
      onClose: () => {},
    });
    const advancedOut = strip(advancedPanel.render(120).join('\n'));
    expect(advancedOut).toMatch(/\/plan/);
    expect(advancedOut).toMatch(/Advanced controls/);
  });

  it('shares the same shortcut rows as KEYMAP_ALL', () => {
    expect(advancedKeyboardShortcuts().map((row) => row.keys)).toEqual(
      KEYMAP_ALL.map((binding) => binding.key),
    );
  });
});

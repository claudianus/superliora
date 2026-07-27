import { describe, it, expect } from 'vitest';

import type { LioraSlashCommand } from '#/tui/commands/index';
import { BUILTIN_SLASH_COMMANDS, slashCommandsForHelp } from '#/tui/commands/registry';
import {
  ADVANCED_HELP_INTRO,
  advancedKeyboardShortcuts,
  HelpPanelComponent,
} from '#/tui/components/dialogs/help-panel';
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
    expect(out).toMatch(/Toggle Ultrawork mode/);
    expect(out).toMatch(/Ctrl-S/);
    expect(out).toMatch(/Ctrl-B/);
    expect(out).toMatch(/Ctrl-X/);
    expect(out).toMatch(/Shift-Enter/);
    expect(out).toMatch(/session undo/);
    expect(out).not.toMatch(/Ctrl-Shift-Tab/);
    expect(out).not.toMatch(/Ctrl-O/);
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

  it('renders the advanced Ultrawork help framing when provided', () => {
    const panel = new HelpPanelComponent({
      commands: [
        cmd(
          'ultrawork',
          'Run Ultrawork: UltraPlan interview, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn',
          ['uw'],
        ),
      ],
      intro: ADVANCED_HELP_INTRO,
      shortcuts: advancedKeyboardShortcuts(),
      commandSectionTitle: 'Advanced Ultrawork controls',
      onClose: () => {},
    });
    const out = strip(panel.render(120).join('\n'));
    expect(out).toMatch(
      /Ultrawork is one workflow: UltraPlan, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn\./,
    );
    expect(out).toMatch(/Shift-Tab toggles Ultrawork\/off/);
    expect(out).not.toMatch(/Ctrl-Shift-Tab/);
    expect(out).toMatch(/Advanced Ultrawork controls/);
    expect(out).toMatch(/\/ultrawork \(\/uw\)/);
  });

  it('keeps default help simple while advanced help exposes Ultra access paths', () => {
    const primaryPanel = new HelpPanelComponent({
      commands: slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'primary'),
      maxVisible: 200,
      onClose: () => {},
    });
    const primaryOut = strip(primaryPanel.render(160).join('\n'));

    expect(primaryOut).toMatch(/Shift-Tab toggles Ultrawork and off\./);
    expect(primaryOut).toMatch(/\/theme/);
    expect(primaryOut).toMatch(/\/plan/);
    expect(primaryOut).toMatch(/\/swarm/);
    expect(primaryOut).not.toMatch(/\/ultrawork/);

    const advancedPanel = new HelpPanelComponent({
      commands: slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'advanced'),
      intro: ADVANCED_HELP_INTRO,
      shortcuts: advancedKeyboardShortcuts(),
      commandSectionTitle: 'Advanced Ultrawork controls',
      maxVisible: 200,
      onClose: () => {},
    });
    const advancedOut = strip(advancedPanel.render(160).join('\n'));

    expect(advancedOut).toMatch(
      /Ultrawork is one workflow: UltraPlan, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn\./,
    );
    expect(advancedOut).toMatch(/Shift-Tab toggles Ultrawork\/off/);
    expect(advancedOut).toMatch(/Advanced Ultrawork controls/);
    expect(advancedOut).toMatch(/\/plan/);
    expect(advancedOut).toMatch(/\/ultrawork \(\/uw\)/);
  });

  it('keeps Ultrawork steering controls reachable in the windowed advanced help panel', () => {
    const advancedPanel = new HelpPanelComponent({
      commands: slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'advanced'),
      intro: ADVANCED_HELP_INTRO,
      shortcuts: advancedKeyboardShortcuts(),
      commandSectionTitle: 'Advanced Ultrawork controls',
      maxVisible: 24,
      onClose: () => {},
    });
    const advancedOut = strip(advancedPanel.render(120).join('\n'));
    expect(advancedOut).toMatch(/\/plan/);
    expect(advancedOut).toMatch(/\/ultrawork/);
  });

  it('shares the same shortcut rows as KEYMAP_ALL', () => {
    expect(advancedKeyboardShortcuts().map((row) => row.keys)).toEqual(
      KEYMAP_ALL.map((binding) => binding.key),
    );
  });
});

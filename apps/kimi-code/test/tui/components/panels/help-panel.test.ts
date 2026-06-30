import { describe, it, expect, vi } from 'vitest';

import type { KimiSlashCommand } from '#/tui/commands/index';
import { BUILTIN_SLASH_COMMANDS, slashCommandsForHelp } from '#/tui/commands/registry';
import {
  ADVANCED_HELP_INTRO,
  ADVANCED_KEYBOARD_SHORTCUTS,
  HelpPanelComponent,
} from '#/tui/components/dialogs/help-panel';

function cmd(name: string, description: string, aliases: string[] = []): KimiSlashCommand {
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
  it('renders keyboard shortcuts + slash commands sections', () => {
    const panel = new HelpPanelComponent({
      commands: [cmd('exit', 'Exit', ['quit', 'q'])],
      onClose: () => {},
    });
    const out = strip(panel.render(120).join('\n'));
    expect(out).toMatch(/help/);
    expect(out).toMatch(/Describe task; Ultrawork runs the full workflow, then verifies\./);
    expect(out).toMatch(/Advanced controls are optional\./);
    expect(out).not.toMatch(/helpers/);
    expect(out).toMatch(/Keyboard shortcuts/);
    expect(out).toMatch(/Shift-Tab/);
    expect(out).toMatch(/Steer Ultrawork plan/);
    expect(out).not.toMatch(/Toggle Ultrawork planning/);
    expect(out).not.toMatch(/Ctrl-Shift-Tab/);
    expect(out).not.toMatch(/Steer UltraPlan/);
    expect(out).toMatch(/Ctrl-O/);
    expect(out).toMatch(/Shift-Enter \/ Ctrl-J/);
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
        cmd('ultrawork', 'Run Ultrawork: auto-link UltraPlan, UltraGoal, UltraSwarm, Verify', ['uw']),
      ],
      intro: ADVANCED_HELP_INTRO,
      shortcuts: ADVANCED_KEYBOARD_SHORTCUTS,
      commandSectionTitle: 'Advanced Ultrawork controls',
      onClose: () => {},
    });
    const out = strip(panel.render(120).join('\n'));
    expect(out).toMatch(/Ultrawork is one workflow: UltraPlan, UltraGoal, UltraSwarm, Verify\./);
    expect(out).toMatch(/Plain tasks start it automatically/);
    expect(out).toMatch(/Controls below are optional steering/);
    expect(out).toMatch(/Ctrl-Shift-Tab/);
    expect(out).toMatch(/Steer UltraPlan/);
    expect(out).toMatch(/Advanced Ultrawork controls/);
    expect(out).toMatch(/\/ultrawork \(\/uw\)/);
    expect(out).toMatch(/auto-link UltraPlan, UltraGoal, UltraSwarm, Verify/);
  });

  it('keeps default help simple while advanced help exposes Ultra access paths', () => {
    const primaryPanel = new HelpPanelComponent({
      commands: slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'primary'),
      maxVisible: 200,
      onClose: () => {},
    });
    const primaryOut = strip(primaryPanel.render(160).join('\n'));

    expect(primaryOut).toMatch(/Describe task; Ultrawork runs the full workflow, then verifies\./);
    expect(primaryOut).toMatch(/\/theme/);
    expect(primaryOut).not.toMatch(/\/plan/);
    expect(primaryOut).not.toMatch(/\/swarm/);
    expect(primaryOut).not.toMatch(/\/ultrawork/);
    expect(primaryOut).not.toMatch(/UltraPlan, UltraGoal, UltraSwarm, Verify/);

    const advancedPanel = new HelpPanelComponent({
      commands: slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'advanced'),
      intro: ADVANCED_HELP_INTRO,
      shortcuts: ADVANCED_KEYBOARD_SHORTCUTS,
      commandSectionTitle: 'Advanced Ultrawork controls',
      maxVisible: 200,
      onClose: () => {},
    });
    const advancedOut = strip(advancedPanel.render(160).join('\n'));

    expect(advancedOut).toMatch(/Ultrawork is one workflow: UltraPlan, UltraGoal, UltraSwarm, Verify\./);
    expect(advancedOut).toMatch(/Plain tasks start it automatically/);
    expect(advancedOut).toMatch(/Advanced Ultrawork controls/);
    expect(advancedOut).toMatch(/\/plan/);
    expect(advancedOut).toMatch(/Advanced steering for UltraPlan; Ultrawork auto-enables it/);
    expect(advancedOut).toMatch(/\/swarm/);
    expect(advancedOut).toMatch(/Advanced steering for UltraSwarm; Ultrawork auto-arms it/);
    expect(advancedOut).toMatch(/\/ultrawork \(\/uw\)/);
    expect(advancedOut).toMatch(/Run Ultrawork: auto-link UltraPlan, UltraGoal, UltraSwarm, Verify/);
  });

  it('Escape fires onClose', () => {
    const onClose = vi.fn();
    const panel = new HelpPanelComponent({
      commands: [],
      onClose,
    });
    panel.handleInput('\u001B'); // Esc
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('q / Enter also close the panel', () => {
    const onClose = vi.fn();
    const panel = new HelpPanelComponent({
      commands: [],
      onClose,
    });
    panel.handleInput('q');
    panel.handleInput('\r');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('clips to maxVisible with a "showing X-Y of Z" tail', () => {
    const many = Array.from({ length: 30 }, (_, i) => cmd(`cmd${String(i)}`, `Desc ${String(i)}`));
    const panel = new HelpPanelComponent({
      commands: many,
      onClose: () => {},
      maxVisible: 6,
    });
    const out = strip(panel.render(80).join('\n'));
    expect(out).toMatch(/showing 1-6 of/);
  });

  it('arrow keys shift the scroll window', () => {
    const many = Array.from({ length: 30 }, (_, i) => cmd(`cmd${String(i)}`, 'd'));
    const panel = new HelpPanelComponent({
      commands: many,
      onClose: () => {},
      maxVisible: 6,
    });
    panel.handleInput('\u001B[B'); // ↓
    panel.handleInput('\u001B[B'); // ↓
    const out = strip(panel.render(80).join('\n'));
    expect(out).toMatch(/showing 3-8 of/);
    panel.handleInput('\u001B[A'); // ↑
    const out2 = strip(panel.render(80).join('\n'));
    expect(out2).toMatch(/showing 2-7 of/);
  });
});

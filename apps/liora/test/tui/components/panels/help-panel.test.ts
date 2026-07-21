import { describe, it, expect, vi } from 'vitest';

import type { LioraSlashCommand } from '#/tui/commands/index';
import { BUILTIN_SLASH_COMMANDS, slashCommandsForHelp } from '#/tui/commands/registry';
import {
  ADVANCED_HELP_INTRO,
  advancedKeyboardShortcuts,
  HelpPanelComponent,
} from '#/tui/components/dialogs/help-panel';

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
  it('renders keyboard shortcuts + slash commands sections', () => {
    const panel = new HelpPanelComponent({
      commands: [cmd('exit', 'Exit', ['quit', 'q'])],
      onClose: () => {},
    });
    const out = strip(panel.render(120).join('\n'));
    expect(out).toMatch(/help/);
    expect(out).toMatch(/Shift-Tab toggles Ultrawork and off\./);
    expect(out).toMatch(/\/status shows media, web\/Context7, ZDR, LioraBench readiness\./);
    expect(out).toMatch(/Normal messages stay lightweight unless Ultrawork is on\./);
    expect(out).not.toMatch(/helpers/);
    expect(out).toMatch(/Keyboard shortcuts/);
    expect(out).toMatch(/Shift-Tab/);
    expect(out).toMatch(/Toggle Ultrawork \/ off/);
    expect(out).not.toMatch(/Steer Ultrawork plan/);
    expect(out).not.toMatch(/Ctrl-Shift-Tab/);
    expect(out).not.toMatch(/Steer UltraPlan/);
    expect(out).toMatch(/Ctrl-O/);
    expect(out).toMatch(/Ctrl-B/);
    expect(out).toMatch(/Ctrl-X/);
    expect(out).toMatch(/\/tasks/);
    expect(out).toMatch(/Shift-Enter \/ Ctrl-J/);
    expect(out).toMatch(/Esc Esc/);
    expect(out).toMatch(/Open undo selector/);
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
        cmd('ultrawork', 'Run Ultrawork: UltraPlan interview, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn', ['uw']),
      ],
      intro: ADVANCED_HELP_INTRO,
      shortcuts: advancedKeyboardShortcuts(),
      commandSectionTitle: 'Advanced Ultrawork controls',
      onClose: () => {},
    });
    const out = strip(panel.render(120).join('\n'));
    expect(out).toMatch(/Ultrawork is one workflow: UltraPlan, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn\./);
    expect(out).toMatch(/Shift-Tab toggles Ultrawork\/off/);
    expect(out).toMatch(/explicit steering controls below/);
    expect(out).toMatch(/Ctrl-Shift-Tab/);
    expect(out).toMatch(/Steer UltraPlan/);
    expect(out).toMatch(/Esc Esc/);
    expect(out).toMatch(/Open undo selector/);
    expect(out).toMatch(/Advanced Ultrawork controls/);
    expect(out).toMatch(/\/ultrawork \(\/uw\)/);
    expect(out).toMatch(/UltraPlan interview, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn/);
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
    expect(primaryOut).not.toMatch(/UltraPlan, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn/);

    const advancedPanel = new HelpPanelComponent({
      commands: slashCommandsForHelp(BUILTIN_SLASH_COMMANDS, 'advanced'),
      intro: ADVANCED_HELP_INTRO,
      shortcuts: advancedKeyboardShortcuts(),
      commandSectionTitle: 'Advanced Ultrawork controls',
      maxVisible: 200,
      onClose: () => {},
    });
    const advancedOut = strip(advancedPanel.render(160).join('\n'));

    expect(advancedOut).toMatch(/Ultrawork is one workflow: UltraPlan, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn\./);
    expect(advancedOut).toMatch(/Shift-Tab toggles Ultrawork\/off/);
    expect(advancedOut).toMatch(/Advanced Ultrawork controls/);
    expect(advancedOut).toMatch(/\/plan/);
    expect(advancedOut).toMatch(/\/ultraplan \(\/up\)/);
    expect(advancedOut).toMatch(/Structured plan pipeline: research → interview → design → review → write with gap analysis/);
    expect(advancedOut).toMatch(/\/ultraswarm \(\/us\)/);
    expect(advancedOut).toMatch(/Specialist delegation: lane analysis, coverage matrix, ENGAGE\/DEFER decision/);
    expect(advancedOut).toMatch(/\/ultrawork \(\/uw\)/);
    expect(advancedOut).toMatch(/Run Ultrawork: UltraPlan interview, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn/);
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

    // The first 24-row window surfaces the /plan steering hint and /ultrawork.
    expect(advancedOut).toMatch(/\/plan/);
    expect(advancedOut).toMatch(/\/ultrawork \(\/uw\)/);
    expect(advancedOut).toMatch(/showing 1-24 of 32/);

    // /ultraswarm sits just past the 24-row window; scroll it into view.
    for (let i = 0; i < 10; i++) {
      advancedPanel.handleInput('\u001B[B'); // ↓
    }
    const scrolledOut = strip(advancedPanel.render(120).join('\n'));
    expect(scrolledOut).toMatch(/\/ultraswarm \(\/us\)/);
    expect(scrolledOut).toMatch(/Specialist delegation: lane analysis, coverage matrix, ENGAGE\/DEFER decision/);
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

/**
 * HelpPanel — modal `/help` display. Lists keyboard shortcuts, slash
 * commands (with aliases + descriptions) in colour-coded sections.
 *
 * Mirrors the container-replacement pattern used by SessionPicker /
 * ApprovalPanel: host mounts the panel into `editorContainer`, picks
 * it as the focused component, and tears it down on the `onClose`
 * callback (fired on Esc / Enter / q).
 */

import {
  Container,
  matchesKey,
  Key,
  type Focusable,
  renderRendererScrollablePanelChromeRows,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { renderPremiumHeadline } from '#/tui/utils/appearance-effects';
import { ttui } from '#/tui/utils/tui-i18n';

export interface KeyboardShortcut {
  readonly keys: string;
  readonly description: string;
}

export interface HelpPanelCommand {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
}

/** Static list — keep in sync with the global editor bindings. */
function ultraworkPlanningShortcut(): KeyboardShortcut {
  return {
    keys: 'Shift-Tab',
    description: ttui('tui.help.shortcut.shiftTab'),
  };
}

export function defaultKeyboardShortcuts(): readonly KeyboardShortcut[] {
  return [
    ultraworkPlanningShortcut(),
    { keys: 'Ctrl-G', description: ttui('tui.help.shortcut.ctrlG') },
    { keys: 'Ctrl-O', description: ttui('tui.help.shortcut.ctrlO') },
    { keys: 'Ctrl-B', description: ttui('tui.help.shortcut.ctrlB') },
    { keys: 'Ctrl-T', description: ttui('tui.help.shortcut.ctrlT') },
    { keys: 'Ctrl-S', description: ttui('tui.help.shortcut.ctrlS') },
    { keys: 'Shift-Enter / Ctrl-J', description: ttui('tui.help.shortcut.newline') },
    { keys: 'Ctrl-C', description: ttui('tui.help.shortcut.ctrlC') },
    { keys: 'Ctrl-D', description: ttui('tui.help.shortcut.ctrlD') },
    { keys: 'Esc', description: ttui('tui.help.shortcut.esc') },
    { keys: 'Esc Esc', description: ttui('tui.help.shortcut.escEsc') },
    { keys: '↑ / ↓', description: ttui('tui.help.shortcut.history') },
    { keys: 'Enter', description: ttui('tui.help.shortcut.enter') },
  ];
}

export function advancedKeyboardShortcuts(): readonly KeyboardShortcut[] {
  const defaults = defaultKeyboardShortcuts();
  return [
    ultraworkPlanningShortcut(),
    { keys: 'Ctrl-Shift-Tab', description: ttui('tui.help.shortcut.ctrlShiftTab') },
    ...defaults.slice(1),
  ];
}

/** @deprecated Prefer defaultKeyboardShortcuts() for live locale. */
export const DEFAULT_KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = defaultKeyboardShortcuts();
/** @deprecated Prefer advancedKeyboardShortcuts() for live locale. */
export const ADVANCED_KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = advancedKeyboardShortcuts();

export function defaultHelpIntro(): string {
  return ttui('tui.help.intro.default');
}

export function advancedHelpIntro(): string {
  return ttui('tui.help.intro.advanced');
}

/** Live intro helpers — prefer these over frozen constants so locale applies after setCliLocale. */
export const ADVANCED_HELP_INTRO = advancedHelpIntro();
const DEFAULT_HELP_INTRO = defaultHelpIntro();

export interface HelpPanelOptions {
  readonly commands: readonly HelpPanelCommand[];
  readonly shortcuts?: readonly KeyboardShortcut[];
  readonly onClose: () => void;
  readonly intro?: string;
  readonly commandSectionTitle?: string;
  /** Terminal height — used to decide whether to show the hint tail. */
  readonly maxVisible?: number;
}

export class HelpPanelComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: HelpPanelOptions;
  private scrollTop = 0;

  constructor(opts: HelpPanelOptions) {
    super();
    this.opts = opts;
  }

  handleInput(data: string): void {
    const printable = printableChar(data);
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.enter) ||
      printable === 'q' ||
      printable === 'Q'
    ) {
      this.opts.onClose();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.scrollTop = Math.max(0, this.scrollTop - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.scrollTop += 1; // render clamps
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.scrollTop = Math.max(0, this.scrollTop - 10);
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scrollTop += 10;
    }
  }

  override render(width: number): string[] {
    const accent = (text: string) => currentTheme.fg('primary', text);
    const dim = (text: string) => currentTheme.fg('textDim', text);
    const muted = (text: string) => currentTheme.fg('textMuted', text);
    const kbdColor = (text: string) => currentTheme.fg('warning', text);
    const slashColor = (text: string) => currentTheme.fg('primary', text);

    const shortcuts = this.opts.shortcuts ?? defaultKeyboardShortcuts();
    const kbdWidth = Math.max(8, ...shortcuts.map((s) => s.keys.length));
    const sortedCmds = this.opts.commands
      .map((command, index) => ({ command, index }))
      .toSorted(compareSlashCommandsForDisplay)
      .map(({ command }) => command);
    const cmdLabels = sortedCmds.map((c) => {
      const aliases = c.aliases.length > 0 ? ` (${c.aliases.map((a) => '/' + a).join(', ')})` : '';
      return `/${c.name}${aliases}`;
    });
    const cmdWidth = Math.max(12, ...cmdLabels.map((l) => l.length));
    const introLines = (this.opts.intro ?? defaultHelpIntro()).split('\n');
    const commandSectionTitle = this.opts.commandSectionTitle ?? 'Slash commands';
    const body: string[] = [
      // Greeting
      ...introLines.map((line) => `  ${dim(line)}`),
      '',
      // Section: keyboard shortcuts
      `  ${currentTheme.bold('Keyboard shortcuts')}`,
      ...shortcuts.map((s) => `    ${kbdColor(s.keys.padEnd(kbdWidth))}  ${dim(s.description)}`),
      '',
      // Section: slash commands
      `  ${currentTheme.bold(commandSectionTitle)}`,
      ...sortedCmds.map((cmd, i) => {
        const label = cmdLabels[i] ?? `/${cmd.name}`;
        return `    ${slashColor(label.padEnd(cmdWidth))}  ${dim(cmd.description)}`;
      }),
      '',
    ];

    const maxVisible = Math.max(5, this.opts.maxVisible ?? 24);
    const projection = renderRendererScrollablePanelChromeRows({
      width,
      title: ' help ',
      hint: ' Esc / Enter / Q cancel · ↑↓ scroll',
      body,
      viewportRows: maxVisible,
      scrollTop: this.scrollTop,
      footerTopGap: false,
      dividerStyle: accent,
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'help:title'),
      hintStyle: muted,
      scrollFooter: (window) =>
        window.hasOverflow
          ? ` showing ${String(window.lineFrom)}-${String(window.lineTo)} of ${String(window.contentRows)}`
          : undefined,
      scrollFooterStyle: muted,
    });
    this.scrollTop = projection.scrollTop;
    return [...projection.rows];
  }
}

function compareSlashCommandsForDisplay(
  a: { readonly command: HelpPanelCommand; readonly index: number },
  b: { readonly command: HelpPanelCommand; readonly index: number },
): number {
  return (
    getSlashCommandDisplayGroup(a.command.name) - getSlashCommandDisplayGroup(b.command.name) ||
    a.index - b.index
  );
}

function getSlashCommandDisplayGroup(name: string): number {
  if (name === 'plan') return -3;
  if (name === 'swarm') return -2;
  if (name === 'ultrawork') return -1;
  return name.startsWith('skill:') ? 1 : 0;
}

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
const ULTRAWORK_PLANNING_SHORTCUT: KeyboardShortcut = {
  keys: 'Shift-Tab',
  description: 'Toggle Ultrawork / off',
};

export const DEFAULT_KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  ULTRAWORK_PLANNING_SHORTCUT,
  { keys: 'Ctrl-G', description: 'Edit in external editor ($VISUAL / $EDITOR)' },
  { keys: 'Ctrl-O', description: 'Toggle tool output expansion (recent turns)' },
  { keys: 'Ctrl-B', description: 'Background a long-running shell task · /tasks' },
  { keys: 'Ctrl-T', description: 'Expand / collapse the todo list (when truncated)' },
  { keys: 'Ctrl-S', description: 'Steer — inject a follow-up during streaming' },
  { keys: 'Shift-Enter / Ctrl-J', description: 'Insert newline' },
  { keys: 'Ctrl-C', description: 'Interrupt stream / clear input' },
  { keys: 'Ctrl-D', description: 'Exit (on empty input)' },
  { keys: 'Esc', description: 'Close dialogs / interrupt streaming' },
  { keys: 'Esc Esc', description: 'Open undo selector (idle prompt)' },
  { keys: '↑ / ↓', description: 'Browse input history' },
  { keys: 'Enter', description: 'Submit' },
];
export const ADVANCED_KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  ULTRAWORK_PLANNING_SHORTCUT,
  { keys: 'Ctrl-Shift-Tab', description: 'Steer UltraPlan' },
  ...DEFAULT_KEYBOARD_SHORTCUTS.slice(1),
];
const DEFAULT_HELP_INTRO =
  'Shift-Tab toggles Ultrawork and off.\n/status shows media, web/Context7, ZDR, LioraBench readiness.\nNormal messages stay lightweight unless Ultrawork is on.';
export const ADVANCED_HELP_INTRO =
  'Ultrawork is one workflow: UltraPlan, UltraGoal, Research, Swarm decision, Integrate, Verify, Learn.\nShift-Tab toggles Ultrawork/off; /plan and Ctrl-Shift-Tab are explicit steering controls below.\n/status shows media, web/Context7, ZDR, LioraBench readiness.';

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

    const shortcuts = this.opts.shortcuts ?? DEFAULT_KEYBOARD_SHORTCUTS;
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
    const introLines = (this.opts.intro ?? DEFAULT_HELP_INTRO).split('\n');
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

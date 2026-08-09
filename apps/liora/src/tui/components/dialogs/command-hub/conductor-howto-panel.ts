/**
 * Short "How Conductor works" overlay (Hub → Start).
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';

export interface ConductorHowtoPanelOptions {
  readonly onClose: () => void;
  /** Persist conductor_howto_seen and close. */
  readonly onSkipForever: () => void;
  readonly alreadySeen?: boolean;
}

const HOWTO_LINES = [
  '1. Type a task in chat — Conductor creates a Job.',
  '2. Workers run in the background (Worker Dock /agents).',
  '3. Alt+J opens the Job Deck to watch progress live.',
  '4. Answer needs_user cards when a Job asks you.',
  '5. Land/merge when trust checks pass.',
  '6. /jobs lists jobs · /agents cycles the dock.',
  '7. Tip: describe the outcome; Conductor staffs the rest.',
  '8. Fork session = new chat branch; Job worktree = isolated git tree for that Job.',
] as const;

export class ConductorHowtoPanelComponent extends Container implements Focusable {
  focused = false;

  private readonly onClose: () => void;
  private readonly onSkipForever: () => void;
  private readonly alreadySeen: boolean;

  constructor(opts: ConductorHowtoPanelOptions) {
    super();
    this.onClose = opts.onClose;
    this.onSkipForever = opts.onSkipForever;
    this.alreadySeen = opts.alreadySeen === true;
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.ctrl('c'))
    ) {
      this.onClose();
      return;
    }
    const ch = printableChar(data);
    if (!this.alreadySeen && (ch === 's' || ch === 'S')) {
      this.onSkipForever();
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const body = HOWTO_LINES.map((line) => theme.fg('text', `  ${line}`));
    body.push('');
    if (this.alreadySeen) {
      body.push(theme.fg('textMuted', '  Esc / Enter close'));
    } else {
      body.push(theme.fg('textMuted', '  [s] Don\'t show again · Esc / Enter close'));
    }
    return renderRendererPanelChromeRows({
      width,
      title: ' How Conductor works',
      hint: this.alreadySeen ? ' Esc / Enter close' : ' [s] skip forever · Esc / Enter close',
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'conductor-howto:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
    });
  }
}

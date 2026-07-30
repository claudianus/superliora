/**
 * Read-only War Room expert transcript with a quick path to message them.
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import {
  warRoomExpertLabel,
  warRoomExpertStatusBadge,
  warRoomMessageMode,
  type WarRoomExpertView,
} from '#/tui/utils/war-room-experts';

export interface WarRoomTranscriptPanelOptions {
  readonly expert: WarRoomExpertView;
  readonly lines: readonly string[];
  readonly loading?: boolean;
  readonly error?: string;
  readonly onMessage: (text: string) => void;
  readonly onCancel: () => void;
}

export class WarRoomTranscriptPanelComponent extends Container implements Focusable {
  focused = false;

  private readonly expert: WarRoomExpertView;
  private readonly lines: readonly string[];
  private readonly loading: boolean;
  private readonly error: string | undefined;
  private readonly onMessage: (text: string) => void;
  private readonly onCancel: () => void;
  private scrollOffset = 0;
  private composing = false;
  private draft = '';

  constructor(opts: WarRoomTranscriptPanelOptions) {
    super();
    this.expert = opts.expert;
    this.lines = opts.lines;
    this.loading = opts.loading === true;
    this.error = opts.error;
    this.onMessage = opts.onMessage;
    this.onCancel = opts.onCancel;
    this.scrollOffset = Math.max(0, this.lines.length - 16);
  }

  handleInput(data: string): void {
    if (this.composing) {
      this.handleComposeInput(data);
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter) || printableChar(data) === 'm') {
      this.composing = true;
      this.draft = '';
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      this.scrollOffset = Math.min(Math.max(0, this.lines.length - 1), this.scrollOffset + 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 10);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scrollOffset = Math.min(Math.max(0, this.lines.length - 1), this.scrollOffset + 10);
      this.invalidate();
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const mode = warRoomMessageMode(this.expert.phase);
    const title = `${warRoomExpertLabel(this.expert)}  ·  ${warRoomExpertStatusBadge(this.expert.phase)}`;
    const body: string[] = [];
    if (this.loading) {
      body.push(theme.fg('textMuted', '  Loading transcript…'));
    } else if (this.error !== undefined) {
      body.push(theme.fg('error', `  ${this.error}`));
    } else if (this.lines.length === 0) {
      body.push(theme.fg('textMuted', '  No transcript yet for this expert.'));
    } else {
      const visible = this.lines.slice(this.scrollOffset, this.scrollOffset + 16);
      for (const line of visible) {
        body.push(truncateToWidth(`  ${line}`, width));
      }
    }

    if (this.composing) {
      body.push('');
      const draftDisplay =
        this.draft.length === 0 ? theme.fg('textMuted', '…') : theme.fg('text', this.draft);
      body.push(theme.boldFg('primary', `  Message (${mode}): `) + draftDisplay);
    }

    const hint = this.composing
      ? 'Enter send · Esc cancel compose'
      : `Enter/m message (${mode}) · ↑↓ scroll · Esc close`;

    return renderRendererPanelChromeRows({
      width,
      title: ` ${title}`,
      hint: ` ${hint}`,
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'war-room-transcript:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
    });
  }

  private handleComposeInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.composing = false;
      this.draft = '';
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const text = this.draft.trim();
      if (text.length === 0) return;
      this.onMessage(text);
      return;
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (this.draft.length > 0) {
        this.draft = this.draft.slice(0, -1);
        this.invalidate();
      }
      return;
    }
    const ch = printableChar(data);
    if (ch !== undefined && ch.length > 0) {
      this.draft += ch;
      this.invalidate();
    }
  }
}

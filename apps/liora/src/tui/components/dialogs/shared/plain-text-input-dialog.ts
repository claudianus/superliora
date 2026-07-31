/**
 * Generic single-line text prompt dialog (no masking).
 * PREMIUM chrome aligned with ApiKey / AccountLabel inputs.
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererFrameRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';

import { Input } from './input';

export type PlainTextInputResult =
  | { readonly kind: 'ok'; readonly value: string }
  | { readonly kind: 'cancel' };

export interface PlainTextInputDialogOptions {
  readonly title: string;
  readonly subtitleLines?: readonly string[];
  readonly prefill?: string;
  readonly allowEmpty?: boolean;
  readonly onDone: (result: PlainTextInputResult) => void;
}

export class PlainTextInputDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly input = new Input();
  private readonly opts: PlainTextInputDialogOptions;
  private done = false;
  private emptyHinted = false;

  constructor(opts: PlainTextInputDialogOptions) {
    super();
    this.opts = opts;
    if (opts.prefill !== undefined && opts.prefill.length > 0) {
      this.input.setValue(opts.prefill);
    }
    this.input.onSubmit = (value) => {
      this.submit(value);
    };
  }

  handleInput(data: string): void {
    if (this.done) return;
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl('c')) ||
      matchesKey(data, Key.ctrl('d'))
    ) {
      this.finish({ kind: 'cancel' });
      return;
    }
    this.emptyHinted = false;
    this.input.handleInput(data);
  }

  override invalidate(): void {
    super.invalidate();
    this.input.invalidate();
  }

  override render(width: number): string[] {
    this.input.focused = this.focused && !this.done;
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const innerWidth = Math.max(1, safeWidth - 4);
    const border = (s: string): string => currentTheme.fg('primary', s);
    const title = currentTheme.boldFg('textStrong', this.opts.title);
    const subtitleSource = [
      ...(this.opts.subtitleLines ?? []),
      ...(this.emptyHinted ? ['Value required.'] : []),
    ];
    const subtitleLines = subtitleSource.map((line, index) =>
      truncateToWidth(
        currentTheme.fg(
          this.emptyHinted && index === subtitleSource.length - 1 ? 'error' : 'textDim',
          line,
        ),
        innerWidth,
        '…',
      ),
    );
    const footer = currentTheme.fg('textDim', 'Enter submit  ·  Esc cancel');
    const contentLines = [
      truncateToWidth(title, innerWidth, '…'),
      '',
      ...subtitleLines,
      '',
      this.input.render(innerWidth)[0] ?? '> ',
      '',
      truncateToWidth(footer, innerWidth, '…'),
    ];
    if (safeWidth < 4) {
      return ['', ...contentLines.map((line) => truncateToWidth(line, safeWidth, '…'))];
    }
    return [
      '',
      ...renderRendererFrameRows({
        content: ['', ...contentLines, ''],
        width: safeWidth,
        height: contentLines.length + 4,
        borderKind: 'rounded',
        paddingLeft: 2,
        paddingRight: 0,
        borderStyle: border,
      }),
    ];
  }

  private submit(value: string): void {
    const trimmed = value.trim();
    if (trimmed.length === 0 && this.opts.allowEmpty !== true) {
      this.emptyHinted = true;
      return;
    }
    this.finish({ kind: 'ok', value: trimmed });
  }

  private finish(result: PlainTextInputResult): void {
    if (this.done) return;
    this.done = true;
    this.opts.onDone(result);
  }
}

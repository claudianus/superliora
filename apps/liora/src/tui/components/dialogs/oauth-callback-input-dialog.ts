import {
  Container,
  Key,
  matchesKey,
  renderRendererFrameRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import { sanitizeApiKeyValue } from '#/tui/utils/sanitize-api-key';
import { Input } from './input';

export type OAuthCallbackInputResult =
  | { readonly kind: 'ok'; readonly value: string }
  | { readonly kind: 'cancel' };

const FOOTER = 'Enter to submit  ·  Esc to cancel';

export interface OAuthCallbackInputDialogOptions {
  readonly title?: string;
  readonly subtitleLines?: readonly string[];
  readonly errorHint?: string;
}

/**
 * Single-line paste dialog for OAuth browser-callback fallbacks.
 * Used when the loopback redirect cannot reach the CLI and the user must
 * paste the callback URL / authorization code manually.
 */
export class OAuthCallbackInputDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly input = new Input();
  private readonly onDone: (result: OAuthCallbackInputResult) => void;
  private readonly title: string;
  private readonly subtitleLines: readonly string[];
  private done = false;
  private emptyHinted = false;
  private errorHint: string | undefined;

  constructor(
    onDone: (result: OAuthCallbackInputResult) => void,
    options: OAuthCallbackInputDialogOptions = {},
  ) {
    super();
    this.onDone = onDone;
    this.title = options.title ?? 'Paste OAuth callback';
    this.subtitleLines =
      options.subtitleLines ??
      [
        'If the browser could not redirect back automatically, paste the',
        'callback URL or authorization code shown after sign-in.',
      ];
    this.errorHint = options.errorHint;
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
      this.cancel();
      return;
    }
    if (this.emptyHinted || this.errorHint !== undefined) {
      this.emptyHinted = false;
      this.errorHint = undefined;
    }
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
    const titleStyled = currentTheme.boldFg('textStrong', this.title);
    const subtitleSource =
      this.errorHint !== undefined
        ? [this.errorHint]
        : this.emptyHinted
          ? ['Callback value cannot be empty.']
          : this.subtitleLines;
    const subtitleLines = subtitleSource.map((line) =>
      truncateToWidth(
        currentTheme.fg(this.errorHint !== undefined || this.emptyHinted ? 'error' : 'textDim', line),
        innerWidth,
        '…',
      ),
    );
    const footerStyled = currentTheme.fg('textDim', FOOTER);

    const titleLine = truncateToWidth(titleStyled, innerWidth, '…');
    const footerLine = truncateToWidth(footerStyled, innerWidth, '…');
    const inputLine = this.input.render(innerWidth)[0] ?? '> ';

    const contentLines: string[] = [
      titleLine,
      '',
      ...subtitleLines,
      '',
      inputLine,
      '',
      footerLine,
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
        ellipsis: '…',
      }),
      '',
    ];
  }

  private submit(value: string): void {
    if (this.done) return;
    const sanitized = sanitizeApiKeyValue(value);
    if (sanitized.length === 0) {
      this.emptyHinted = true;
      return;
    }
    this.done = true;
    this.onDone({ kind: 'ok', value: sanitized });
  }

  private cancel(): void {
    if (this.done) return;
    this.done = true;
    this.onDone({ kind: 'cancel' });
  }
}

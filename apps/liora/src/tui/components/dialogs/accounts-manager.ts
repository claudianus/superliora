/**
 * OAuth account pool manager dialogs.
 *
 * Presentation-only: builds PREMIUM list rows (label · role · fingerprint) and
 * ChoicePicker wrappers. Persistence lives in `commands/accounts.ts`.
 */

import {
  fingerprintProviderOAuthRef,
  type ProviderOAuthRef,
} from '@superliora/oauth';

import { CURRENT_MARK } from '#/tui/constant/symbols';
import {
  Container,
  Key,
  matchesKey,
  renderRendererFrameRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';
import { Input } from './input';

export type AccountRole = 'primary' | 'fallback';

export interface AccountPoolRow {
  readonly index: number;
  readonly ref: ProviderOAuthRef;
  readonly role: AccountRole;
  readonly fingerprint: string;
  readonly displayLabel: string;
  readonly line: string;
}

export function oauthAccountRole(index: number): AccountRole {
  return index === 0 ? 'primary' : 'fallback';
}

/**
 * Human-facing account name. Prefer the display label; never fall back to the
 * raw storage key (CLI list / PREMIUM hide keys behind fingerprints).
 */
export function formatOAuthAccountDisplayLabel(
  ref: ProviderOAuthRef,
  fingerprint?: string,
): string {
  const labeled = ref.label?.trim();
  if (labeled !== undefined && labeled.length > 0) return labeled;
  const fp = fingerprint ?? fingerprintProviderOAuthRef(ref);
  return `account ${fp.slice(0, 6)}`;
}

/** One-line PREMIUM row body: label · role · fingerprint (CURRENT_MARK applied by picker). */
export function formatOAuthAccountRowLine(row: Pick<AccountPoolRow, 'displayLabel' | 'role' | 'fingerprint'>): string {
  return `${row.displayLabel} · ${row.role} · ${row.fingerprint}`;
}

export function buildOAuthAccountPoolRows(refs: readonly ProviderOAuthRef[]): AccountPoolRow[] {
  return refs.map((ref, index) => {
    const role = oauthAccountRole(index);
    const fingerprint = fingerprintProviderOAuthRef(ref);
    const displayLabel = formatOAuthAccountDisplayLabel(ref, fingerprint);
    return {
      index,
      ref,
      role,
      fingerprint,
      displayLabel,
      line: formatOAuthAccountRowLine({ displayLabel, role, fingerprint }),
    };
  });
}

export function accountPoolChoiceOptions(rows: readonly AccountPoolRow[]): ChoiceOption[] {
  return rows.map((row) => ({
    value: String(row.index),
    label: row.line,
    description:
      row.role === 'primary'
        ? `storage=${row.ref.storage} · fingerprint=${row.fingerprint}`
        : `storage=${row.ref.storage} · fingerprint=${row.fingerprint}`,
  }));
}

export type AccountsProviderSelection = string;

export interface AccountsProviderPickerOptions {
  readonly providers: readonly {
    readonly id: string;
    readonly accountCount: number;
    readonly primaryLabel?: string | undefined;
  }[];
  readonly currentProviderId?: string | undefined;
  readonly onSelect: (providerId: string) => void;
  readonly onCancel: () => void;
}

export class AccountsProviderPickerComponent extends ChoicePickerComponent {
  constructor(opts: AccountsProviderPickerOptions) {
    super({
      title: 'OAuth accounts',
      searchable: opts.providers.length > 8,
      currentValue: opts.currentProviderId,
      options: opts.providers.map((provider) => ({
        value: provider.id,
        label: provider.id,
        description:
          provider.primaryLabel === undefined
            ? `${String(provider.accountCount)} account${provider.accountCount === 1 ? '' : 's'}`
            : `${String(provider.accountCount)} account${provider.accountCount === 1 ? '' : 's'} · primary ${provider.primaryLabel}`,
      })),
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}

export type AccountAction = 'promote' | 'label' | 'unlabel' | 'remove' | 'back';

export interface AccountsListPickerOptions {
  readonly providerId: string;
  readonly rows: readonly AccountPoolRow[];
  readonly onSelect: (index: number) => void;
  readonly onCancel: () => void;
}

export class AccountsListPickerComponent extends ChoicePickerComponent {
  constructor(opts: AccountsListPickerOptions) {
    const primaryValue = opts.rows[0] === undefined ? undefined : String(opts.rows[0].index);
    super({
      title: `Accounts · ${opts.providerId}`,
      hint: '↑↓ navigate · Enter select · Esc cancel',
      searchable: opts.rows.length > 8,
      currentValue: primaryValue,
      options: accountPoolChoiceOptions(opts.rows),
      onSelect: (value) => {
        const index = Number(value);
        if (!Number.isInteger(index) || index < 0) return;
        opts.onSelect(index);
      },
      onCancel: opts.onCancel,
    });
  }
}

export interface AccountActionPickerOptions {
  readonly providerId: string;
  readonly row: AccountPoolRow;
  readonly onSelect: (action: AccountAction) => void;
  readonly onCancel: () => void;
}

export class AccountActionPickerComponent extends ChoicePickerComponent {
  constructor(opts: AccountActionPickerOptions) {
    const { row } = opts;
    const options: ChoiceOption[] = [
      {
        value: 'promote',
        label: 'Promote to primary',
        description:
          row.role === 'primary'
            ? 'Already the primary account for this provider.'
            : 'Move this account to the front of the OAuth pool.',
      },
      {
        value: 'label',
        label: row.ref.label === undefined ? 'Set label' : 'Change label',
        description: 'Attach a short display label (letters, digits, _ . -).',
      },
    ];
    if (row.ref.label !== undefined) {
      options.push({
        value: 'unlabel',
        label: 'Clear label',
        description: `Remove label “${row.ref.label}”.`,
      });
    }
    options.push(
      {
        value: 'remove',
        label: 'Remove from pool',
        tone: 'danger',
        description: 'Drop this OAuth ref from config (token file is kept).',
      },
      {
        value: 'back',
        label: 'Back',
        description: 'Return to the account list.',
      },
    );

    super({
      title: `${row.displayLabel} · ${row.role}`,
      notice: `fingerprint=${row.fingerprint} · storage=${row.ref.storage}`,
      noticeTone: 'warning',
      options,
      onSelect: (value) => {
        if (
          value === 'promote' ||
          value === 'label' ||
          value === 'unlabel' ||
          value === 'remove' ||
          value === 'back'
        ) {
          opts.onSelect(value);
        }
      },
      onCancel: opts.onCancel,
    });
  }
}

export type AccountRemoveConfirmResult = 'confirm' | 'cancel';

export interface AccountRemoveConfirmOptions {
  readonly providerId: string;
  readonly row: AccountPoolRow;
  readonly isLast: boolean;
  readonly onDone: (result: AccountRemoveConfirmResult) => void;
}

export class AccountRemoveConfirmComponent extends ChoicePickerComponent {
  constructor(opts: AccountRemoveConfirmOptions) {
    super({
      title: `Remove ${opts.row.displayLabel}?`,
      hint: '↑↓ navigate · Enter select · Esc cancel',
      notice: opts.isLast
        ? `Last OAuth account for ${opts.providerId}. Pool becomes empty.`
        : `Remove from ${opts.providerId} OAuth pool. Token file is kept.`,
      noticeTone: 'warning',
      options: [
        {
          value: 'cancel',
          label: 'Cancel',
          description: 'Keep this account in the pool.',
        },
        {
          value: 'confirm',
          label: 'Remove account',
          tone: 'danger',
          description: 'Drop the OAuth ref from config only.',
        },
      ],
      onSelect: (value) => {
        opts.onDone(value === 'confirm' ? 'confirm' : 'cancel');
      },
      onCancel: () => {
        opts.onDone('cancel');
      },
    });
  }
}

export type AccountLabelInputResult =
  | { readonly kind: 'ok'; readonly value: string }
  | { readonly kind: 'cancel' };

export interface AccountLabelInputOptions {
  readonly providerId: string;
  readonly row: AccountPoolRow;
  readonly initialValue?: string | undefined;
  readonly onDone: (result: AccountLabelInputResult) => void;
}

/**
 * Plain single-line label input. Mirrors ApiKeyInputDialog chrome without masking.
 */
export class AccountLabelInputComponent extends Container implements Focusable {
  focused = false;

  private readonly input = new Input();
  private readonly opts: AccountLabelInputOptions;
  private done = false;
  private error: string | undefined;

  constructor(opts: AccountLabelInputOptions) {
    super();
    this.opts = opts;
    if (opts.initialValue !== undefined && opts.initialValue.length > 0) {
      this.input.setValue(opts.initialValue);
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
    if (this.error !== undefined) this.error = undefined;
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
    const title = currentTheme.boldFg(
      'textStrong',
      `Label · ${this.opts.row.displayLabel} (${this.opts.providerId})`,
    );
    const subtitleSource =
      this.error === undefined
        ? [
            'Letters, digits, _ . -  ·  1–64 chars',
            `${this.opts.row.role} · ${this.opts.row.fingerprint}`,
          ]
        : [
            this.error,
            'Letters, digits, _ . -  ·  1–64 chars',
            `${this.opts.row.role} · ${this.opts.row.fingerprint}`,
          ];
    const subtitleLines = subtitleSource.map((line, index) =>
      truncateToWidth(
        currentTheme.fg(this.error !== undefined && index === 0 ? 'error' : 'textDim', line),
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
        ellipsis: '…',
      }),
      '',
    ];
  }

  private submit(value: string): void {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.error = 'Label cannot be empty. Esc to cancel.';
      return;
    }
    this.finish({ kind: 'ok', value: trimmed });
  }

  private finish(result: AccountLabelInputResult): void {
    if (this.done) return;
    this.done = true;
    this.opts.onDone(result);
  }
}

/** Exported for tests that assert CURRENT_MARK appears on the primary row. */
export const ACCOUNTS_PRIMARY_MARK = CURRENT_MARK;

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

import { ACCOUNTS_POOL_RESILIENCE_HINT } from '#/tui/utils/never-halt/auth-glance';
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
import { ttui } from '#/tui/utils/tui-i18n';

import { ChoicePickerComponent, type ChoiceOption } from '../picker/choice-picker';
import { Input } from '../shared/input';

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
  return ttui('tui.accounts.accountFallback', { fp: fp.slice(0, 6) });
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

function providerAccountDescription(
  accountCount: number,
  primaryLabel: string | undefined,
): string {
  if (primaryLabel === undefined) {
    return accountCount === 1
      ? ttui('tui.accounts.providerAccount', { count: String(accountCount) })
      : ttui('tui.accounts.providerAccounts', { count: String(accountCount) });
  }
  return accountCount === 1
    ? ttui('tui.accounts.providerPrimaryOne', {
        count: String(accountCount),
        label: primaryLabel,
      })
    : ttui('tui.accounts.providerPrimary', {
        count: String(accountCount),
        label: primaryLabel,
      });
}

export class AccountsProviderPickerComponent extends ChoicePickerComponent {
  constructor(opts: AccountsProviderPickerOptions) {
    super({
      title: ttui('tui.accounts.oauthTitle'),
      searchable: opts.providers.length > 8,
      currentValue: opts.currentProviderId,
      options: opts.providers.map((provider) => ({
        value: provider.id,
        label: provider.id,
        description: providerAccountDescription(provider.accountCount, provider.primaryLabel),
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
      title: ttui('tui.accounts.listTitle', { provider: opts.providerId }),
      notice: ACCOUNTS_POOL_RESILIENCE_HINT,
      noticeTone: 'success',
      hint: ttui('tui.accounts.hintPicker'),
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
        label: ttui('tui.accounts.promote'),
        description:
          row.role === 'primary'
            ? ttui('tui.accounts.promoteAlreadyPrimary')
            : ttui('tui.accounts.promoteDesc'),
      },
      {
        value: 'label',
        label:
          row.ref.label === undefined
            ? ttui('tui.accounts.label')
            : ttui('tui.accounts.changeLabel'),
        description: ttui('tui.accounts.labelDesc'),
      },
    ];
    if (row.ref.label !== undefined) {
      options.push({
        value: 'unlabel',
        label: ttui('tui.accounts.clearLabel'),
        description: ttui('tui.accounts.clearLabelDesc', { label: row.ref.label }),
      });
    }
    options.push(
      {
        value: 'remove',
        label: ttui('tui.accounts.removeFromPool'),
        tone: 'danger',
        description: ttui('tui.accounts.removeFromPoolDesc'),
      },
      {
        value: 'back',
        label: ttui('tui.accounts.back'),
        description: ttui('tui.accounts.backDesc'),
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
      title: ttui('tui.accounts.removeTitle', { label: opts.row.displayLabel }),
      hint: ttui('tui.accounts.hintPicker'),
      notice: opts.isLast
        ? ttui('tui.accounts.removeLastNotice', { provider: opts.providerId })
        : ttui('tui.accounts.removeNotice', { provider: opts.providerId }),
      noticeTone: 'warning',
      options: [
        {
          value: 'cancel',
          label: ttui('tui.accounts.cancel'),
          description: ttui('tui.accounts.cancelKeep'),
        },
        {
          value: 'confirm',
          label: ttui('tui.accounts.removeConfirmAction'),
          tone: 'danger',
          description: ttui('tui.accounts.removeConfirmDesc'),
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
      ttui('tui.accounts.labelTitle', {
        label: this.opts.row.displayLabel,
        provider: this.opts.providerId,
      }),
    );
    const subtitleSource =
      this.error === undefined
        ? [
            ttui('tui.accounts.labelRules'),
            `${this.opts.row.role} · ${this.opts.row.fingerprint}`,
          ]
        : [
            this.error,
            ttui('tui.accounts.labelRules'),
            `${this.opts.row.role} · ${this.opts.row.fingerprint}`,
          ];
    const subtitleLines = subtitleSource.map((line, index) =>
      truncateToWidth(
        currentTheme.fg(this.error !== undefined && index === 0 ? 'error' : 'textDim', line),
        innerWidth,
        '…',
      ),
    );
    const footer = currentTheme.fg('textDim', ttui('tui.accounts.labelFooter'));
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
      this.error = ttui('tui.accounts.labelEmpty');
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

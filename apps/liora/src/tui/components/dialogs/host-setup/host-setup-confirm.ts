/**
 * Host-setup confirm sheet — lists install / write / change items before apply.
 */

import {
  Container,
  matchesKey,
  Key,
  renderRendererPanelChromeRows,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import { ttui } from '#/tui/utils/tui-i18n';

export type HostSetupPlanKind = 'install' | 'write' | 'change';
export type HostSetupPlanStatus = 'needed' | 'present' | 'refresh';

export interface HostSetupPlanItem {
  readonly id: string;
  readonly kind: HostSetupPlanKind;
  readonly title: string;
  readonly detail: string;
  readonly status: HostSetupPlanStatus;
}

export interface HostSetupPlan {
  readonly platform: string;
  readonly applicable: boolean;
  readonly needsApply: boolean;
  readonly items: readonly HostSetupPlanItem[];
}

export type HostSetupConfirmChoice = 'proceed' | 'cancel';

export interface HostSetupConfirmSheetOptions {
  readonly plan: HostSetupPlan;
  readonly onSelect: (choice: HostSetupConfirmChoice) => void;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}

const CHOICES: readonly {
  readonly value: HostSetupConfirmChoice;
  readonly labelKey: string;
  readonly descriptionKey: string;
}[] = [
  {
    value: 'proceed',
    labelKey: 'tui.dialog.hostSetup.proceed',
    descriptionKey: 'tui.dialog.hostSetup.proceedDesc',
  },
  {
    value: 'cancel',
    labelKey: 'tui.dialog.hostSetup.cancel',
    descriptionKey: 'tui.dialog.hostSetup.cancelDesc',
  },
];

const SECTION_KEYS: readonly { readonly kind: HostSetupPlanKind; readonly key: string }[] = [
  { kind: 'install', key: 'tui.dialog.hostSetup.sectionInstall' },
  { kind: 'write', key: 'tui.dialog.hostSetup.sectionWrite' },
  { kind: 'change', key: 'tui.dialog.hostSetup.sectionChange' },
];

function statusLabel(status: HostSetupPlanStatus): string {
  if (status === 'needed') return ttui('tui.dialog.hostSetup.statusNeeded');
  if (status === 'present') return ttui('tui.dialog.hostSetup.statusPresent');
  return ttui('tui.dialog.hostSetup.statusRefresh');
}

export class HostSetupConfirmSheetComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: HostSetupConfirmSheetOptions;
  private selected = 0;

  constructor(opts: HostSetupConfirmSheetOptions) {
    super();
    this.opts = opts;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.opts.onSelect(CHOICES[this.selected]!.value);
      return;
    }
    const ch = printableChar(data);
    if (matchesKey(data, Key.up) || ch === 'k') {
      this.selected = Math.max(0, this.selected - 1);
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.down) || ch === 'j') {
      this.selected = Math.min(CHOICES.length - 1, this.selected + 1);
      this.opts.requestRender?.();
      return;
    }
    if (ch === 'y') {
      this.opts.onSelect('proceed');
      return;
    }
    if (ch === 'n') {
      this.opts.onSelect('cancel');
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const body: string[] = [
      truncateToWidth(theme.fg('text', ttui('tui.dialog.hostSetup.question')), width),
      '',
    ];

    for (const section of SECTION_KEYS) {
      const rows = this.opts.plan.items.filter((entry) => entry.kind === section.kind);
      if (rows.length === 0) continue;
      body.push(theme.boldFg('primary', ttui(section.key)));
      for (const row of rows) {
        const tone = row.status === 'needed' ? 'warning' : row.status === 'present' ? 'success' : 'textMuted';
        body.push(
          truncateToWidth(
            `  ${theme.fg(tone, statusLabel(row.status))}  ${theme.fg('text', row.title)}`,
            width,
          ),
        );
        if (row.detail) {
          body.push(truncateToWidth(theme.fg('textDim', `      ${row.detail}`), width));
        }
      }
      body.push('');
    }

    for (const [i, choice] of CHOICES.entries()) {
      const selected = i === this.selected;
      const pointer = selected
        ? renderSelectPointer('host-setup:pointer')
        : ' '.repeat(visibleWidth(SELECT_POINTER));
      const label = ttui(choice.labelKey);
      const labelStyled = selected
        ? theme.boldFg('primary', label)
        : theme.fg('text', label);
      body.push(`  ${pointer} ${labelStyled}`);
      if (selected) {
        body.push(theme.fg('textMuted', `     ${ttui(choice.descriptionKey)}`));
      }
    }

    return renderRendererPanelChromeRows({
      width,
      title: ttui('tui.dialog.hostSetup.title'),
      hint: ttui('tui.dialog.hostSetup.hint'),
      body,
      dividerStyle: (text) => theme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'host-setup:title'),
      hintStyle: (text) => theme.fg('textMuted', text),
      ellipsis: '…',
    });
  }
}

import {
  Container,
  Key,
  matchesKey,
  renderRendererPanelChromeRows,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';

import type { UpgradePlan } from '#/cli/update/plan';
import { PRODUCT_NAME } from '#/constant/app';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/utils/appearance-effects';
import { renderSelectPointer } from '#/tui/utils/select-pointer';

export type UpgradeDialogChoice = 'install' | 'later';

export interface UpgradeDialogOptions {
  readonly plan: UpgradePlan;
  readonly onSelect: (choice: UpgradeDialogChoice) => void;
  readonly onCancel: () => void;
}

type DialogAction = {
  readonly value: UpgradeDialogChoice;
  readonly label: string;
};

const TITLE = `Upgrade ${PRODUCT_NAME}`;

export class UpgradeDialogComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: UpgradeDialogOptions;
  private readonly actions: readonly DialogAction[];
  private selectedIndex = 0;

  constructor(opts: UpgradeDialogOptions) {
    super();
    this.opts = opts;
    this.actions = actionsForPlan(opts.plan);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(this.actions.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const action = this.actions[this.selectedIndex];
      if (action !== undefined) this.opts.onSelect(action.value);
    }
  }

  override render(width: number): string[] {
    const { plan } = this.opts;
    const hint =
      this.actions.length > 1
        ? ' ↑↓ navigate · Enter select · Esc cancel'
        : ' Enter dismiss · Esc cancel';

    const body: string[] = [];
    for (const line of statusLines(plan)) {
      body.push(currentTheme.fg(line.tone, ` ${line.text}`));
    }
    body.push('');
    body.push(currentTheme.fg('textMuted', ' Current') + currentTheme.fg('text', `  ${plan.currentVersion}`));
    if (plan.target !== null) {
      body.push(
        currentTheme.fg('textMuted', ' Target ') + currentTheme.fg('success', `  ${plan.target.version}`),
      );
    }
    body.push(currentTheme.fg('textMuted', ' Source ') + currentTheme.fg('text', `  ${plan.source}`));
    if (shouldShowManualCommand(plan)) {
      body.push(
        currentTheme.fg('textMuted', ' Command') + currentTheme.fg('primary', `  ${plan.installCommand}`),
      );
    }
    if (plan.changelogUrl.length > 0 && plan.reason === 'update-available') {
      body.push(currentTheme.fg('textMuted', ' Notes  ') + currentTheme.fg('primary', `  ${plan.changelogUrl}`));
    }
    if (plan.dirty && plan.reason === 'update-available') {
      body.push('');
      body.push(
        currentTheme.fg(
          'warning',
          ' Working tree is dirty — install is blocked until changes are committed or stashed.',
        ),
      );
    }
    if (plan.errorMessage !== undefined && plan.errorMessage.length > 0) {
      body.push('');
      body.push(currentTheme.fg('error', ` ${plan.errorMessage}`));
    }

    body.push('');
    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i]!;
      const selected = i === this.selectedIndex;
      const pointer = selected ? renderSelectPointer('upgrade:pointer') : ' ';
      const label = selected
        ? currentTheme.boldFg('primary', action.label)
        : currentTheme.fg('text', action.label);
      body.push(currentTheme.fg(selected ? 'primary' : 'textDim', `  ${pointer} `) + label);
    }

    return renderRendererPanelChromeRows({
      width,
      title: ` ${TITLE}`,
      hint,
      body,
      footer: [''],
      dividerStyle: (text) => currentTheme.fg('primary', text),
      titleStyle: (text) => renderPremiumHeadline(text.trim(), 'upgrade-dialog:title'),
      hintStyle: (text) => currentTheme.fg('textMuted', text),
    }).map((line) => truncateToWidth(line, width));
  }
}

function actionsForPlan(plan: UpgradePlan): readonly DialogAction[] {
  if (plan.reason === 'update-available' && plan.canAutoInstall) {
    return [
      { value: 'install', label: `Install ${plan.target?.version ?? ''}`.trimEnd() },
      { value: 'later', label: 'Later' },
    ];
  }
  if (plan.reason === 'update-available') {
    return [{ value: 'later', label: 'Later' }];
  }
  return [{ value: 'later', label: 'Dismiss' }];
}

/** Manual recovery command for blocked / unsafe / non-auto-installable plans. */
function shouldShowManualCommand(plan: UpgradePlan): boolean {
  if (plan.canAutoInstall) return false;
  return (
    plan.reason === 'update-available'
    || plan.reason === 'diverged'
    || plan.reason === 'unsupported'
    || plan.reason === 'check-failed'
  );
}

function statusLines(plan: UpgradePlan): readonly { readonly text: string; readonly tone: 'text' | 'success' | 'warning' | 'error' | 'textMuted' }[] {
  switch (plan.reason) {
    case 'up-to-date':
      return [{ text: `${PRODUCT_NAME} is up to date.`, tone: 'success' }];
    case 'already-installing':
      return [
        {
          text: `An upgrade to ${plan.target?.version ?? 'a newer version'} is already in progress.`,
          tone: 'warning',
        },
      ];
    case 'update-available':
      return plan.canAutoInstall
        ? [{ text: 'A newer version is available.', tone: 'text' }]
        : [{ text: 'A newer version is available. Run the command below to install.', tone: 'text' }];
    case 'diverged':
      return [{ text: 'Git checkout has diverged from upstream.', tone: 'error' }];
    case 'check-failed':
      return [{ text: 'Could not check for updates.', tone: 'error' }];
    case 'unsupported':
      return [{ text: 'Automatic upgrades are not supported for this install source.', tone: 'warning' }];
    default:
      return [{ text: 'Upgrade status unknown.', tone: 'textMuted' }];
  }
}

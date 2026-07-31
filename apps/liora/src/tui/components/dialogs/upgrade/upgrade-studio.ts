/**
 * Premium Upgrade Studio — multi-mode center-modal surface for /upgrade.
 *
 * Modes: checking → plan → installing → success | failed
 * Visual DNA shared with SessionLoadingOverlay (bar, spinner, premium headline).
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';

import type { UpgradePlan } from '#/cli/update/plan';
import type { UpgradeInstallStage } from '#/cli/update/install-stages';
import { PRODUCT_NAME } from '#/constant/app';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  renderShimmerPrefix,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { renderRoundedPanel } from '#/tui/utils/ui/panel-frame';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import { renderUpgradeProgressBlock } from './upgrade-install-progress';

export type UpgradeStudioMode =
  | 'checking'
  | 'plan'
  | 'installing'
  | 'success'
  | 'failed';

export type UpgradeStudioChoice =
  | 'install'
  | 'later'
  | 'preferences'
  | 'copy-command'
  | 'retry'
  | 'dismiss';

export interface UpgradeStudioOptions {
  readonly mode?: UpgradeStudioMode;
  readonly plan?: UpgradePlan | null;
  readonly stage?: UpgradeInstallStage;
  readonly detail?: string;
  readonly onSelect: (choice: UpgradeStudioChoice) => void;
  readonly onCancel: () => void;
}

type StudioAction = {
  readonly value: UpgradeStudioChoice;
  readonly label: string;
};

const TITLE = `Upgrade ${PRODUCT_NAME}`;

export class UpgradeStudioComponent extends Container implements Focusable {
  focused = false;

  private mode: UpgradeStudioMode;
  private plan: UpgradePlan | null;
  private stage: UpgradeInstallStage;
  private detail: string | undefined;
  private actions: readonly StudioAction[] = [];
  private selectedIndex = 0;
  private readonly startedAtMs = appearanceAnimationNow();
  private readonly opts: UpgradeStudioOptions;

  constructor(opts: UpgradeStudioOptions) {
    super();
    this.opts = opts;
    this.mode = opts.mode ?? 'checking';
    this.plan = opts.plan ?? null;
    this.stage = opts.stage ?? 'checking';
    this.detail = opts.detail;
    this.rebuildActions();
  }

  update(patch: {
    readonly mode?: UpgradeStudioMode;
    readonly plan?: UpgradePlan | null;
    readonly stage?: UpgradeInstallStage;
    readonly detail?: string;
  }): void {
    if (patch.mode !== undefined) this.mode = patch.mode;
    if (patch.plan !== undefined) this.plan = patch.plan;
    if (patch.stage !== undefined) this.stage = patch.stage;
    if (patch.detail !== undefined) this.detail = patch.detail;
    this.rebuildActions();
  }

  get currentMode(): UpgradeStudioMode {
    return this.mode;
  }

  get currentPlan(): UpgradePlan | null {
    return this.plan;
  }

  handleInput(data: string): void {
    if (this.mode === 'checking' || this.mode === 'installing') {
      // Unsafe to cancel mid-check/install — swallow (session-loading DNA).
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) return;
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.opts.onCancel();
      return;
    }
    if (this.actions.length === 0) return;
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

  override invalidate(): void {}

  override render(width: number): string[] {
    const safeWidth = Math.max(36, Math.min(72, width));
    const appearance = getActiveAppearancePreferences();
    const shimmer = shouldRenderAmbientEffects(appearance)
      ? renderShimmerPrefix(appearance)
      : '';
    const headline = renderPremiumHeadline(
      `${shimmer}${TITLE}`.trim(),
      'upgrade-studio:title',
      appearance,
    );
    const content = [
      ...this.renderBody(safeWidth - 6),
      '',
      ...this.renderActions(),
      '',
      currentTheme.fg('textMuted', this.hintLine()),
    ];
    return renderRoundedPanel({
      title: headline,
      content,
      width: safeWidth,
      borderToken: this.mode === 'failed' ? 'error' : this.mode === 'success' ? 'success' : 'primary',
      minBoxWidth: 34,
    }).map((line) => truncateToWidth(line, width));
  }

  private renderBody(innerWidth: number): readonly string[] {
    switch (this.mode) {
      case 'checking':
        return this.renderChecking(innerWidth);
      case 'plan':
        return this.renderPlan(innerWidth);
      case 'installing':
        return this.renderInstalling(innerWidth);
      case 'success':
        return this.renderSuccess();
      case 'failed':
        return this.renderFailed(innerWidth);
    }
  }

  private renderChecking(innerWidth: number): readonly string[] {
    const source = this.plan?.source ?? 'npm-global';
    return [
      currentTheme.fg('textMuted', ' Checking for updates…'),
      '',
      ...renderUpgradeProgressBlock({
        width: innerWidth,
        source,
        stage: 'checking',
        startedAtMs: this.startedAtMs,
      }),
    ];
  }

  private renderPlan(innerWidth: number): readonly string[] {
    const plan = this.plan;
    if (plan === null) {
      return [currentTheme.fg('textMuted', ' No plan resolved.')];
    }
    const lines: string[] = [];
    for (const line of statusLines(plan)) {
      lines.push(currentTheme.fg(line.tone, ` ${line.text}`));
    }
    lines.push('');
    lines.push(
      currentTheme.fg('textMuted', ' Current')
        + currentTheme.fg('text', `  ${plan.currentVersion}`),
    );
    if (plan.target !== null) {
      lines.push(
        currentTheme.fg('textMuted', ' Target ')
          + currentTheme.boldFg('success', `  ${plan.target.version}`),
      );
    }
    lines.push(
      currentTheme.fg('textMuted', ' Source ')
        + currentTheme.fg('primary', `  ${plan.source}`),
    );
    if (shouldShowManualCommand(plan)) {
      lines.push(
        currentTheme.fg('textMuted', ' Command')
          + currentTheme.fg('primary', `  ${truncate(plan.installCommand, Math.max(12, innerWidth - 10))}`),
      );
    }
    if (plan.changelogUrl.length > 0 && plan.reason === 'update-available') {
      lines.push(
        currentTheme.fg('textMuted', ' Notes  ')
          + currentTheme.fg('primary', `  ${plan.changelogUrl}`),
      );
    }
    if (plan.dirty && plan.reason === 'update-available') {
      lines.push('');
      lines.push(
        currentTheme.fg(
          'warning',
          plan.canAutoInstall
            ? ' Working tree is dirty — installing will discard local changes (force checkout).'
            : ' Working tree is dirty — commit, stash, or re-run install.sh to recover.',
        ),
      );
    }
    if (plan.errorMessage !== undefined && plan.errorMessage.length > 0) {
      lines.push('');
      lines.push(currentTheme.fg('error', ` ${plan.errorMessage}`));
    }
    return lines;
  }

  private renderInstalling(innerWidth: number): readonly string[] {
    const source = this.plan?.source ?? 'npm-global';
    const target = this.plan?.target?.version;
    return [
      target === undefined
        ? currentTheme.fg('text', ' Installing update…')
        : currentTheme.fg('text', ' Installing ')
          + currentTheme.boldFg('success', target)
          + currentTheme.fg('text', '…'),
      '',
      ...renderUpgradeProgressBlock({
        width: innerWidth,
        source,
        stage: this.stage,
        detail: this.detail,
        startedAtMs: this.startedAtMs,
      }),
      '',
      currentTheme.fg('glow', ' Install in progress — leave this window open.'),
    ];
  }

  private renderSuccess(): readonly string[] {
    const version = this.plan?.target?.version ?? 'latest';
    return [
      currentTheme.boldFg('success', ' Upgrade complete'),
      '',
      currentTheme.fg('text', ` SuperLiora is now at ${version}.`),
      currentTheme.fg('textMuted', ' Restart SuperLiora to load the new binary.'),
      ...(this.plan?.changelogUrl
        ? [currentTheme.fg('primary', ` ${this.plan.changelogUrl}`)]
        : []),
    ];
  }

  private renderFailed(innerWidth: number): readonly string[] {
    const reason = this.detail?.trim() || 'install failed';
    const lines = [
      currentTheme.boldFg('error', ' Upgrade failed'),
      '',
      currentTheme.fg('error', ` ${truncate(reason, Math.max(12, innerWidth - 2))}`),
    ];
    if (this.plan !== null) {
      lines.push('');
      lines.push(currentTheme.fg('textMuted', ' Manual recovery:'));
      lines.push(
        currentTheme.fg(
          'primary',
          ` ${truncate(this.plan.installCommand, Math.max(12, innerWidth - 2))}`,
        ),
      );
    }
    return lines;
  }

  private renderActions(): readonly string[] {
    if (this.actions.length === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i]!;
      const selected = i === this.selectedIndex;
      const pointer = selected ? renderSelectPointer('upgrade-studio:pointer') : ' ';
      const label = selected
        ? currentTheme.boldFg('primary', action.label)
        : currentTheme.fg('text', action.label);
      out.push(`  ${pointer} ${label}`);
    }
    return out;
  }

  private hintLine(): string {
    switch (this.mode) {
      case 'checking':
      case 'installing':
        return ' Please wait…';
      case 'plan':
        return this.actions.length > 1
          ? ' ↑↓ navigate · Enter select · Esc cancel'
          : ' Enter dismiss · Esc cancel';
      case 'success':
      case 'failed':
        return this.actions.length > 1
          ? ' ↑↓ navigate · Enter select · Esc cancel'
          : ' Enter dismiss · Esc cancel';
    }
  }

  private rebuildActions(): void {
    this.actions = actionsForMode(this.mode, this.plan);
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.actions.length - 1));
  }
}

function actionsForMode(
  mode: UpgradeStudioMode,
  plan: UpgradePlan | null,
): readonly StudioAction[] {
  if (mode === 'checking' || mode === 'installing') return [];
  if (mode === 'success') {
    return [{ value: 'dismiss', label: 'Done' }];
  }
  if (mode === 'failed') {
    const actions: StudioAction[] = [];
    if (plan?.canAutoInstall === true && plan.target !== null) {
      actions.push({ value: 'retry', label: 'Retry install' });
    }
    actions.push({ value: 'dismiss', label: 'Dismiss' });
    return actions;
  }
  // plan
  if (plan === null) {
    return [{ value: 'dismiss', label: 'Dismiss' }];
  }
  if (plan.reason === 'update-available' && plan.canAutoInstall) {
    return [
      { value: 'install', label: `Install ${plan.target?.version ?? ''}`.trimEnd() },
      { value: 'preferences', label: 'Auto-update preferences' },
      { value: 'later', label: 'Later' },
    ];
  }
  if (plan.reason === 'update-available') {
    return [
      { value: 'copy-command', label: 'Show install command' },
      { value: 'preferences', label: 'Auto-update preferences' },
      { value: 'later', label: 'Later' },
    ];
  }
  return [
    { value: 'preferences', label: 'Auto-update preferences' },
    { value: 'dismiss', label: 'Dismiss' },
  ];
}

function shouldShowManualCommand(plan: UpgradePlan): boolean {
  if (plan.canAutoInstall) return false;
  return (
    plan.reason === 'update-available'
    || plan.reason === 'diverged'
    || plan.reason === 'unsupported'
    || plan.reason === 'check-failed'
  );
}

function statusLines(
  plan: UpgradePlan,
): readonly { readonly text: string; readonly tone: 'text' | 'success' | 'warning' | 'error' | 'textMuted' }[] {
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
        : [{ text: 'A newer version is available. Use the command below if needed.', tone: 'text' }];
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  return `${text.slice(0, max - 1)}…`;
}

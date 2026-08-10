/**
 * Premium Upgrade Studio — full-width center-modal surface for /upgrade · /update.
 *
 * Layout contract (fixes right-margin skew):
 * - Every returned row has the **same visible width** as `render(width)`.
 * - Frame is `renderPremiumBoxFrame` (comet chase, breath border, jewel corners).
 * - Body lines are padded to the inner width before framing — never shrink-to-content.
 */

import {
  Container,
  Key,
  matchesKey,
  stripAnsiControls,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';

import type { UpgradePlan } from '#/cli/update/plan';
import type { UpgradeInstallStage } from '#/cli/update/install-stages';
import { PRODUCT_NAME } from '#/constant/app';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderParticleDivider,
  renderPremiumBoxFrame,
  renderPremiumHeadline,
  renderPulseText,
  renderShimmerPrefix,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { renderSelectPointer } from '#/tui/utils/ui/select-pointer';
import { renderUpgradeProgressBlock } from './upgrade-install-progress';
import { ttui } from '#/tui/utils/tui-i18n';

export type UpgradeStudioMode =
  | 'checking'
  | 'plan'
  | 'installing'
  | 'success'
  | 'failed';

export type UpgradeStudioChoice =
  | 'install'
  | 'install-main'
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

function upgradeStudioTitle(): string {
  return ttui('tui.dialog.upgradeStudio.title', { product: PRODUCT_NAME });
}
const LABEL_COL = 10;
const ORBIT = ['✦', '·', '✧', '·', '⋆', '·', '✧', '·'] as const;
const JEWEL = ['◆', '◇', '◈', '❖'] as const;
const COMET = ['·', '˙', '˚', '•', '∙', '●', '∙', '•', '˚', '˙'] as const;

export class UpgradeStudioComponent extends Container implements Focusable {
  focused = false;

  private mode: UpgradeStudioMode;
  private plan: UpgradePlan | null;
  private stage: UpgradeInstallStage;
  private detail: string | undefined;
  private actions: readonly StudioAction[] = [];
  private selectedIndex = 0;
  private readonly startedAtMs = appearanceAnimationNow();
  private readonly openedAtMs = appearanceAnimationNow();
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
    // Fill the full center-modal content width — never shrink-to-content.
    const outer = Math.max(40, Math.min(72, width));
    const inner = Math.max(20, outer - 2);
    const appearance = getActiveAppearancePreferences();
    const ambient = shouldRenderAmbientEffects(appearance);
    const now = appearanceAnimationNow();

    const shimmer = ambient ? renderShimmerPrefix(appearance) : '';
    const headline = renderPremiumHeadline(
      `${shimmer}${upgradeStudioTitle()}`.trimStart(),
      'upgrade-studio:title',
      appearance,
    );
    const modeChip = modeChipLabel(this.mode);
    const footerLeft = currentTheme.fg('textMuted', modeChip);
    const footerRight = ambient
      ? renderPulseText('✦ studio', 'upgrade-studio:footer', 'glow')
      : currentTheme.fg('glow', '✦ studio');

    const body = padBodyToWidth(
      [
        ...this.renderHero(inner, now, appearance, ambient),
        '',
        renderParticleDivider(inner, 'upgrade-studio:rail-top', appearance),
        '',
        ...this.renderBody(inner, now, ambient, appearance),
        '',
        ...this.renderActions(inner, ambient, appearance),
        '',
        padLine(currentTheme.fg('textMuted', this.hintLine()), inner),
      ],
      inner,
    );

    const frame = renderPremiumBoxFrame(body, {
      width: outer,
      title: headline,
      titlePlain: upgradeStudioTitle(),
      footerLeft,
      footerLeftPlain: modeChip,
      footerRight,
      footerRightPlain: '✦ studio',
      appearance,
      openedAtMs: this.openedAtMs,
    });

    // Guarantee uniform outer width even if host passes a wider region.
    return frame.map((line) => {
      const pad = Math.max(0, outer - visibleWidth(stripAnsiControls(line)));
      return pad === 0 ? line : line + ' '.repeat(pad);
    });
  }

  private renderHero(
    inner: number,
    now: number,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
    ambient: boolean,
  ): readonly string[] {
    const scene = renderJewelScene(Math.min(inner, 48), now, ambient);
    const status = heroStatus(this.mode, this.plan, ambient, appearance);
    return [
      padLine(centerAnsi(scene, inner), inner),
      '',
      padLine(centerAnsi(status, inner), inner),
    ];
  }

  private renderBody(
    inner: number,
    _now: number,
    ambient: boolean,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): readonly string[] {
    switch (this.mode) {
      case 'checking':
        return this.renderChecking(inner);
      case 'plan':
        return this.renderPlan(inner, ambient, appearance);
      case 'installing':
        return this.renderInstalling(inner);
      case 'success':
        return this.renderSuccess(inner, ambient, appearance);
      case 'failed':
        return this.renderFailed(inner);
    }
  }

  private renderChecking(inner: number): readonly string[] {
    const source = this.plan?.source ?? 'npm-global';
    return [
      padLine(centerAnsi(currentTheme.fg('textMuted', 'Checking for updates…'), inner), inner),
      '',
      ...renderUpgradeProgressBlock({
        width: inner,
        source,
        stage: 'checking',
        startedAtMs: this.startedAtMs,
        fillWidth: true,
      }),
    ];
  }

  private renderPlan(
    inner: number,
    ambient: boolean,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): readonly string[] {
    const plan = this.plan;
    if (plan === null) {
      return [padLine(currentTheme.fg('textMuted', ' No plan resolved.'), inner)];
    }
    const lines: string[] = [];
    for (const line of statusLines(plan)) {
      const text =
        ambient && line.tone === 'text'
          ? renderSpectacularText(line.text, 'upgrade-studio:status', appearance, {
              pace: 'slow',
            })
          : currentTheme.fg(line.tone, line.text);
      lines.push(padLine(centerAnsi(text, inner), inner));
    }
    lines.push('');
    lines.push(fieldRow('Current', plan.currentVersion, inner, 'text'));
    if (plan.target !== null) {
      lines.push(fieldRow('Target', plan.target.version, inner, 'success', true));
    }
    lines.push(fieldRow('Source', plan.source, inner, 'primary'));
    if (shouldShowManualCommand(plan)) {
      lines.push(fieldRow('Command', plan.installCommand, inner, 'primary'));
    }
    if (plan.changelogUrl.length > 0 && plan.reason === 'update-available') {
      lines.push(fieldRow('Notes', plan.changelogUrl, inner, 'accent'));
    }
    if (plan.dirty && plan.reason === 'update-available') {
      lines.push('');
      const warn = plan.canAutoInstall
        ? 'Dirty tree — Install force-resets HEAD and discards uncommitted local changes.'
        : 'Dirty tree — commit, stash, or re-run install.sh to recover.';
      lines.push(padLine(currentTheme.fg('warning', ` ⚠ ${warn}`), inner));
    }
    if (plan.errorMessage !== undefined && plan.errorMessage.length > 0) {
      lines.push('');
      lines.push(padLine(currentTheme.fg('error', ` ✗ ${plan.errorMessage}`), inner));
    }
    return lines;
  }

  private renderInstalling(inner: number): readonly string[] {
    const source = this.plan?.source ?? 'npm-global';
    const target = this.plan?.target?.version;
    const head =
      target === undefined
        ? currentTheme.fg('text', 'Installing update…')
        : currentTheme.fg('text', 'Installing ')
          + currentTheme.boldFg('success', target)
          + currentTheme.fg('text', '…');
    return [
      padLine(centerAnsi(head, inner), inner),
      '',
      ...renderUpgradeProgressBlock({
        width: inner,
        source,
        stage: this.stage,
        detail: this.detail,
        startedAtMs: this.startedAtMs,
        fillWidth: true,
      }),
      '',
      padLine(
        centerAnsi(
          currentTheme.fg('glow', 'Install in progress — leave this window open.'),
          inner,
        ),
        inner,
      ),
    ];
  }

  private renderSuccess(
    inner: number,
    ambient: boolean,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): readonly string[] {
    const version = this.plan?.target?.version ?? 'latest';
    const title = ambient
      ? renderSpectacularText('Upgrade complete', 'upgrade-studio:success', appearance, {
          intense: true,
        })
      : currentTheme.boldFg('success', 'Upgrade complete');
    return [
      padLine(centerAnsi(title, inner), inner),
      '',
      padLine(centerAnsi(currentTheme.fg('text', `SuperLiora is now at ${version}.`), inner), inner),
      padLine(
        centerAnsi(currentTheme.fg('textMuted', 'Restart SuperLiora to load the new binary.'), inner),
        inner,
      ),
      ...(this.plan?.changelogUrl
        ? [padLine(centerAnsi(currentTheme.fg('primary', this.plan.changelogUrl), inner), inner)]
        : []),
    ];
  }

  private renderFailed(inner: number): readonly string[] {
    const reason = this.detail?.trim() || 'install failed';
    const lines = [
      padLine(centerAnsi(currentTheme.boldFg('error', 'Upgrade failed'), inner), inner),
      '',
      padLine(centerAnsi(currentTheme.fg('error', truncate(reason, Math.max(12, inner - 4))), inner), inner),
    ];
    if (this.plan !== null) {
      lines.push('');
      lines.push(fieldRow('Recover', this.plan.installCommand, inner, 'primary'));
    }
    return lines;
  }

  private renderActions(
    inner: number,
    ambient: boolean,
    appearance: ReturnType<typeof getActiveAppearancePreferences>,
  ): readonly string[] {
    if (this.actions.length === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i]!;
      const selected = i === this.selectedIndex;
      const pointer = selected ? renderSelectPointer('upgrade-studio:pointer') : ' ';
      const label = selected
        ? ambient
          ? renderSpectacularText(action.label, `upgrade-studio:action:${action.value}`, appearance, {
              intense: true,
              pace: 'fast',
            })
          : currentTheme.boldFg('primary', action.label)
        : currentTheme.fg('text', action.label);
      const prefix = `  ${pointer} `;
      const line = prefix + label;
      out.push(padLine(line, inner));
    }
    return out;
  }

  private hintLine(): string {
    switch (this.mode) {
      case 'checking':
      case 'installing':
        return ttui('tui.dialog.upgradeStudio.hint.wait');
      case 'plan':
        return this.actions.length > 1
          ? ttui('tui.dialog.upgradeStudio.hint.navigate')
          : ttui('tui.dialog.upgradeStudio.hint.dismiss');
      case 'success':
      case 'failed':
        return this.actions.length > 1
          ? ttui('tui.dialog.upgradeStudio.hint.navigate')
          : ttui('tui.dialog.upgradeStudio.hint.dismiss');
    }
  }

  private rebuildActions(): void {
    const next = actionsForMode(this.mode, this.plan);
    const changed =
      next.length !== this.actions.length
      || next.some((action, index) => action.value !== this.actions[index]?.value);
    this.actions = next;
    // Mode/action-list changes must not keep a stale highlight from a prior list.
    this.selectedIndex = changed
      ? 0
      : Math.min(this.selectedIndex, Math.max(0, this.actions.length - 1));
  }
}

// ── layout helpers ──────────────────────────────────────────────────────────

function padBodyToWidth(lines: readonly string[], width: number): readonly string[] {
  return lines.map((line) => padLine(line, width));
}

function padLine(line: string, width: number): string {
  const plain = stripAnsiControls(line);
  const w = visibleWidth(plain);
  if (w === width) return line;
  if (w > width) return truncateToWidth(line, width, '…');
  return line + ' '.repeat(width - w);
}

function centerAnsi(line: string, width: number): string {
  const plain = stripAnsiControls(line);
  const w = visibleWidth(plain);
  if (w >= width) return truncateToWidth(line, width, '…');
  const left = Math.floor((width - w) / 2);
  return ' '.repeat(left) + line;
}

function fieldRow(
  label: string,
  value: string,
  width: number,
  valueTone: 'text' | 'success' | 'primary' | 'accent',
  bold = false,
): string {
  const labelStyled = currentTheme.fg('textMuted', label.padEnd(LABEL_COL, ' '));
  const valueMax = Math.max(8, width - LABEL_COL - 3);
  const valuePlain = truncate(value, valueMax);
  const valueStyled = bold
    ? currentTheme.boldFg(valueTone, valuePlain)
    : currentTheme.fg(valueTone, valuePlain);
  return padLine(` ${labelStyled} ${valueStyled}`, width);
}

function renderJewelScene(width: number, now: number, ambient: boolean): string {
  const w = Math.max(14, width);
  const cells: string[] = Array.from({ length: w }, () => ' ');
  if (!ambient) {
    const mid = Math.floor(w / 2);
    cells[mid] = currentTheme.boldFg('primary', '◆');
    return cells.join('');
  }
  for (let i = 0; i < w; i++) {
    const tick = Math.floor(now / 120);
    if ((tick + i * 7) % 9 === 0) cells[i] = currentTheme.dim(ORBIT[i % ORBIT.length] ?? '·');
    else if ((tick + i * 5) % 13 === 0) cells[i] = currentTheme.fg('particle', '·');
  }
  const t1 = now / 380;
  const orbitX = Math.floor((Math.sin(t1) * 0.5 + 0.5) * (w - 1));
  const jewel = JEWEL[Math.floor(now / 240) % JEWEL.length] ?? '◆';
  for (let d = 4; d >= 1; d--) {
    const x = orbitX - d;
    if (x < 0) continue;
    cells[x] = currentTheme.fg(d <= 2 ? 'glow' : 'primary', COMET[(Math.floor(now / 70) + d) % COMET.length] ?? '·');
  }
  cells[orbitX] = currentTheme.boldFg('primary', jewel);
  const t2 = now / 520 + Math.PI * 0.65;
  const orbitY = Math.floor((Math.sin(t2) * 0.5 + 0.5) * (w - 1));
  if (orbitY !== orbitX) cells[orbitY] = currentTheme.fg('glow', '✧');
  return cells.join('');
}

function heroStatus(
  mode: UpgradeStudioMode,
  plan: UpgradePlan | null,
  ambient: boolean,
  appearance: ReturnType<typeof getActiveAppearancePreferences>,
): string {
  const raw = (() => {
    switch (mode) {
      case 'checking':
        return 'Scanning releases…';
      case 'installing':
        return 'Installing…';
      case 'success':
        return 'Ready to restart';
      case 'failed':
        return 'Install failed';
      case 'plan':
        if (plan?.reason === 'update-available' && plan.target !== null) {
          return `${plan.currentVersion}  →  ${plan.target.version}`;
        }
        if (plan?.reason === 'up-to-date') return 'You are up to date';
        return 'Update status';
    }
  })();
  if (ambient && (mode === 'plan' || mode === 'success')) {
    return renderSpectacularText(raw, 'upgrade-studio:hero', appearance, {
      intense: mode === 'success',
      pace: mode === 'success' ? 'fast' : 'slow',
    });
  }
  return currentTheme.boldFg(mode === 'failed' ? 'error' : 'primary', raw);
}

function modeChipLabel(mode: UpgradeStudioMode): string {
  switch (mode) {
    case 'checking':
      return 'checking';
    case 'plan':
      return 'ready';
    case 'installing':
      return 'installing';
    case 'success':
      return 'done';
    case 'failed':
      return 'failed';
  }
}

function actionsForMode(
  mode: UpgradeStudioMode,
  plan: UpgradePlan | null,
): readonly StudioAction[] {
  if (mode === 'checking' || mode === 'installing') return [];
  if (mode === 'success') {
    return [{ value: 'dismiss', label: ttui('tui.dialog.upgradeStudio.action.done') }];
  }
  if (mode === 'failed') {
    const actions: StudioAction[] = [];
    if (plan?.canAutoInstall === true && plan.target !== null) {
      actions.push({ value: 'retry', label: ttui('tui.dialog.upgradeStudio.action.retry') });
    }
    actions.push({ value: 'dismiss', label: ttui('tui.dialog.upgradeStudio.action.dismiss') });
    return actions;
  }
  if (plan === null) {
    return [{ value: 'dismiss', label: ttui('tui.dialog.upgradeStudio.action.dismiss') }];
  }
  if (plan.reason === 'update-available' && plan.canAutoInstall) {
    const actions: StudioAction[] = [
      {
        value: 'install',
        label: ttui('tui.dialog.upgradeStudio.action.install', {
          version: plan.target?.version ?? '',
        }).trimEnd(),
      },
    ];
    if (!plan.fromMain) {
      actions.push({ value: 'install-main', label: ttui('tui.dialog.upgradeStudio.action.installMain') });
    }
    actions.push(
      { value: 'preferences', label: ttui('tui.dialog.upgradeStudio.action.preferences') },
      { value: 'later', label: ttui('tui.dialog.upgradeStudio.action.later') },
    );
    return actions;
  }
  if (plan.reason === 'update-available') {
    const actions: StudioAction[] = [
      { value: 'copy-command', label: ttui('tui.dialog.upgradeStudio.action.copyCommand') },
    ];
    if (!plan.fromMain) {
      actions.push({ value: 'install-main', label: ttui('tui.dialog.upgradeStudio.action.installMain') });
    }
    actions.push(
      { value: 'preferences', label: ttui('tui.dialog.upgradeStudio.action.preferences') },
      { value: 'later', label: ttui('tui.dialog.upgradeStudio.action.later') },
    );
    return actions;
  }
  // Up-to-date / other: still allow opt-in tip-of-main (skips published releases).
  const actions: StudioAction[] = [];
  if (!plan.fromMain) {
    actions.push({ value: 'install-main', label: ttui('tui.dialog.upgradeStudio.action.installMain') });
  }
  actions.push(
    { value: 'preferences', label: ttui('tui.dialog.upgradeStudio.action.preferences') },
    { value: 'dismiss', label: ttui('tui.dialog.upgradeStudio.action.dismiss') },
  );
  return actions;
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
      if (plan.fromMain) {
        return [
          {
            text: 'Tip of origin/main (not a published release).',
            tone: 'warning',
          },
        ];
      }
      return plan.canAutoInstall
        ? [{ text: 'A newer published release is available.', tone: 'text' }]
        : [{ text: 'A newer published release is available. Use the command below if needed.', tone: 'text' }];
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

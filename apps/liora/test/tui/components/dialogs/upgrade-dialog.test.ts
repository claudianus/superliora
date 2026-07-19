import { describe, expect, it, vi } from 'vitest';

import { SUPERLIORA_CHANGELOG_URL, type UpgradePlan } from '#/cli/update/plan';
import { UpgradeDialogComponent } from '#/tui/components/dialogs/upgrade-dialog';

const ANSI = /\u001B\[[0-9;]*m/g;
const ESC = String.fromCodePoint(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const ENTER = '\r';

function strip(text: string): string {
  return text.replaceAll(ANSI, '');
}

function plan(overrides: Partial<UpgradePlan> = {}): UpgradePlan {
  return {
    source: 'npm-global',
    currentVersion: '0.4.0',
    target: { version: '0.5.0' },
    installCommand: 'npm install -g @superliora/liora@0.5.0',
    changelogUrl: SUPERLIORA_CHANGELOG_URL,
    dirty: false,
    canAutoInstall: true,
    reason: 'update-available',
    ...overrides,
  };
}

function text(component: UpgradeDialogComponent, width = 100): string {
  return component.render(width).map(strip).join('\n');
}

describe('UpgradeDialogComponent', () => {
  it('offers Install and Later when an update can auto-install', () => {
    const onSelect = vi.fn();
    const dialog = new UpgradeDialogComponent({
      plan: plan(),
      onSelect,
      onCancel: vi.fn(),
    });

    const out = text(dialog);
    expect(out).toContain('Upgrade SuperLiora');
    expect(out).toContain('↑↓ navigate · Enter select · Esc cancel');
    expect(out).toContain('0.4.0');
    expect(out).toContain('0.5.0');
    expect(out).toMatch(/❯ Install/);
    expect(out).toContain('Later');

    dialog.handleInput(DOWN);
    dialog.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledWith('later');
  });

  it('selects Install with Enter by default', () => {
    const onSelect = vi.fn();
    const dialog = new UpgradeDialogComponent({
      plan: plan(),
      onSelect,
      onCancel: vi.fn(),
    });

    dialog.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledWith('install');
  });

  it('shows a manual command when auto-install is unavailable', () => {
    const dialog = new UpgradeDialogComponent({
      plan: plan({ canAutoInstall: false }),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = text(dialog);
    expect(out).toContain('npm install -g @superliora/liora@0.5.0');
    expect(out).not.toContain('Install');
    expect(out).toMatch(/❯ Later|❯ Dismiss/);
  });

  it('warns when a dirty github checkout blocks install', () => {
    const dialog = new UpgradeDialogComponent({
      plan: plan({
        source: 'github-checkout',
        dirty: true,
        canAutoInstall: false,
        installCommand: "bash -lc 'set -e; git pull'",
      }),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = text(dialog);
    expect(out.toLowerCase()).toContain('dirty');
    expect(out.toLowerCase()).toMatch(/blocked|cannot install|install is blocked/);
    expect(out).toContain("bash -lc 'set -e; git pull'");
  });

  it('shows the manual command for diverged checkouts', () => {
    const dialog = new UpgradeDialogComponent({
      plan: plan({
        source: 'github-checkout',
        reason: 'diverged',
        target: null,
        canAutoInstall: false,
        installCommand: "bash -lc 'set -e; git pull'",
        errorMessage: 'Git checkout has diverged from origin/main',
      }),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = text(dialog);
    expect(out).toContain('diverged');
    expect(out).toContain("bash -lc 'set -e; git pull'");
    expect(out).toMatch(/❯ Dismiss/);
  });

  it('dismisses up-to-date with Enter or Esc', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const dialog = new UpgradeDialogComponent({
      plan: plan({
        reason: 'up-to-date',
        target: null,
        canAutoInstall: false,
        installCommand: 'npm install -g @superliora/liora@0.4.0',
      }),
      onSelect,
      onCancel,
    });

    expect(text(dialog).toLowerCase()).toContain('up to date');
    dialog.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledWith('later');

    const dialog2 = new UpgradeDialogComponent({
      plan: plan({
        reason: 'up-to-date',
        target: null,
        canAutoInstall: false,
      }),
      onSelect: vi.fn(),
      onCancel,
    });
    dialog2.handleInput(ESC);
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows already-installing status', () => {
    const dialog = new UpgradeDialogComponent({
      plan: plan({
        reason: 'already-installing',
        canAutoInstall: false,
      }),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(text(dialog).toLowerCase()).toMatch(/already|in progress|installing/);
  });

  it('shows error details for diverged and check-failed', () => {
    const diverged = new UpgradeDialogComponent({
      plan: plan({
        reason: 'diverged',
        target: null,
        canAutoInstall: false,
        installCommand: "bash -lc 'set -e; git pull'",
        errorMessage: 'Git checkout has diverged from origin/main',
      }),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const divergedOut = text(diverged);
    expect(divergedOut).toContain('diverged');
    expect(divergedOut).toContain("bash -lc 'set -e; git pull'");

    const failed = new UpgradeDialogComponent({
      plan: plan({
        reason: 'check-failed',
        target: null,
        canAutoInstall: false,
        errorMessage: 'network down',
      }),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const failedOut = text(failed);
    expect(failedOut).toContain('network down');
    expect(failedOut).toContain('npm install -g @superliora/liora@0.5.0');
  });

  it('cancels with Esc from the install list', () => {
    const onCancel = vi.fn();
    const dialog = new UpgradeDialogComponent({
      plan: plan(),
      onSelect: vi.fn(),
      onCancel,
    });
    dialog.handleInput(UP);
    dialog.handleInput(ESC);
    expect(onCancel).toHaveBeenCalled();
  });
});

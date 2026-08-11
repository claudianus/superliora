import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SUPERLIORA_CHANGELOG_URL, type UpgradePlan } from '#/cli/update/plan';
import { UpgradeStudioComponent } from '#/tui/components/dialogs/upgrade/upgrade-studio';
import { stripAnsiControls, visibleWidth } from '#/tui/renderer';
import { currentTheme, darkColors } from '#/tui/theme';

const ANSI = /\u001B\[[0-9;]*m/g;
const ESC = String.fromCodePoint(27);
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
    fromMain: false,
    ...overrides,
  };
}

function text(studio: UpgradeStudioComponent, width = 72): string {
  return studio.render(width).map(strip).join('\n');
}

describe('UpgradeStudioComponent', () => {
  let previousPalette: typeof currentTheme.palette;

  beforeEach(() => {
    previousPalette = currentTheme.palette;
    currentTheme.setPalette(darkColors);
  });

  afterEach(() => {
    currentTheme.setPalette(previousPalette);
  });

  it('renders every row at a uniform outer width (no right-margin skew)', () => {
    const studio = new UpgradeStudioComponent({
      mode: 'plan',
      plan: plan(),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const width = 64;
    const rows = studio.render(width);
    expect(rows.length).toBeGreaterThan(6);
    const widths = rows.map((row) => visibleWidth(stripAnsiControls(row)));
    const target = widths[0]!;
    for (const w of widths) {
      expect(w).toBe(target);
    }
    // Fills the allocated center-modal width (not shrink-to-content).
    expect(target).toBe(width);
  });

  it('shows checking theatre then plan with Install action', () => {
    const onSelect = vi.fn();
    const studio = new UpgradeStudioComponent({
      mode: 'checking',
      onSelect,
      onCancel: vi.fn(),
    });
    expect(text(studio)).toContain('Checking for updates');

    studio.update({ mode: 'plan', plan: plan() });
    const out = text(studio);
    expect(out).toContain('Upgrade SuperLiora');
    expect(out).toContain('0.4.0');
    expect(out).toContain('0.5.0');
    expect(out).toMatch(/Install 0\.5\.0|Install/);
    expect(out).toContain('Install tip of main');
    expect(out).toContain('Later');
  });

  it('offers Install tip of main when already on a published release', () => {
    const onSelect = vi.fn();
    const studio = new UpgradeStudioComponent({
      mode: 'plan',
      plan: plan({ reason: 'up-to-date', target: null, canAutoInstall: false }),
      onSelect,
      onCancel: vi.fn(),
    });
    const out = text(studio);
    expect(out).toContain('Install tip of main');
    studio.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith('install-main');
  });

  it('warns dirty trees but still offers Install when canAutoInstall', () => {
    const studio = new UpgradeStudioComponent({
      mode: 'plan',
      plan: plan({ dirty: true, source: 'github-checkout' }),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const out = text(studio);
    expect(out.toLowerCase()).toContain('dirty');
    expect(out.toLowerCase()).toMatch(/discard|force-?reset|force checkout/);
    expect(out).toMatch(/Install/);
  });

  it('resets selection when action list changes across modes', () => {
    const onSelect = vi.fn();
    const studio = new UpgradeStudioComponent({
      mode: 'plan',
      plan: plan(),
      onSelect,
      onCancel: vi.fn(),
    });
    studio.handleInput('\u001B[B'); // down → Install tip of main
    studio.handleInput('\u001B[B'); // down → preferences
    studio.update({ mode: 'failed', detail: 'boom' });
    studio.handleInput(ENTER);
    // Failed actions start at Retry (index 0), not a stale preferences slot.
    expect(onSelect).toHaveBeenCalledWith('retry');
  });

  it('installing mode swallows Esc and shows stage checklist', () => {
    const onCancel = vi.fn();
    const studio = new UpgradeStudioComponent({
      mode: 'installing',
      plan: plan({ source: 'github-checkout' }),
      stage: 'building',
      onSelect: vi.fn(),
      onCancel,
    });
    studio.handleInput(ESC);
    expect(onCancel).not.toHaveBeenCalled();
    const out = text(studio);
    expect(out).toContain('Building');
    expect(out).toContain('Fetching');
    expect(out).toContain('Install in progress');
  });

  it('installing rows stay uniform width even with stage detail noise', () => {
    const studio = new UpgradeStudioComponent({
      mode: 'installing',
      plan: plan({
        source: 'github-checkout',
        target: { version: 'origin/main@1c1a165f3bda' },
      }),
      stage: 'building',
      detail: '__LIORA_UPGRADE_STAGE__=building',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    const width = 64;
    const rows = studio.render(width);
    const widths = rows.map((row) => visibleWidth(stripAnsiControls(row)));
    for (const w of widths) {
      expect(w).toBe(widths[0]);
    }
    const out = rows.map(strip).join('\n');
    expect(out).not.toContain('__LIORA_UPGRADE_STAGE__');
    expect(out).toContain('elapsed');
  });

  it('success mode dismisses with Enter', () => {
    const onSelect = vi.fn();
    const studio = new UpgradeStudioComponent({
      mode: 'success',
      plan: plan(),
      onSelect,
      onCancel: vi.fn(),
    });
    expect(text(studio)).toContain('Upgrade complete');
    studio.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledWith('dismiss');
  });

  it('failed mode offers retry when canAutoInstall', () => {
    const onSelect = vi.fn();
    const studio = new UpgradeStudioComponent({
      mode: 'failed',
      plan: plan(),
      detail: 'npm ERR! EACCES',
      onSelect,
      onCancel: vi.fn(),
    });
    const out = text(studio);
    expect(out).toContain('Upgrade failed');
    expect(out).toContain('EACCES');
    expect(out).toContain('Retry install');
    studio.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledWith('retry');
  });
});

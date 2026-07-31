import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SUPERLIORA_CHANGELOG_URL, type UpgradePlan } from '#/cli/update/plan';
import { UpgradeStudioComponent } from '#/tui/components/dialogs/upgrade/upgrade-studio';
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
    expect(out).toContain('Later');
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
    expect(out.toLowerCase()).toMatch(/discard|force checkout/);
    expect(out).toMatch(/Install/);
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

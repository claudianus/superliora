/**
 * Structural SSOT checks for the footer status-bar + Command Hub/Settings overhaul.
 * Drives shipped modules (not reimplemented stubs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_FOOTER_PREFERENCES } from '#/tui/config';
import { CommandHubComponent } from '#/tui/components/dialogs/command-hub/command-hub-component';
import { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import {
  HUB_PINNED_SETTINGS,
  SETTINGS_OPTIONS,
  isSettingsSelection,
} from '#/tui/components/dialogs/picker/settings-selector';
import { buildSettingsJumpHubItems } from '#/tui/commands/config/settings-hub-jumps';
import { SETTINGS_SEARCH_KEYWORDS } from '#/tui/commands/config/settings-keywords';
import {
  footerSlotVisible,
  resolveFooterPreferences,
} from '#/tui/components/chrome/footer/footer-preferences';
import {
  labelGoalXp,
  labelMedia,
  labelWorkingSet,
} from '#/tui/components/chrome/footer/footer-labels';
import { resolveCenterListMouse } from '#/tui/utils/ui/list-dialog-mouse';

const REPO_ROOT = join(import.meta.dirname, '../../../../..');

describe('TUI menu overhaul structure (shipped modules)', () => {
  it('defaults status bar to plain layered preferences', () => {
    expect(DEFAULT_FOOTER_PREFERENCES.labels).toBe('plain');
    expect(DEFAULT_FOOTER_PREFERENCES.modes).toBe('auto');
    expect(DEFAULT_FOOTER_PREFERENCES.index).toBe('off');
    const resolved = resolveFooterPreferences({});
    expect(resolved.labels).toBe('plain');
  });

  it('exposes Status bar in Settings options and type guard', () => {
    const statusBar = SETTINGS_OPTIONS.find((o) => o.value === 'footer');
    expect(statusBar).toBeDefined();
    expect(statusBar?.label).toMatch(/Status bar/i);
    expect(isSettingsSelection('footer')).toBe(true);
    expect(SETTINGS_SEARCH_KEYWORDS.footer).toContain('footer');
  });

  it('pins everyday settings including model, permission, theme, footer', () => {
    for (const id of ['model', 'permission', 'theme', 'footer'] as const) {
      expect(HUB_PINNED_SETTINGS).toContain(id);
    }
    const jumps = buildSettingsJumpHubItems();
    const footerJump = jumps.find((j) => j.id === 'settings.footer');
    expect(footerJump).toBeDefined();
    expect(footerJump?.searchOnly).not.toBe(true);
    expect(jumps.some((j) => j.id === 'settings.open')).toBe(true);
    // Rare panes stay search-only
    expect(jumps.find((j) => j.id === 'settings.cache')?.searchOnly).toBe(true);
  });

  it('groups Settings options into practical sections', () => {
    const sections = new Set(
      SETTINGS_OPTIONS.map((o) => o.section).filter((s): s is string => Boolean(s)),
    );
    expect(sections.has('Models')).toBe(true);
    expect(sections.has('Look & feel')).toBe(true);
    expect(sections.has('Safety')).toBe(true);
    expect(sections.has('Integrations')).toBe(true);
    expect(sections.has('System')).toBe(true);
    expect(sections.size).toBeGreaterThanOrEqual(5);
  });

  it('plain vs compact labels differ for pulses and media/working-set', () => {
    expect(labelGoalXp('plain')).not.toBe(labelGoalXp('compact'));
    expect(labelGoalXp('plain')).toBe('Goal +');
    expect(labelGoalXp('compact')).toBe('xp');
    expect(labelMedia('plain', true, true)).toBe('Media ready');
    expect(labelMedia('compact', true, true)).toBe('img·vid');
    expect(labelWorkingSet('plain', { maxWorkingSetTokens: 256_000 })).toMatch(/Working set/);
    expect(labelWorkingSet('compact', { maxWorkingSetTokens: 256_000 })).toMatch(/^ws:/);
  });

  it('footerSlotVisible hides off slots even when content exists', () => {
    expect(footerSlotVisible('off', true, true)).toBe(false);
    expect(footerSlotVisible('auto', true, false)).toBe(false);
    expect(footerSlotVisible('always', true, false)).toBe(true);
  });

  it('list dialogs expose handleNativeInput; mouse helper moves on wheel', () => {
    expect(typeof CommandHubComponent.prototype.handleNativeInput).toBe('function');
    expect(typeof ChoicePickerComponent.prototype.handleNativeInput).toBe('function');
    const move = resolveCenterListMouse(
      {
        type: 'mouse',
        action: 'wheel',
        button: 'wheel-down',
        x: 1,
        y: 1,
        raw: '',
        ctrl: false,
        alt: false,
        shift: false,
      },
      undefined,
      0,
    );
    expect(move).toEqual({ type: 'move', delta: 1 });
  });

  it('modal-shell registers handleNativeInput for center modals', () => {
    const src = readFileSync(
      join(REPO_ROOT, 'apps/liora/src/tui/controllers/dialogs/modal-shell.ts'),
      'utf8',
    );
    expect(src).toContain('handleNativeInput');
    expect(src).toContain('pushLegacyModalTarget');
    const settingsSrc = readFileSync(
      join(REPO_ROOT, 'apps/liora/src/tui/commands/config/settings.ts'),
      'utf8',
    );
    expect(settingsSrc).toMatch(/case 'footer':\s*showFooterSettings/);
  });
});

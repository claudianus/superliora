/**
 * Structural SSOT checks for the footer status-bar + Command Hub/Settings overhaul.
 * Drives shipped modules (not reimplemented stubs).
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_FOOTER_PREFERENCES } from '#/tui/config';
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
import { resolveCenterListMouse } from '#/tui/utils/ui/list-dialog-mouse';


describe('TUI menu overhaul structure (shipped modules)', () => {
  it('defaults status bar to plain layered preferences', () => {
    expect(DEFAULT_FOOTER_PREFERENCES.labels).toBe('plain');
    expect(DEFAULT_FOOTER_PREFERENCES.modes).toBe('auto');
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


  it('footerSlotVisible hides off slots even when content exists', () => {
    expect(footerSlotVisible('off', true, true)).toBe(false);
    expect(footerSlotVisible('auto', true, false)).toBe(false);
    expect(footerSlotVisible('always', true, false)).toBe(true);
  });

  it('moves list selection when scrolling the mouse wheel', () => {
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

});

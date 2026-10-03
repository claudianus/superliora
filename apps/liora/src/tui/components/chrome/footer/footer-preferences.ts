/**
 * Status-bar (footer) preference resolution — Layered defaults + Settings override.
 */

import {
  DEFAULT_FOOTER_PREFERENCES,
  type FooterLabels,
  type FooterPreferences,
  type FooterSlot,
} from '#/tui/config';
import type { AppState } from '#/tui/types';
import { ttui } from '#/tui/utils/tui-i18n';

export type { FooterLabels, FooterPreferences, FooterSlot };

export function resolveFooterPreferences(
  state: Pick<AppState, 'footer'>,
): FooterPreferences {
  return state.footer ?? DEFAULT_FOOTER_PREFERENCES;
}

/**
 * Whether a slot should paint.
 * @param hasContent — data exists to show
 * @param autoOk — layered auto predicate (ignored when mode is always/off)
 */
export function footerSlotVisible(
  mode: FooterSlot,
  hasContent: boolean,
  autoOk: boolean = true,
): boolean {
  if (mode === 'off') return false;
  if (!hasContent) return false;
  if (mode === 'always') return true;
  return autoOk;
}

export function cycleFooterSlot(mode: FooterSlot): FooterSlot {
  if (mode === 'auto') return 'always';
  if (mode === 'always') return 'off';
  return 'auto';
}

export function cycleFooterLabels(labels: FooterLabels): FooterLabels {
  return labels === 'plain' ? 'compact' : 'plain';
}

export function formatSlotModeLabel(mode: FooterSlot): string {
  if (mode === 'auto') return ttui('tui.footer.pref.slot.auto');
  if (mode === 'always') return ttui('tui.footer.pref.slot.always');
  return ttui('tui.footer.pref.slot.off');
}

/** Ordered Settings rows for the Status bar pane. */
export const FOOTER_SETTINGS_SLOTS = [
  { key: 'labels', kind: 'labels', labelKey: 'tui.footer.pref.labels.label', tipKey: 'tui.footer.pref.labels.tip' },
  { key: 'modes', kind: 'slot', labelKey: 'tui.footer.pref.modes.label', tipKey: 'tui.footer.pref.modes.tip' },
  { key: 'model', kind: 'slot', labelKey: 'tui.footer.pref.model.label', tipKey: 'tui.footer.pref.model.tip' },
  { key: 'cwd', kind: 'slot', labelKey: 'tui.footer.pref.cwd.label', tipKey: 'tui.footer.pref.cwd.tip' },
  { key: 'git', kind: 'slot', labelKey: 'tui.footer.pref.git.label', tipKey: 'tui.footer.pref.git.tip' },
  { key: 'context', kind: 'slot', labelKey: 'tui.footer.pref.context.label', tipKey: 'tui.footer.pref.context.tip' },
  { key: 'menu', kind: 'slot', labelKey: 'tui.footer.pref.menu.label', tipKey: 'tui.footer.pref.menu.tip' },
  { key: 'background', kind: 'slot', labelKey: 'tui.footer.pref.background.label', tipKey: 'tui.footer.pref.background.tip' },
  { key: 'tips', kind: 'slot', labelKey: 'tui.footer.pref.tips.label', tipKey: 'tui.footer.pref.tips.tip' },
  { key: 'quota', kind: 'slot', labelKey: 'tui.footer.pref.quota.label', tipKey: 'tui.footer.pref.quota.tip' },
  { key: 'cache', kind: 'slot', labelKey: 'tui.footer.pref.cache.label', tipKey: 'tui.footer.pref.cache.tip' },
  { key: 'pulseFleetComplete', kind: 'pulse', labelKey: 'tui.footer.pref.pulseFleetComplete.label', tipKey: 'tui.footer.pref.pulseFleetComplete.tip' },
  { key: 'pulsePermission', kind: 'pulse', labelKey: 'tui.footer.pref.pulsePermission.label', tipKey: 'tui.footer.pref.pulsePermission.tip' },
  { key: 'pulseGitChurn', kind: 'pulse', labelKey: 'tui.footer.pref.pulseGitChurn.label', tipKey: 'tui.footer.pref.pulseGitChurn.tip' },
  { key: 'pulseModelRoute', kind: 'pulse', labelKey: 'tui.footer.pref.pulseModelRoute.label', tipKey: 'tui.footer.pref.pulseModelRoute.tip' },
  { key: 'showCompact', kind: 'pulse', labelKey: 'tui.footer.pref.showCompact.label', tipKey: 'tui.footer.pref.showCompact.tip' },
] as const satisfies readonly {
  readonly key: keyof FooterPreferences;
  readonly kind: 'labels' | 'slot' | 'pulse';
  readonly labelKey: string;
  readonly tipKey: string;
}[];

export type FooterSettingsKey = (typeof FOOTER_SETTINGS_SLOTS)[number]['key'];

export function footerPrefLabel(row: (typeof FOOTER_SETTINGS_SLOTS)[number]): string {
  return ttui(row.labelKey);
}

export function footerPrefTip(row: (typeof FOOTER_SETTINGS_SLOTS)[number]): string {
  return ttui(row.tipKey);
}

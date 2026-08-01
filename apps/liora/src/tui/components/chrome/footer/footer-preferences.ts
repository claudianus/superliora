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
  if (mode === 'auto') return 'Auto';
  if (mode === 'always') return 'Always';
  return 'Off';
}

/** Ordered Settings rows for the Status bar pane. */
export const FOOTER_SETTINGS_SLOTS = [
  { key: 'labels', kind: 'labels', label: 'Label style', tip: 'plain words vs compact tokens' },
  { key: 'modes', kind: 'slot', label: 'Modes', tip: 'YOLO · Mission · Plan · Swarm…' },
  { key: 'model', kind: 'slot', label: 'Model', tip: 'Active model + thinking level' },
  { key: 'cwd', kind: 'slot', label: 'Working directory', tip: 'Short path' },
  { key: 'git', kind: 'slot', label: 'Git', tip: 'Branch · diff · PR' },
  { key: 'context', kind: 'slot', label: 'Context bar', tip: 'Usage bar + percent' },
  { key: 'goal', kind: 'slot', label: 'Goal', tip: 'When a goal is live' },
  { key: 'menu', kind: 'slot', label: 'Menu ?', tip: 'Command Hub hint' },
  { key: 'background', kind: 'slot', label: 'Background jobs', tip: 'Shell jobs + agents' },
  { key: 'tips', kind: 'slot', label: 'Rotating tips', tip: 'Auto = idle only' },
  { key: 'nextAction', kind: 'slot', label: 'Next-action coaching', tip: 'Auto = smart tips' },
  { key: 'workingSet', kind: 'slot', label: 'Working set', tip: 'Auto = under pressure' },
  { key: 'quota', kind: 'slot', label: 'Provider quota', tip: 'Auto = ≥70%' },
  { key: 'mediaReady', kind: 'slot', label: 'Media ready', tip: 'When image/video keys present' },
  { key: 'index', kind: 'slot', label: 'Repo index', tip: 'Default off · opt-in' },
  { key: 'mcp', kind: 'slot', label: 'MCP health', tip: 'Auto = errors/login only' },
  { key: 'cache', kind: 'slot', label: 'Prompt cache', tip: 'Warm / low hit rate' },
  { key: 'pulseGoalProgress', kind: 'pulse', label: 'Pulse: Goal +', tip: 'Brief after progress' },
  { key: 'pulseFleetComplete', kind: 'pulse', label: 'Pulse: Agent done', tip: 'Fleet worker finished' },
  { key: 'pulsePermission', kind: 'pulse', label: 'Pulse: Approved', tip: 'After permission approve' },
  { key: 'pulseGitChurn', kind: 'pulse', label: 'Pulse: Files changed', tip: 'Git dirty churn' },
  { key: 'pulseOpsCombo', kind: 'pulse', label: 'Pulse: On a roll', tip: 'Triple ops alignment' },
  { key: 'pulseExtensionsReload', kind: 'pulse', label: 'Pulse: Extensions reloaded', tip: '~45s after reload' },
  { key: 'pulseRuntimeDegraded', kind: 'pulse', label: 'Pulse: Runtime issues', tip: 'Search/auth/model degraded' },
  { key: 'pulseSearchCascade', kind: 'pulse', label: 'Pulse: Research active', tip: 'Search channel cascade' },
  { key: 'pulseModelRoute', kind: 'pulse', label: 'Pulse: Model route', tip: 'Failover / route switch' },
  { key: 'showCompact', kind: 'pulse', label: 'Compacting status', tip: 'Legacy pref — status bar no longer paints compact' },
  { key: 'showPromptIntelligence', kind: 'pulse', label: 'Prompt intelligence', tip: 'Suggesting / completing' },
] as const satisfies readonly {
  readonly key: keyof FooterPreferences;
  readonly kind: 'labels' | 'slot' | 'pulse';
  readonly label: string;
  readonly tip: string;
}[];

export type FooterSettingsKey = (typeof FOOTER_SETTINGS_SLOTS)[number]['key'];

/**
 * Keyboard / Keybindings settings glance — keymap SSOT tips (SSOT §9.2).
 */

import {
  formatKeymapBindingSample,
  keymapBindingsForSlash,
  keymapSurfaceCounts,
} from '../../keymap';

export interface KeybindingsGlanceInput {
  readonly bindingCount: number;
  readonly alwaysCount: number;
  readonly idleCount: number;
  readonly streamingCount: number;
  readonly missionSamples: readonly string[];
  readonly opsSamples: readonly string[];
  readonly fleetSamples: readonly string[];
}

function sampleLinesForSlash(slash: string): readonly string[] {
  const bindings = keymapBindingsForSlash(slash);
  if (bindings.length === 0) {
    return [`· ${slash} — slash only (no keybinding in registry yet)`];
  }
  return bindings.map((binding) => `· ${formatKeymapBindingSample(binding)}`);
}

export function loadKeybindingsGlance(): KeybindingsGlanceInput {
  const counts = keymapSurfaceCounts();
  return {
    bindingCount: counts.total,
    alwaysCount: counts.always,
    idleCount: counts.idle,
    streamingCount: counts.streaming,
    missionSamples: sampleLinesForSlash('/mission'),
    opsSamples: sampleLinesForSlash('/ops'),
    fleetSamples: sampleLinesForSlash('/fleet'),
  };
}

export function buildKeybindingsSettingsLines(input: KeybindingsGlanceInput): readonly string[] {
  return [
    '── Keyboard / Keybindings (read-only) ────────',
    'Shortcut reference — Sovereign Reform §9.2.',
    '',
    '── Live registry (keymap.ts) ────────────────',
    `· ${String(input.bindingCount)} bindings total — always ${String(input.alwaysCount)} · idle ${String(input.idleCount)} · streaming ${String(input.streamingCount)}`,
    '· Footer tips, Command Hub cheatsheet, and /help consume this list',
    '· Do not fork shortcut copy elsewhere',
    '',
    '── Mission / Ops / Fleet samples ────────────',
    ...input.missionSamples,
    ...input.opsSamples,
    ...input.fleetSamples,
    '',
    '── Tips ─────────────────────────────────────',
    '· /help — full keyboard shortcut reference in the TUI',
    '· Ctrl-K — Command Hub menu (search slash commands + shortcuts)',
    '· ? — Command Hub when the prompt is empty',
    '· Custom keybinding editor — future slice (not editable here)',
    '',
    '── Related ──────────────────────────────────',
    '· Settings → Editor — external editor command (Ctrl-G)',
    '· Settings → Appearance — motion / Visual Quality levels',
    '',
    'No keybinding editor here — see /help and keymap.ts.',
  ];
}

/**
 * OS primary-modifier hint SSOT (Cmd on darwin, Ctrl elsewhere).
 * Matchers live in `matchesPrimaryMod`; user-visible chords must go through here
 * so help/footer/toasts never advertise a dead Ctrl-* on macOS.
 */

import { primaryModLabel } from '#/tui/renderer';
import { ttui } from '#/tui/utils/tui-i18n';

export type PrimaryHintPlatform = NodeJS.Platform | string;

/** Display chord for the OS primary modifier — same label the matcher documents. */
export function formatPrimaryChord(
  key: string,
  platform: PrimaryHintPlatform = process.platform,
): string {
  return `${primaryModLabel(platform)}-${key}`;
}

/** Alias used by keymap / footer call sites. */
export function primaryChord(
  key: string,
  platform: PrimaryHintPlatform = process.platform,
): string {
  return formatPrimaryChord(key, platform);
}

/**
 * i18n keys whose `{chord}` placeholder is the OS primary modifier.
 * Letter is the advertised key (R/C/K/…), not the catalog id.
 */
const PRIMARY_HINT_LETTERS: Readonly<Record<string, string>> = {
  'tui.common.cancelCtrlC': 'C',
  'tui.footer.exitConfirmCtrlC': 'C',
  'tui.footer.exitConfirmCtrlD': 'D',
  'tui.footer.exitConfirmPrimaryC': 'C',
  'tui.footer.exitConfirmPrimaryD': 'D',
  'tui.footer.next.history': 'O',
  'tui.history.searchToast': 'R',
  'tui.history.waitToast': 'C',
  'tui.model.cannotSwitchStreaming': 'C',
  'tui.rewind.streamingBlocked': 'C',
  'tui.session.cannotSwitchStreaming': 'C',
  'tui.settings.editor.desc': 'G',
  'tui.slash.editor': 'G',
  'tui.slash.help': 'K',
  'tui.slash.settings': 'K',
  'tui.tip.ctrlB': 'B',
  'tui.tip.ctrlC': 'C',
  'tui.tip.ctrlK': 'K',
  'tui.tip.ctrlO': 'O',
  'tui.tip.ctrlS': 'S',
  'tui.tip.help': 'K',
  'tui.undo.streaming': 'C',
};

/** Resolve a catalog string, injecting `{chord}` when the key is a primary hint. */
export function shortcutHint(
  i18nKey: string,
  extra?: Record<string, string | number>,
): string {
  const letter = PRIMARY_HINT_LETTERS[i18nKey];
  if (letter === undefined) return ttui(i18nKey, extra);
  return ttui(i18nKey, { chord: formatPrimaryChord(letter), ...extra });
}

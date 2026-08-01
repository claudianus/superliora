import type { AutocompleteItem } from '#/tui/renderer';

import { showTranscriptDetailPicker } from '../config/appearance/appearance-settings';
import { handleAppearanceCommand } from '../config/appearance/appearance';
import type { SlashCommandHost } from '../hub/dispatch';
import {
  TRANSCRIPT_DETAIL_LEVELS,
  isTranscriptDetailLevel,
} from '#/tui/features/transcript/transcript-density';

/**
 * `/transcript` — quick switch for transcript density (PREMIUM.md §7.9).
 * No-arg opens a live picker; with a level, delegates to
 * `/appearance transcript-detail <level>` so persistence, status output,
 * and Settings share one code path.
 */

const LEVEL_HINTS: Record<(typeof TRANSCRIPT_DETAIL_LEVELS)[number], string> = {
  minimal: 'One-line tools + per-turn chain summary',
  compact: 'One-line tool headers; click a card to expand',
  standard: 'Default detail (current behavior)',
  full: 'Every tool card expanded',
};

export function transcriptArgumentCompletions(args: string): AutocompleteItem[] {
  const tokens = args.trim().split(/\s+/);
  if (tokens.length > 1) return [];
  const partial = (tokens[0] ?? '').toLowerCase();
  return TRANSCRIPT_DETAIL_LEVELS.filter((level) => level.startsWith(partial)).map((level) => ({
    value: level,
    label: level,
    description: LEVEL_HINTS[level],
  }));
}

export async function handleTranscriptCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const raw = args.trim().toLowerCase();
  if (raw.length === 0) {
    showTranscriptDetailPicker(host);
    return;
  }
  if (raw === 'help' || raw === 'status') {
    host.showNotice(
      'Transcript',
      `Detail: ${host.state.transcriptDetail}\n` +
        `Usage: /transcript [<${TRANSCRIPT_DETAIL_LEVELS.join('|')}>]\n` +
        'No args opens the density picker · minimal: one-line tools + chain summary\n' +
        'compact: one-line tools · standard: default · full: everything expanded',
    );
    return;
  }
  if (!isTranscriptDetailLevel(raw)) {
    host.showError(
      `Unknown transcript detail: ${raw} (expected ${TRANSCRIPT_DETAIL_LEVELS.join('|')})`,
    );
    return;
  }
  await handleAppearanceCommand(host, `transcript-detail ${raw}`);
}

import type { AutocompleteItem } from '#/tui/renderer';

import { handleAppearanceCommand } from './config';
import type { SlashCommandHost } from './dispatch';
import {
  TRANSCRIPT_DETAIL_LEVELS,
  isTranscriptDetailLevel,
} from '#/tui/features/transcript/transcript-density';

/**
 * `/transcript` — quick switch for transcript density (PREMIUM.md §7.9).
 * Delegates to `/appearance transcript-detail <level>` so persistence,
 * status output, and the Settings selector share one code path; the only
 * extra behavior is the no-arg status line.
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
  if (raw.length === 0 || raw === 'help') {
    host.showNotice(
      'Transcript',
      `Detail: ${host.state.transcriptDetail}\n` +
        `Usage: /transcript <${TRANSCRIPT_DETAIL_LEVELS.join('|')}>\n` +
        'minimal: one-line tools + chain summary · compact: one-line tools\n' +
        'standard: default · full: everything expanded',
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

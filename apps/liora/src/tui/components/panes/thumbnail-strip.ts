/**
 * Thumbnail Strip — compact representation of quests when in pinned mode
 * or when quest count exceeds 12.
 *
 * Each thumbnail shows: quest name (truncated) + state icon + blink if attention.
 * Height: 1–2 rows per thumbnail.
 *
 * AC-2: 12+ quests → thumbnail strip with status blink for attention states.
 */

import {
  type Quest,
  questStateIcon,
  ATTENTION_STATES,
} from '../../controllers/quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThumbnailEntry {
  readonly questId: string;
  readonly label: string;
  readonly icon: string;
  readonly needsAttention: boolean;
  readonly isPinned: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum label width in columns before truncation. */
const MAX_LABEL_WIDTH = 12;

// ---------------------------------------------------------------------------
// Thumbnail Strip Builder
// ---------------------------------------------------------------------------

/**
 * Build thumbnail entries from a quest list.
 * Used by the dashboard renderer to draw the strip.
 */
export function buildThumbnailStrip(
  quests: readonly Quest[],
  pinnedQuestId: string | null,
  blinkPhase: boolean,
): readonly ThumbnailEntry[] {
  return quests
    .filter((q) => q.id !== pinnedQuestId)
    .map((q) => {
      const needsAttention = ATTENTION_STATES.has(q.state);
      const icon = needsAttention && blinkPhase
        ? '!'
        : questStateIcon(q.state);
      const label = truncateLabel(q.name, MAX_LABEL_WIDTH);
      return {
        questId: q.id,
        label,
        icon,
        needsAttention,
        isPinned: false,
      };
    });
}

/**
 * Render the thumbnail strip as a single-line string.
 * Format: [icon label] [icon label] ...
 *
 * When `showIndex` is true (pinned mode), each segment is prefixed with its
 * 1-based hotkey so the user can jump directly to a quest with 1–9 (Gen 6b).
 */
export function renderThumbnailStripLine(
  entries: readonly ThumbnailEntry[],
  maxWidth: number,
  showIndex = false,
): string {
  const parts: string[] = [];
  let usedWidth = 0;

  for (const [i, entry] of entries.entries()) {
    const prefix = showIndex && i < 9 ? `${String(i + 1)}:` : '';
    const segment = `${prefix}[${entry.icon} ${entry.label}]`;
    const segmentWidth = segment.length + 1; // +1 for space separator
    if (usedWidth + segmentWidth > maxWidth) break;
    parts.push(segment);
    usedWidth += segmentWidth;
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateLabel(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '…';
}

/**
 * Thumbnail Strip — compact representation of quests when in pinned mode
 * or when quest count exceeds 12.
 *
 * Each thumbnail shows: quest name (truncated) + state icon + blink if attention.
 * Height: 1–2 rows per thumbnail.
 *
 * AC-2: 12+ quests → thumbnail strip with status blink for attention states.
 */

import { currentTheme } from '#/tui/theme';

import {
  type Quest,
  type QuestState,
  questStateIcon,
  questStateColorToken,
  questHealthScore,
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
  /** Gen 37: quest state, used to color the thumbnail segment. */
  readonly state: QuestState;
  /** Gen 38: todo progress ({ done, total }), if any. */
  readonly todoProgress?: { done: number; total: number } | undefined;
  /** Gen 60: context window usage (0–1), if known. */
  readonly contextUsage?: number | undefined;
  /** Gen 62: composite health score (0–100). */
  readonly healthScore: number;
  /** Gen 104: true when the quest is awaiting an operator approval decision. */
  readonly awaitingApproval: boolean;
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
  now: number = Date.now(),
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
        state: q.state,
        todoProgress: q.todoProgress,
        contextUsage: q.contextUsage,
        // Gen 62: composite health so the strip surfaces at-risk quests.
        healthScore: questHealthScore(q, now),
        // Gen 104: flag approval-pending quests so they stand out in the strip.
        awaitingApproval: q.state === 'waiting-approval',
      };
    });
}

/**
 * Render the thumbnail strip as a single-line string.
 * Format: [icon label] [icon label] ...
 *
 * When `showIndex` is true (pinned mode), each segment is prefixed with its
 * 1-based hotkey so the user can jump directly to a quest with 1–9 (Gen 6b).
 * Gen 37: each segment is colorized by quest state for at-a-glance scanning.
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
    // Gen 38: append a compact todo count so sibling progress is visible
    // without unpinning.
    const todo =
      entry.todoProgress !== undefined && entry.todoProgress.total > 0
        ? ` ${String(entry.todoProgress.done)}/${String(entry.todoProgress.total)}`
        : '';
    // Gen 60: append a compact context-usage tag so context pressure is
    // visible across the fleet without unpinning.
    const ctx =
      entry.contextUsage !== undefined && entry.contextUsage > 0
        ? ` ${String(Math.round(entry.contextUsage * 100))}%`
        : '';
    // Gen 62: append a compact health score so at-risk quests stand out in
    // the strip without unpinning.
    const health = ` ♥${String(entry.healthScore)}`;
    // Gen 104: mark approval-pending quests so the operator sees which siblings
    // need a decision, complementing the w-key attention cycle.
    const approval = entry.awaitingApproval ? ' ⏳' : '';
    const plainSegment = `${prefix}[${entry.icon} ${entry.label}${todo}${ctx}${health}${approval}]`;
    const segmentWidth = plainSegment.length + 1; // +1 for space separator
    if (usedWidth + segmentWidth > maxWidth) break;
    const token = questStateColorToken(entry.state);
    parts.push(currentTheme.fg(token, plainSegment));
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

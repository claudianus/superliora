/**
 * Bento Dashboard — renders the quest grid as text cells.
 *
 * Dashboard mode: each quest rendered as a 3-line cell block showing the
 * minimum information set (name, state icon, created/last-active elapsed,
 * +N -M change count, plan step). Pulsing quests get an attention marker.
 *
 * Pinned mode: the pinned quest's expand view (live stream) fills the main
 * area; the remaining quests collapse into a thumbnail strip below.
 *
 * The geometric no-clip guarantee (cell bounds within viewport) is enforced
 * by QuestGridController.validateBounds against measureBentoGridLayout and
 * asserted in tests; this component owns the textual presentation only.
 *
 * AC-1: 6-state visual encoding, minimum info set always shown, cosmetic
 *       never displaces information.
 */

import { Container } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';

import {
  buildThumbnailStrip,
  renderThumbnailStripLine,
} from './thumbnail-strip';
import type { QuestExpandView } from './quest-expand-view';
import type { AttentionController } from '../../controllers/attention-controller';
import type { PinController } from '../../controllers/pin-controller';
import type { QuestGridController } from '../../controllers/quest-grid-controller';
import {
  formatChangeCount,
  formatElapsed,
  questStateIcon,
  type Quest,
} from '../../controllers/quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BentoDashboardOptions {
  readonly gridController: QuestGridController;
  readonly attentionController: AttentionController;
  readonly pinController: PinController;
  /** Per-quest expand views (live stream buffers), keyed by quest id. */
  readonly expandViews: ReadonlyMap<string, QuestExpandView>;
  /** Blink phase for strip/attention indicators (toggled by a timer). */
  readonly blinkPhase: boolean;
  /** Current time provider for elapsed computation (injectable for tests). */
  readonly now?: () => number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Height (lines) of one dashboard cell block. */
const CELL_BLOCK_HEIGHT = 3;

// ---------------------------------------------------------------------------
// BentoDashboardComponent
// ---------------------------------------------------------------------------

export class BentoDashboardComponent extends Container {
  private readonly gridController: QuestGridController;
  private readonly attentionController: AttentionController;
  private readonly pinController: PinController;
  private readonly expandViews: ReadonlyMap<string, QuestExpandView>;
  private readonly blinkPhase: boolean;
  private readonly now: () => number;

  constructor(options: BentoDashboardOptions) {
    super();
    this.gridController = options.gridController;
    this.attentionController = options.attentionController;
    this.pinController = options.pinController;
    this.expandViews = options.expandViews;
    this.blinkPhase = options.blinkPhase;
    this.now = options.now ?? (() => Date.now());
  }

  override render(width: number): string[] {
    const quests = this.gridController.getQuests();
    if (quests.length === 0) {
      return [currentTheme.dim('  No active quests — start a session to populate the dashboard.')];
    }

    const pinned = this.pinController.getPinnedQuest();
    if (pinned) {
      return this.renderPinned(pinned, quests, width);
    }
    return this.renderDashboard(quests, width);
  }

  // -------------------------------------------------------------------------
  // Dashboard mode — one cell block per quest
  // -------------------------------------------------------------------------

  private renderDashboard(quests: readonly Quest[], width: number): string[] {
    const lines: string[] = [];
    const now = this.now();
    for (const quest of quests) {
      const block = this.renderCellBlock(quest, width, now);
      lines.push(...block);
    }
    return lines;
  }

  private renderCellBlock(quest: Quest, width: number, now: number): string[] {
    const pulsing = this.attentionController.isPulsing(quest.id);
    const marker = pulsing ? (this.blinkPhase ? '⚡' : '·') : ' ';
    const icon = questStateIcon(quest.state);
    const safeWidth = Math.max(1, width - 2);

    const created = formatElapsed(Math.max(0, now - quest.createdAt));
    const idle = formatElapsed(Math.max(0, now - quest.lastActivityAt));
    const changes = formatChangeCount(quest.changeCount);

    const line1 = `${marker}${icon} ${quest.name}  [${quest.state}]`;
    const line2 = `  ⏱ ${created}  idle ${idle}  ${changes}   ${shorten(quest.worktreePath, safeWidth)}`;
    const line3 = `  ▸ ${quest.planStep}`;

    return [
      clip(line1, width),
      currentTheme.dim(clip(line2, width)),
      currentTheme.dim(clip(line3, width)),
    ];
  }

  // -------------------------------------------------------------------------
  // Pinned mode — expand view + thumbnail strip
  // -------------------------------------------------------------------------

  private renderPinned(pinned: Quest, allQuests: readonly Quest[], width: number): string[] {
    const expandView = this.expandViews.get(pinned.id);
    const lines: string[] = [];

    if (expandView) {
      const visibleRows = Math.max(1, 24 - 2); // reserve strip + spacing
      expandView.setMaxVisibleLines(visibleRows);
      const stream = expandView.render(pinned, width);
      for (const row of stream) {
        lines.push(clip(row, width));
      }
    } else {
      lines.push(clip(`── ${pinned.name} [${pinned.state}] (no stream) ──`, width));
    }

    // Thumbnail strip for the non-pinned quests
    const entries = buildThumbnailStrip(allQuests, pinned.id, this.blinkPhase);
    if (entries.length > 0) {
      const strip = renderThumbnailStripLine(entries, width);
      lines.push(currentTheme.dim(clip(strip, width)));
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clip(line: string, width: number): string {
  if (width <= 0) return '';
  return line.length > width ? line.slice(0, width) : line;
}

function shorten(path: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  if (path.length <= maxLen) return path;
  return '…' + path.slice(-(maxLen - 1));
}

/** Height of a single dashboard cell block (for layout accounting). */
export const BENTO_CELL_BLOCK_HEIGHT = CELL_BLOCK_HEIGHT;

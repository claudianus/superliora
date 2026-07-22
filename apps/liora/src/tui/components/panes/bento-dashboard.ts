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

import { Container, Key, matchesKey, type Focusable } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';

import {
  buildThumbnailStrip,
  renderThumbnailStripLine,
} from './thumbnail-strip';
import type { QuestExpandView } from './quest-expand-view';
import type { AttentionController } from '../../controllers/attention-controller';
import type { ApprovalController } from '../../controllers/approval-controller';
import type { PinController } from '../../controllers/pin-controller';
import type { QuestGridController } from '../../controllers/quest-grid-controller';
import {
  formatChangeCount,
  formatElapsed,
  questStateIcon,
  type Quest,
  type QuestState,
} from '../../controllers/quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BentoDashboardOptions {
  readonly gridController: QuestGridController;
  readonly attentionController: AttentionController;
  readonly pinController: PinController;
  readonly approvalController?: ApprovalController;
  /** Per-quest expand views (live stream buffers), keyed by quest id. */
  readonly expandViews: ReadonlyMap<string, QuestExpandView>;
  /** Blink phase for strip/attention indicators (toggled by a timer). */
  readonly blinkPhase: boolean;
  /** Current time provider for elapsed computation (injectable for tests). */
  readonly now?: () => number;
  /** Close the dashboard overlay (Esc / Ctrl+G). */
  readonly onClose: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Height (lines) of one dashboard cell block. */
const CELL_BLOCK_HEIGHT = 3;

// ---------------------------------------------------------------------------
// BentoDashboardComponent
// ---------------------------------------------------------------------------

export class BentoDashboardComponent extends Container implements Focusable {
  focused = false;

  private readonly gridController: QuestGridController;
  private readonly attentionController: AttentionController;
  private readonly pinController: PinController;
  private readonly approvalController: ApprovalController | undefined;
  private readonly expandViews: ReadonlyMap<string, QuestExpandView>;
  private blinkPhase: boolean;
  private readonly now: () => number;
  private readonly onClose: () => void;

  constructor(options: BentoDashboardOptions) {
    super();
    this.gridController = options.gridController;
    this.attentionController = options.attentionController;
    this.pinController = options.pinController;
    this.approvalController = options.approvalController;
    this.expandViews = options.expandViews;
    this.blinkPhase = options.blinkPhase;
    this.now = options.now ?? (() => Date.now());
    this.onClose = options.onClose;
  }

  /** Update the blink phase (called by the dashboard refresh timer). */
  setBlinkPhase(phase: boolean): void {
    this.blinkPhase = phase;
  }

  // -------------------------------------------------------------------------
  // Keyboard input (Focusable)
  // -------------------------------------------------------------------------

  handleInput(data: string): void {
    const k = printableChar(data);

    // Esc or Ctrl+G → close dashboard
    if (matchesKey(data, Key.escape) || data === '\x07') {
      this.onClose();
      return;
    }

    const pinned = this.pinController.getPinnedQuest();

    // Pinned mode: j/k/arrows scroll the expand view; Enter/p unpins.
    if (pinned) {
      const expandView = this.expandViews.get(pinned.id);
      if (matchesKey(data, Key.down) || k === 'j') {
        expandView?.scrollDown(1);
        return;
      }
      if (matchesKey(data, Key.up) || k === 'k') {
        expandView?.scrollUp(1);
        return;
      }
      // Gen 15: fast scrolling — page jumps and top/bottom.
      if (matchesKey(data, Key.pageDown)) {
        expandView?.scrollPageDown();
        return;
      }
      if (matchesKey(data, Key.pageUp)) {
        expandView?.scrollPageUp();
        return;
      }
      if (k === 'G') {
        expandView?.scrollToBottom();
        return;
      }
      if (k === 'g') {
        expandView?.scrollToTop();
        return;
      }
      // Enter or p → unpin back to the dashboard grid
      if (matchesKey(data, Key.enter) || k === 'p') {
        this.pinController.togglePin(pinned.id);
        return;
      }
      // Gen 6b: 1–9 → jump directly to the Nth thumbnail quest (switch_context).
      if (k.length === 1 && k >= '1' && k <= '9') {
        const stripQuests = this.pinController.getStripQuests();
        const target = stripQuests[Number(k) - 1];
        if (target) {
          this.pinController.unpin();
          this.pinController.pin(target.id);
        }
        return;
      }
      // a/x/r → approval actions on the pinned quest
      if (this.approvalController && (k === 'a' || k === 'x' || k === 'r')) {
        const action = k === 'a' ? 'approve' : k === 'x' ? 'reject' : 'rewind';
        void this.approvalController.handleAction(pinned, action);
        return;
      }
      if (k === 'q') {
        this.onClose();
      }
      return;
    }

    // Dashboard mode: j/k or arrows → move focus
    if (matchesKey(data, Key.down) || k === 'j') {
      this.gridController.focusNext();
      return;
    }
    if (matchesKey(data, Key.up) || k === 'k') {
      this.gridController.focusPrev();
      return;
    }

    // Enter or p → toggle pin on focused quest
    if (matchesKey(data, Key.enter) || k === 'p') {
      const focusedId = this.gridController.getFocusedQuestId();
      if (focusedId) this.pinController.togglePin(focusedId);
      return;
    }

    // a/x/r → approval actions on focused quest
    if (this.approvalController && (k === 'a' || k === 'x' || k === 'r')) {
      const focusedId = this.gridController.getFocusedQuestId();
      const quest = focusedId ? this.gridController.getQuest(focusedId) : undefined;
      if (quest) {
        const action = k === 'a' ? 'approve' : k === 'x' ? 'reject' : 'rewind';
        void this.approvalController.handleAction(quest, action);
      }
      return;
    }

    // q → close dashboard
    if (k === 'q') {
      this.onClose();
    }
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
    const focused = this.gridController.getFocusedQuestId() === quest.id;
    const marker = pulsing ? (this.blinkPhase ? '⚡' : '·') : ' ';
    const focusIndicator = focused ? '▶ ' : '  ';
    const icon = questStateIcon(quest.state);
    const safeWidth = Math.max(1, width - 4);

    const created = formatElapsed(Math.max(0, now - quest.createdAt));
    const idle = formatElapsed(Math.max(0, now - quest.lastActivityAt));
    const changes = formatChangeCount(quest.changeCount);

    // Gen 9: progress indicators (todo + context usage)
    const progressParts: string[] = [];
    if (quest.todoProgress !== undefined && quest.todoProgress.total > 0) {
      const { done, total } = quest.todoProgress;
      progressParts.push(`☑ ${String(done)}/${String(total)}`);
    }
    if (quest.contextUsage !== undefined && quest.contextUsage > 0) {
      const pct = Math.round(quest.contextUsage * 100);
      progressParts.push(`ctx ${String(pct)}%`);
    }
    const progress = progressParts.length > 0 ? `  ${progressParts.join('  ')}` : '';

    // Gen 12: color-code the state icon + badge for at-a-glance scanning.
    const stateToken = stateColorToken(quest.state);
    const badgeText = `${icon} [${quest.state}]`;
    const badge = currentTheme.fg(stateToken, badgeText);
    const prefix = `${focusIndicator}${marker}`;
    // Use the plain-text badge length (not ANSI-inflated) for the name budget.
    const nameBudget = Math.max(1, width - prefix.length - badgeText.length - 2);
    const name = quest.name.length > nameBudget ? quest.name.slice(0, nameBudget) : quest.name;
    const line1 = `${prefix}${badge} ${name}`;
    const line2 = `${focusIndicator}  ⏱ ${created}  idle ${idle}  ${changes}${progress}   ${shorten(quest.worktreePath, safeWidth)}`;
    // Gen 13: when awaiting approval, surface what needs a decision.
    const stepText =
      quest.state === 'waiting-approval' && quest.pendingApprovalSummary !== undefined
        ? quest.pendingApprovalSummary
        : quest.planStep;
    const line3 = `${focusIndicator}  ▸ ${stepText}`;

    return [
      // line1 is width-managed manually (badge carries ANSI color), so skip clip.
      line1,
      currentTheme.dim(clip(line2, width)),
      quest.state === 'waiting-approval'
        ? currentTheme.fg('warning', clip(line3, width))
        : currentTheme.dim(clip(line3, width)),
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

    // Thumbnail strip for the non-pinned quests (numbered for direct jump, Gen 6b)
    const entries = buildThumbnailStrip(allQuests, pinned.id, this.blinkPhase);
    if (entries.length > 0) {
      const strip = renderThumbnailStripLine(entries, width, true);
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

/**
 * Gen 12: map a quest state to its theme color token so the 6 lifecycle
 * states are scannable at a glance.
 */
function stateColorToken(state: QuestState): 'textMuted' | 'accent' | 'warning' | 'success' | 'error' {
  switch (state) {
    case 'idle':
      return 'textMuted';
    case 'running':
      return 'accent';
    case 'blocked':
    case 'waiting-approval':
      return 'warning';
    case 'done':
      return 'success';
    case 'failed':
      return 'error';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function shorten(path: string, maxLen: number): string {
  if (maxLen <= 0) return '';
  if (path.length <= maxLen) return path;
  return '…' + path.slice(-(maxLen - 1));
}

/** Height of a single dashboard cell block (for layout accounting). */
export const BENTO_CELL_BLOCK_HEIGHT = CELL_BLOCK_HEIGHT;

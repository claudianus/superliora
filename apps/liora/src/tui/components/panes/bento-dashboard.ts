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
import { highlightStreamLine } from './quest-expand-view';
import type { AttentionController } from '../../controllers/attention-controller';
import type { ApprovalController } from '../../controllers/approval-controller';
import type { PinController } from '../../controllers/pin-controller';
import type { QuestGridController } from '../../controllers/quest-grid-controller';
import {
  ATTENTION_STATES,
  formatChangeCount,
  formatElapsed,
  questStateIcon,
  questStateColorToken,
  questHealthScore,
  renderContextBar,
  contextSeverityToken,
  renderTodoBar,
  sortModeLabel,
  type Quest,
  type QuestChangeCount,
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
// Gen 31: idle-duration thresholds for stalled-session detection
// ---------------------------------------------------------------------------

/** Idle longer than this → warning color on the metadata line. */
const IDLE_WARN_MS = 5 * 60 * 1000;
/** Idle longer than this → error color on the metadata line. */
const IDLE_ERROR_MS = 15 * 60 * 1000;

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

  // Gen 16: inline search state
  private searchMode = false;
  private searchBuffer = '';

  // Gen 67: line-number jump state (`:N` in pinned mode)
  private lineJumpMode = false;
  private lineJumpBuffer = '';

  // Gen 22: context-aware help overlay
  private helpVisible = false;

  // Gen 65: pinned quest info overlay
  private infoVisible = false;

  // Gen 66: dashboard fleet summary overlay
  private fleetInfoVisible = false;

  // Gen 68: dashboard fleet changes overlay
  private fleetChangesVisible = false;

  // Gen 70: pinned stream stats overlay
  private streamStatsVisible = false;

  // Gen 24: dashboard quest filter
  private filterMode = false;
  private filterBuffer = '';

  // Gen 44: track the pinned quest id to detect pin switches and jump the
  // newly pinned expand view to the live tail.
  private lastPinnedId: string | null = null;

  // Gen 45: hide the thumbnail strip for a full-height expand view.
  private stripHidden = false;

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

    // Gen 24: dashboard filter mode — capture typing until Enter/Esc.
    if (this.filterMode) {
      if (matchesKey(data, Key.escape)) {
        this.filterMode = false;
        this.filterBuffer = '';
        this.gridController.setFilter('');
        return;
      }
      if (matchesKey(data, Key.enter)) {
        this.filterMode = false;
        return;
      }
      if (data === '\x7f' || data === '\b') {
        this.filterBuffer = this.filterBuffer.slice(0, -1);
      } else if (k.length === 1) {
        this.filterBuffer += k;
      }
      this.gridController.setFilter(this.filterBuffer);
      return;
    }

    // Gen 16: inline search mode — capture typing until Enter/Esc.
    if (this.searchMode) {
      if (matchesKey(data, Key.escape)) {
        this.searchMode = false;
        this.searchBuffer = '';
        this.expandViews.get(this.pinController.getPinnedQuest()?.id ?? '')?.clearSearch();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        this.searchMode = false;
        return;
      }
      if (data === '\x7f' || data === '\b') {
        // Backspace: shrink the query.
        this.searchBuffer = this.searchBuffer.slice(0, -1);
      } else if (k.length === 1) {
        this.searchBuffer += k;
      }
      const view = this.expandViews.get(this.pinController.getPinnedQuest()?.id ?? '');
      view?.startSearch(this.searchBuffer);
      return;
    }

    // Gen 67: line-number jump mode — capture digits until Enter/Esc.
    if (this.lineJumpMode) {
      if (matchesKey(data, Key.escape)) {
        this.lineJumpMode = false;
        this.lineJumpBuffer = '';
        return;
      }
      if (matchesKey(data, Key.enter)) {
        const lineNum = Number.parseInt(this.lineJumpBuffer, 10);
        if (!Number.isNaN(lineNum) && lineNum > 0) {
          const view = this.expandViews.get(this.pinController.getPinnedQuest()?.id ?? '');
          view?.jumpToLineNumber(lineNum);
        }
        this.lineJumpMode = false;
        this.lineJumpBuffer = '';
        return;
      }
      if (data === '\x7f' || data === '\b') {
        this.lineJumpBuffer = this.lineJumpBuffer.slice(0, -1);
      } else if (k.length === 1 && k >= '0' && k <= '9') {
        this.lineJumpBuffer += k;
      }
      return;
    }

    // Esc or Ctrl+G → close dashboard
    if (matchesKey(data, Key.escape) || data === '\x07') {
      // Gen 22: if help is open, close it first instead of the whole dashboard.
      if (this.helpVisible) {
        this.helpVisible = false;
        return;
      }
      // Gen 65: if the info overlay is open, close it first.
      if (this.infoVisible) {
        this.infoVisible = false;
        return;
      }
      // Gen 66: if the fleet summary overlay is open, close it first.
      if (this.fleetInfoVisible) {
        this.fleetInfoVisible = false;
        return;
      }
      // Gen 68: if the fleet changes overlay is open, close it first.
      if (this.fleetChangesVisible) {
        this.fleetChangesVisible = false;
        return;
      }
      // Gen 70: if the stream stats overlay is open, close it first.
      if (this.streamStatsVisible) {
        this.streamStatsVisible = false;
        return;
      }
      // Gen 24: if a filter is active, clear it first instead of closing.
      if (this.filterBuffer !== '') {
        this.filterBuffer = '';
        this.gridController.setFilter('');
        return;
      }
      // Gen 56: if pinned and diff-only is active, exit diff-only first.
      const pinned = this.pinController.getPinnedQuest();
      if (pinned) {
        const view = this.expandViews.get(pinned.id);
        if (view?.isDiffOnly()) {
          view.toggleDiffOnly();
          return;
        }
        // Gen 43: otherwise unpin first instead of closing.
        this.pinController.unpin();
        return;
      }
      this.onClose();
      return;
    }

    // Gen 22: ? toggles the context-aware help overlay.
    if (k === '?') {
      this.helpVisible = !this.helpVisible;
      return;
    }
    // While help is shown, any other key dismisses it (and is consumed).
    if (this.helpVisible) {
      this.helpVisible = false;
      return;
    }
    // Gen 65: while the info overlay is shown, any other key dismisses it.
    if (this.infoVisible) {
      this.infoVisible = false;
      return;
    }
    // Gen 66: while the fleet summary overlay is shown, any key dismisses it.
    if (this.fleetInfoVisible) {
      this.fleetInfoVisible = false;
      return;
    }
    // Gen 68: while the fleet changes overlay is shown, any key dismisses it.
    if (this.fleetChangesVisible) {
      this.fleetChangesVisible = false;
      return;
    }
    // Gen 70: while the stream stats overlay is shown, any key dismisses it.
    if (this.streamStatsVisible) {
      this.streamStatsVisible = false;
      return;
    }

    const pinned = this.pinController.getPinnedQuest();

    // Pinned mode: j/k/arrows scroll the expand view; Enter/p unpins.
    if (pinned) {
      const expandView = this.expandViews.get(pinned.id);
      // Gen 65: i → toggle the quest info overlay.
      if (k === 'i') {
        this.infoVisible = true;
        return;
      }
      // Gen 70: T → toggle the stream stats overlay.
      if (k === 'T') {
        this.streamStatsVisible = true;
        return;
      }
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
      // Gen 41: Space → page down (pager-style), for fast stream skimming.
      if (matchesKey(data, Key.space)) {
        expandView?.scrollPageDown();
        return;
      }
      // Gen 42: b → page up (pager-style), pairs with Space for less-like nav.
      if (k === 'b') {
        expandView?.scrollPageUp();
        return;
      }
      // Gen 45: f → toggle the thumbnail strip for a full-height expand view.
      if (k === 'f') {
        this.stripHidden = !this.stripHidden;
        return;
      }
      // Gen 50: d → toggle diff-only view (focus on code changes).
      if (k === 'd') {
        expandView?.toggleDiffOnly();
        return;
      }
      // Gen 57: w → toggle auto-follow of the live tail.
      if (k === 'w') {
        expandView?.toggleFollowTail();
        return;
      }
      // Gen 58: F → toggle fullscreen stream (hide the header).
      if (k === 'F') {
        expandView?.toggleFullscreen();
        return;
      }
      // Gen 59: R → clear the stream buffer for a fresh view.
      if (k === 'R') {
        expandView?.clearStream();
        return;
      }
      // Gen 60: y → review from the top (jump to line 1, pause auto-follow).
      if (k === 'y') {
        expandView?.reviewFromTop();
        return;
      }
      // Gen 61: t → toggle relative-timestamp display in the gutter.
      if (k === 't') {
        expandView?.toggleTimestamps();
        return;
      }
      // Gen 62: e/E → jump to the next/previous error or warning line.
      if (k === 'e') {
        expandView?.jumpToNextError();
        return;
      }
      if (k === 'E') {
        expandView?.jumpToPrevError();
        return;
      }
      // Gen 91: ]/[ → jump to the next/previous diff file header.
      if (k === ']') {
        expandView?.jumpToNextDiffFile();
        return;
      }
      if (k === '[') {
        expandView?.jumpToPrevDiffFile();
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
      // Gen 16: / starts inline search; n/N jump between matches.
      if (k === '/') {
        this.searchMode = true;
        this.searchBuffer = '';
        return;
      }
      // Gen 67: : starts line-number jump mode.
      if (k === ':') {
        this.lineJumpMode = true;
        this.lineJumpBuffer = '';
        return;
      }
      if (k === 'n') {
        expandView?.searchNext();
        return;
      }
      if (k === 'N') {
        expandView?.searchPrev();
        return;
      }
      // Enter or p → unpin back to the dashboard grid
      if (matchesKey(data, Key.enter) || k === 'p') {
        this.pinController.togglePin(pinned.id);
        return;
      }
      // Gen 37: - → jump back to the previously pinned quest.
      if (k === '-') {
        this.pinController.pinPrevious();
        return;
      }
      // Gen 39: h/l → cycle the pin to the previous/next quest (switch_context
      // without unpinning; j/k stay bound to scrolling).
      if (k === 'l') {
        this.pinController.pinNextInStrip();
        return;
      }
      if (k === 'h') {
        this.pinController.pinPrevInStrip();
        return;
      }
      // Gen 52: w → cycle the pin to the next quest needing attention (triage).
      if (k === 'w') {
        this.pinController.pinNextAttention();
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

    // Gen 57: H/L → jump focus to the first/last quest (vim-style endpoints).
    if (k === 'H') {
      this.gridController.focusFirst();
      return;
    }
    if (k === 'L') {
      this.gridController.focusLast();
      return;
    }

    // Gen 25: Tab → jump to the next quest that needs attention.
    if (matchesKey(data, Key.tab)) {
      this.gridController.focusNextAttention();
      return;
    }

    // Gen 55: g → focus the least-healthy quest (health-based triage).
    if (k === 'g') {
      this.gridController.focusWeakestHealth();
      return;
    }

    // Gen 63: m → focus the most expensive quest (cost-based triage).
    if (k === 'm') {
      this.gridController.focusMostExpensive();
      return;
    }

    // Gen 94: C → jump to the next quest at risk of context exhaustion.
    if (k === 'C') {
      this.gridController.focusNextCtxRisk();
      return;
    }

    // Gen 90: E → jump to the previous quest with error/warning lines.
    if (k === 'E') {
      this.gridController.focusPrevProblem();
      return;
    }

    // Gen 89: e → jump to the next quest with error/warning lines.
    if (k === 'e') {
      this.gridController.focusNextProblem();
      return;
    }

    // Gen 66: c → toggle the fleet summary overlay.
    if (k === 'c') {
      this.fleetInfoVisible = true;
      return;
    }

    // Gen 68: D → toggle the fleet changes overlay.
    if (k === 'D') {
      this.fleetChangesVisible = true;
      return;
    }

    // Gen 87: 1–9 → focus the Nth quest in the current sort order.
    if (k.length === 1 && k >= '1' && k <= '9') {
      this.gridController.focusNth(Number(k));
      return;
    }

    // Gen 26: ! → toggle attention-only view.
    if (k === '!') {
      this.gridController.toggleAttentionOnly();
      return;
    }

    // Gen 26: ! → toggle attention-only view.
    if (k === '!') {
      this.gridController.setAttentionOnly(!this.gridController.isAttentionOnly());
      return;
    }

    // Gen 75: # → toggle context-risk-only view.
    if (k === '#') {
      this.gridController.toggleCtxRiskOnly();
      return;
    }

    // Gen 86: % → toggle problems-only view.
    if (k === '%') {
      this.gridController.toggleProblemsOnly();
      return;
    }

    // Gen 30: s → cycle the dashboard sort mode.
    if (k === 's') {
      this.gridController.cycleSortMode();
      return;
    }

    // Gen 54: 0 → reset all view state (filter, attention-only, sort mode).
    if (k === '0') {
      this.filterBuffer = '';
      this.gridController.resetView();
      return;
    }

    // Enter or p → toggle pin on focused quest
    if (matchesKey(data, Key.enter) || k === 'p') {
      const focusedId = this.gridController.getFocusedQuestId();
      if (focusedId) this.pinController.togglePin(focusedId);
      return;
    }

    // Gen 24: / → start dashboard filter
    if (k === '/') {
      this.filterMode = true;
      this.filterBuffer = '';
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
    // Gen 44: when the pin switches to a different quest, jump its expand
    // view to the live tail so the operator immediately sees current output.
    const pinnedId = pinned?.id ?? null;
    if (pinnedId !== null && pinnedId !== this.lastPinnedId) {
      this.expandViews.get(pinnedId)?.scrollToBottom();
    }
    this.lastPinnedId = pinnedId;
    // Gen 22: help overlay replaces the normal view while visible.
    if (this.helpVisible) {
      return this.renderHelp(pinned !== null, width);
    }
    // Gen 65: quest info overlay replaces the pinned view while visible.
    if (this.infoVisible && pinned) {
      return this.renderQuestInfo(pinned, width);
    }
    // Gen 66: fleet summary overlay replaces the dashboard while visible.
    if (this.fleetInfoVisible && !pinned) {
      return this.renderFleetInfo(quests, width);
    }
    // Gen 68: fleet changes overlay replaces the dashboard while visible.
    if (this.fleetChangesVisible && !pinned) {
      return this.renderFleetChanges(quests, width);
    }
    // Gen 70: stream stats overlay replaces the pinned view while visible.
    if (this.streamStatsVisible && pinned) {
      return this.renderStreamStats(pinned, width);
    }
    if (pinned) {
      return this.renderPinned(pinned, quests, width);
    }
    return this.renderDashboard(quests, width);
  }

  // -------------------------------------------------------------------------
  // Gen 22: context-aware help overlay
  // -------------------------------------------------------------------------

  private renderHelp(pinnedMode: boolean, width: number): string[] {
    const lines: string[] = [];
    const title = pinnedMode ? '── Pinned Quest Help ──' : '── Dashboard Help ──';
    lines.push(currentTheme.fg('accent', title));
    lines.push('');

    const rows: ReadonlyArray<readonly [string, string]> = pinnedMode
      ? [
          ['j / k  ↓ ↑', 'Scroll the live stream'],
          ['PgDn / PgUp', 'Scroll a page at a time'],
          ['Space', 'Page down (pager-style)'],
          ['b', 'Page up (pager-style)'],
          ['f', 'Toggle thumbnail strip (full-height view)'],
          ['d', 'Toggle diff-only view (code changes)'],
          ['w', 'Toggle auto-follow (pause/resume live tail)'],
          ['F', 'Toggle fullscreen stream (hide header)'],
          ['R', 'Clear the stream buffer'],
          ['y', 'Review from the top (pause auto-follow)'],
          ['i', 'Show quest info overlay'],
          ['T', 'Show stream stats overlay'],
          ['t', 'Toggle relative timestamps'],
          ['e / E', 'Jump to next / previous error line'],
          ['] / [', 'Jump to next / previous diff file'],
          [':N', 'Jump to line number N'],
          ['G / g', 'Jump to bottom / top'],
          ['/  n  N', 'Search · next / previous match'],
          ['h / l', 'Previous / next quest (switch context)'],
          ['w', 'Next quest needing attention (triage)'],
          ['Enter / p', 'Unpin back to the grid'],
          ['-', 'Jump back to the previously pinned quest'],
          ['1–9', 'Jump to the Nth thumbnail quest'],
          ['a / x / r', 'Approve / reject / rewind approval'],
          ['? / Esc', 'Close this help'],
          ['q', 'Close the dashboard'],
        ]
      : [
          ['j / k  ↓ ↑', 'Move focus between quests'],
          ['H / L', 'Focus first / last quest'],
          ['Tab', 'Jump to the next quest needing attention'],
          ['g', 'Focus the least-healthy quest'],
          ['m', 'Focus the most expensive quest'],
          ['e', 'Jump to next quest with problems'],
          ['E', 'Jump to previous quest with problems'],
          ['C', 'Jump to next context-risk quest'],
          ['c', 'Show fleet summary overlay'],
          ['D', 'Show fleet changes overlay'],
          ['1–9', 'Focus the Nth quest'],
          ['!', 'Toggle attention-only view'],
          ['#', 'Toggle context-risk-only view'],
          ['%', 'Toggle problems-only view'],
          ['Enter / p', 'Pin (expand) the focused quest'],
          ['/', 'Filter quests by name or state'],
          ['s', 'Cycle sort mode (attention/cost/age/name)'],
          ['0', 'Reset view (clear filter, sort, attention-only)'],
          ['a / x / r', 'Approve / reject / rewind focused quest'],
          ['?', 'Show this help'],
          ['Esc / q', 'Close the dashboard'],
        ];

    for (const [keys, desc] of rows) {
      const keyCell = currentTheme.fg('warning', keys.padEnd(14));
      lines.push(`  ${keyCell}${desc}`);
    }
    lines.push('');
    lines.push(currentTheme.dim('  Press any key to dismiss.'));
    return lines.map((line) => clip(line, width));
  }

  // -------------------------------------------------------------------------
  // Gen 65: pinned quest info overlay
  // -------------------------------------------------------------------------

  private renderQuestInfo(quest: Quest, width: number): string[] {
    const now = this.now();
    const lines: string[] = [];
    lines.push(currentTheme.fg('accent', `── ${quest.name} ──`));
    lines.push('');

    const stateToken = questStateColorToken(quest.state);
    const rows: ReadonlyArray<readonly [string, string]> = [
      ['State', currentTheme.fg(stateToken, `${questStateIcon(quest.state)} ${quest.state}`)],
      ['Model', quest.modelName ?? '—'],
      ['Cost', quest.sessionCostUsd !== undefined ? `$${quest.sessionCostUsd.toFixed(2)}` : '—'],
      ['Changes', formatChangeCount(quest.changeCount)],
      ['Health', renderHealthScore(questHealthScore(quest, now))],
      ['Worktree', quest.worktreePath],
      ['Elapsed', formatElapsed(now - quest.createdAt)],
      ['Idle', formatElapsed(now - quest.lastActivityAt)],
    ];
    for (const [label, value] of rows) {
      lines.push(`  ${currentTheme.dim(label.padEnd(10))}${value}`);
    }

    // Progress bars (only when there is something to show).
    if (quest.todoProgress !== undefined && quest.todoProgress.total > 0) {
      lines.push(`  ${currentTheme.dim('Todo'.padEnd(10))}${renderTodoBar(quest.todoProgress.done, quest.todoProgress.total)}`);
    }
    if (quest.contextUsage !== undefined && quest.contextUsage > 0) {
      // Gen 72: color the context bar by pressure threshold.
      const ctxToken = contextSeverityToken(quest.contextUsage);
      lines.push(`  ${currentTheme.dim('Context'.padEnd(10))}${currentTheme.fg(ctxToken, renderContextBar(quest.contextUsage))}`);
    }
    if (quest.planStep !== undefined && quest.planStep.length > 0) {
      lines.push(`  ${currentTheme.dim('Step'.padEnd(10))}${quest.planStep}`);
    }
    if (quest.pendingApprovalSummary !== undefined && quest.pendingApprovalSummary.length > 0) {
      lines.push(`  ${currentTheme.fg('warning', 'Approval'.padEnd(10))}${quest.pendingApprovalSummary}`);
    }
    if (quest.lastErrorMessage !== undefined && quest.lastErrorMessage.length > 0) {
      lines.push(`  ${currentTheme.fg('error', 'Error'.padEnd(10))}${quest.lastErrorMessage}`);
    }

    lines.push('');
    lines.push(currentTheme.dim('  Press any key to dismiss.'));
    return lines.map((line) => clip(line, width));
  }

  // -------------------------------------------------------------------------
  // Gen 66: dashboard fleet summary overlay
  // -------------------------------------------------------------------------

  private renderFleetInfo(quests: readonly Quest[], width: number): string[] {
    const now = this.now();
    const lines: string[] = [];
    lines.push(currentTheme.fg('accent', '── Fleet Summary ──'));
    lines.push('');

    // State distribution.
    const stateCounts = new Map<QuestState, number>();
    for (const q of quests) {
      stateCounts.set(q.state, (stateCounts.get(q.state) ?? 0) + 1);
    }
    const stateOrder: readonly QuestState[] = [
      'waiting-approval', 'failed', 'blocked', 'running', 'idle', 'done',
    ];
    const stateParts: string[] = [];
    for (const state of stateOrder) {
      const count = stateCounts.get(state);
      if (count === undefined || count === 0) continue;
      const token = questStateColorToken(state);
      stateParts.push(currentTheme.fg(token, `${questStateIcon(state)} ${state} ${String(count)}`));
    }
    lines.push(`  ${currentTheme.dim('States'.padEnd(10))}${stateParts.join('  ')}`);

    // Totals.
    const totalCost = quests.reduce((sum, q) => sum + (q.sessionCostUsd ?? 0), 0);
    const totalAdded = quests.reduce((sum, q) => sum + q.changeCount.added, 0);
    const totalRemoved = quests.reduce((sum, q) => sum + q.changeCount.removed, 0);
    const avgHealth = quests.length > 0
      ? Math.round(quests.reduce((sum, q) => sum + questHealthScore(q, now), 0) / quests.length)
      : 0;

    lines.push(`  ${currentTheme.dim('Quests'.padEnd(10))}${String(quests.length)}`);
    lines.push(`  ${currentTheme.dim('Cost'.padEnd(10))}$${totalCost.toFixed(2)}`);
    lines.push(`  ${currentTheme.dim('Changes'.padEnd(10))}${renderChangeCount({ added: totalAdded, removed: totalRemoved })}`);
    lines.push(`  ${currentTheme.dim('Avg health'.padEnd(10))}${renderHealthScore(avgHealth)}`);

    lines.push('');
    lines.push(currentTheme.dim('  Press any key to dismiss.'));
    return lines.map((line) => clip(line, width));
  }

  // -------------------------------------------------------------------------
  // Gen 68: dashboard fleet changes overlay
  // -------------------------------------------------------------------------

  private renderFleetChanges(quests: readonly Quest[], width: number): string[] {
    const lines: string[] = [];
    lines.push(currentTheme.fg('accent', '── Fleet Changes ──'));
    lines.push('');

    // Sort by total churn (added + removed), descending.
    const sorted = [...quests].sort((a, b) => {
      const churnA = a.changeCount.added + a.changeCount.removed;
      const churnB = b.changeCount.added + b.changeCount.removed;
      return churnB - churnA;
    });

    for (const q of sorted) {
      const churn = q.changeCount.added + q.changeCount.removed;
      if (churn === 0) continue;
      const name = q.name.length > 20 ? q.name.slice(0, 19) + '…' : q.name;
      lines.push(`  ${name.padEnd(22)}${renderChangeCount(q.changeCount)}`);
    }

    // Fleet total.
    const totalAdded = quests.reduce((sum, q) => sum + q.changeCount.added, 0);
    const totalRemoved = quests.reduce((sum, q) => sum + q.changeCount.removed, 0);
    lines.push('');
    lines.push(`  ${currentTheme.dim('Total'.padEnd(22))}${renderChangeCount({ added: totalAdded, removed: totalRemoved })}`);

    lines.push('');
    lines.push(currentTheme.dim('  Press any key to dismiss.'));
    return lines.map((line) => clip(line, width));
  }

  // -------------------------------------------------------------------------
  // Gen 70: pinned stream stats overlay
  // -------------------------------------------------------------------------

  private renderStreamStats(quest: Quest, width: number): string[] {
    const lines: string[] = [];
    lines.push(currentTheme.fg('accent', `── Stream Stats: ${quest.name} ──`));
    lines.push('');

    const view = this.expandViews.get(quest.id);
    if (view === undefined) {
      lines.push(currentTheme.dim('  No stream data for this quest.'));
    } else {
      const lineCount = view.getStreamLineCount();
      const diffRatio = view.getStreamDiffRatio();
      const following = view.isFollowingTail();
      const search = view.getSearchStatus();

      lines.push(`  ${currentTheme.dim('Lines'.padEnd(12))}${String(lineCount)}`);
      lines.push(`  ${currentTheme.dim('Diff ratio'.padEnd(12))}${String(Math.round(diffRatio * 100))}%`);
      lines.push(`  ${currentTheme.dim('Auto-follow'.padEnd(12))}${following ? currentTheme.fg('success', 'on') : currentTheme.fg('warning', 'paused')}`);
      if (search !== null) {
        lines.push(`  ${currentTheme.dim('Search'.padEnd(12))}${search.query} (${String(search.current + 1)}/${String(search.total)})`);
      }
    }

    lines.push('');
    lines.push(currentTheme.dim('  Press any key to dismiss.'));
    return lines.map((line) => clip(line, width));
  }

  // -------------------------------------------------------------------------
  // Dashboard mode — one cell block per quest
  // -------------------------------------------------------------------------

  private renderDashboard(quests: readonly Quest[], width: number): string[] {
    const lines: string[] = [];
    const now = this.now();

    // Gen 19: summary bar — total quests, attention count, total cost.
    const attentionCount = quests.filter((q) => ATTENTION_STATES.has(q.state)).length;
    const totalCost = quests.reduce((sum, q) => sum + (q.sessionCostUsd ?? 0), 0);
    // Gen 44: state breakdown for a fleet-status overview at a glance.
    const runningCount = quests.filter((q) => q.state === 'running').length;
    const doneCount = quests.filter((q) => q.state === 'done').length;
    // Gen 45: fleet-wide change totals.
    const totalAdded = quests.reduce((sum, q) => sum + q.changeCount.added, 0);
    const totalRemoved = quests.reduce((sum, q) => sum + q.changeCount.removed, 0);
    // Gen 78: fleet-wide diff line count across all expand views.
    const totalDiffLines = quests.reduce(
      (sum, q) => sum + (this.expandViews.get(q.id)?.getDiffLineCount() ?? 0),
      0,
    );
    // Gen 80: fleet-wide stream line count across all expand views.
    const totalStreamLines = quests.reduce(
      (sum, q) => sum + (this.expandViews.get(q.id)?.getStreamLineCount() ?? 0),
      0,
    );
    // Gen 84: fleet-wide error/warning line counts across all expand views.
    // Gen 89: also track the single most troubled quest for the summary bar.
    const totalProblems = quests.reduce(
      (acc, q) => {
        const counts = this.expandViews.get(q.id)?.getProblemCounts();
        if (counts !== undefined) {
          acc.errors += counts.errors;
          acc.warnings += counts.warnings;
          const total = counts.errors + counts.warnings;
          if (total > acc.worstCount) {
            acc.worstCount = total;
            acc.worst = q;
          }
        }
        return acc;
      },
      { errors: 0, warnings: 0, worstCount: 0, worst: undefined as Quest | undefined },
    );
    // Gen 51: fleet-wide average health score.
    const avgHealth = quests.length > 0
      ? Math.round(quests.reduce((sum, q) => sum + questHealthScore(q, now), 0) / quests.length)
      : 0;
    // Gen 73: count quests whose context window is under pressure (>=80%),
    // reusing the Gen 72 threshold so the summary flags exhaustion risk.
    const ctxRiskCount = quests.filter(
      (q) => q.contextUsage !== undefined && contextSeverityToken(q.contextUsage) !== 'success',
    ).length;
    const summaryParts = [`${String(quests.length)} quests`];
    if (runningCount > 0) {
      summaryParts.push(`● ${String(runningCount)} running`);
    }
    if (doneCount > 0) {
      summaryParts.push(`✓ ${String(doneCount)} done`);
    }
    if (attentionCount > 0) {
      summaryParts.push(`⚡ ${String(attentionCount)} need attention`);
    }
    if (totalAdded > 0 || totalRemoved > 0) {
      summaryParts.push(`+${String(totalAdded)} -${String(totalRemoved)}`);
    }
    // Gen 78: fleet-wide diff line count.
    if (totalDiffLines > 0) {
      summaryParts.push(`≡ ${String(totalDiffLines)} diff`);
    }
    // Gen 80: fleet-wide stream line count.
    if (totalStreamLines > 0) {
      summaryParts.push(`≣ ${String(totalStreamLines)} lines`);
    }
    // Gen 84: fleet-wide error/warning line counts.
    if (totalProblems.errors > 0 || totalProblems.warnings > 0) {
      const parts: string[] = [];
      if (totalProblems.errors > 0) parts.push(`✖${String(totalProblems.errors)}`);
      if (totalProblems.warnings > 0) parts.push(`⚠${String(totalProblems.warnings)}`);
      summaryParts.push(parts.join(' '));
    }
    // Gen 89: surface the single most troubled quest so the operator knows
    // where to focus triage (only meaningful once there are several quests).
    if (quests.length > 1 && totalProblems.worst !== undefined && totalProblems.worstCount > 0) {
      summaryParts.push(
        `☢ worst: ${totalProblems.worst.name} ${String(totalProblems.worstCount)}`,
      );
    }
    if (avgHealth > 0) {
      summaryParts.push(`♥ ${String(avgHealth)}`);
    }
    // Gen 73: flag how many quests are near context exhaustion.
    if (ctxRiskCount > 0) {
      summaryParts.push(`⚠ ${String(ctxRiskCount)} ctx risk`);
    }
    // Gen 70: surface the longest-idle quest so the most neglected session is
    // obvious at a glance (only meaningful once there are several quests).
    if (quests.length > 1) {
      let stalest: Quest | undefined;
      for (const q of quests) {
        if (stalest === undefined || q.lastActivityAt < stalest.lastActivityAt) {
          stalest = q;
        }
      }
      if (stalest !== undefined) {
        const idleFor = Math.max(0, now - stalest.lastActivityAt);
        summaryParts.push(`⌛ stalest: ${stalest.name} ${formatElapsed(idleFor)}`);
      }
    }
    if (totalCost > 0) {
      summaryParts.push(`$${totalCost.toFixed(2)}`);
    }
    // Gen 26: indicate when attention-only mode is active.
    if (this.gridController.isAttentionOnly()) {
      summaryParts.push('⚠ attention-only');
    }
    // Gen 75: indicate when context-risk-only mode is active.
    if (this.gridController.isCtxRiskOnly()) {
      summaryParts.push('# ctx-risk-only');
    }
    // Gen 86: indicate when problems-only mode is active.
    if (this.gridController.isProblemsOnly()) {
      summaryParts.push('% problems-only');
    }
    // Gen 30: show the active sort mode when not the default.
    const sortMode = this.gridController.getSortMode();
    if (sortMode !== 'attention') {
      summaryParts.push(`↕ sort: ${sortModeLabel(sortMode)}`);
    }
    const summary = `  ${summaryParts.join('  ·  ')}`;
    lines.push(currentTheme.fg(attentionCount > 0 ? 'warning' : 'textMuted', clip(summary, width)));

    // Gen 24: filter prompt (while typing) or active filter chip.
    if (this.filterMode) {
      lines.push(currentTheme.fg('accent', clip(`  filter: ${this.filterBuffer}█`, width)));
    } else if (this.filterBuffer !== '') {
      const total = this.gridController.questCount;
      lines.push(
        currentTheme.fg(
          'textMuted',
          clip(`  filter: "${this.filterBuffer}" · ${String(quests.length)}/${String(total)} shown · / edit · Esc clear`, width),
        ),
      );
    }
    // Gen 26: attention-only chip.
    if (this.gridController.isAttentionOnly()) {
      lines.push(currentTheme.fg('warning', clip('  ⚡ attention-only view · ! to show all', width)));
    }
    // Gen 75: context-risk-only chip.
    if (this.gridController.isCtxRiskOnly()) {
      lines.push(currentTheme.fg('warning', clip('  # context-risk-only view · # to show all', width)));
    }
    // Gen 86: problems-only chip.
    if (this.gridController.isProblemsOnly()) {
      lines.push(currentTheme.fg('error', clip('  % problems-only view · % to show all', width)));
    }
    lines.push('');

    if (quests.length === 0) {
      lines.push(currentTheme.dim('  No quests match the current filter.'));
      return lines;
    }

    // Gen 90: identify the single most troubled quest so its cell can carry a
    // marker, matching the summary bar's '☢ worst' callout (Gen 89).
    let worstQuestId: string | undefined;
    let worstCount = 0;
    if (quests.length > 1) {
      for (const q of quests) {
        const counts = this.expandViews.get(q.id)?.getProblemCounts();
        if (counts !== undefined) {
          const total = counts.errors + counts.warnings;
          if (total > worstCount) {
            worstCount = total;
            worstQuestId = q.id;
          }
        }
      }
    }

    for (const quest of quests) {
      const block = this.renderCellBlock(quest, width, now, worstQuestId);
      lines.push(...block);
    }

    // Gen 34: bottom action-hint bar — context-aware shortcuts for the
    // focused quest so operators can act without opening the help overlay.
    const focused = this.focusedQuest(quests);
    lines.push('');
    lines.push(currentTheme.dim(clip(actionHintBar(focused), width)));
    return lines;
  }

  /** Gen 34: resolve the currently focused quest, if any. */
  private focusedQuest(quests: readonly Quest[]): Quest | undefined {
    const id = this.gridController.getFocusedQuestId();
    if (id === null) return undefined;
    return quests.find((q) => q.id === id);
  }

  private renderCellBlock(quest: Quest, width: number, now: number, worstQuestId?: string): string[] {
    const pulsing = this.attentionController.isPulsing(quest.id);
    const focused = this.gridController.getFocusedQuestId() === quest.id;
    const marker = pulsing ? (this.blinkPhase ? '⚡' : '·') : ' ';
    const focusIndicator = focused ? '▶ ' : '  ';
    const safeWidth = Math.max(1, width - 4);
    // Gen 90: mark the most troubled quest so it stands out in the grid.
    const isWorst = quest.id === worstQuestId;

    const created = formatElapsed(Math.max(0, now - quest.createdAt));
    const idle = formatElapsed(Math.max(0, now - quest.lastActivityAt));

    // Gen 9: progress indicators (todo + context usage)
    const progressParts: string[] = [];
    if (quest.todoProgress !== undefined && quest.todoProgress.total > 0) {
      // Gen 31: visual mini-bar instead of plain count text.
      const { done, total } = quest.todoProgress;
      progressParts.push(renderTodoBar(done, total));
    }
    if (quest.contextUsage !== undefined && quest.contextUsage > 0) {
      // Gen 29: visual mini-bar instead of plain percentage text.
      // Gen 72: color by pressure so context exhaustion risk is obvious.
      const ctxBar = renderContextBar(quest.contextUsage);
      const ctxToken = contextSeverityToken(quest.contextUsage);
      progressParts.push(currentTheme.fg(ctxToken, ctxBar));
    }
    // Gen 18: model name + session cost.
    if (quest.modelName !== undefined && quest.modelName.length > 0) {
      progressParts.push(quest.modelName);
    }
    if (quest.sessionCostUsd !== undefined && quest.sessionCostUsd > 0) {
      progressParts.push(`$${quest.sessionCostUsd.toFixed(2)}`);
    }
    const progress = progressParts.length > 0 ? `  ${progressParts.join('  ')}` : '';

    // Gen 12: color-code the state icon + badge for at-a-glance scanning.
    // Gen 33: running quests get a live spinner instead of a static icon.
    const stateToken = questStateColorToken(quest.state);
    const icon = quest.state === 'running' ? spinnerFrame(now) : questStateIcon(quest.state);
    const badgeText = `${icon} [${quest.state}]`;
    const badge = currentTheme.fg(stateToken, badgeText);
    const prefix = `${focusIndicator}${marker}`;
    // Use the plain-text badge length (not ANSI-inflated) for the name budget.
    // Gen 90: reserve room for the worst-quest marker so the line stays in width.
    const worstReserve = isWorst ? 2 : 0;
    const nameBudget = Math.max(1, width - prefix.length - badgeText.length - 2 - worstReserve);
    const name = quest.name.length > nameBudget ? quest.name.slice(0, nameBudget) : quest.name;
    // Gen 90: worst-quest marker so the most troubled cell stands out, matching
    // the summary bar's '☢ worst' callout (Gen 89).
    const worstMarker = isWorst ? currentTheme.fg('error', ' ☢') : '';
    const line1 = `${prefix}${badge} ${name}${worstMarker}`;
    // Gen 32: colorize the change stats (+added green, -removed red) so the
    // churn magnitude is scannable. Built as separate segments because the
    // surrounding metadata stays dim.
    const changeSegment = renderChangeCount(quest.changeCount);
    const line2Prefix = `${focusIndicator}  ⏱ ${created}  idle ${idle}  `;
    const line2Suffix = `${progress}   ${shorten(quest.worktreePath, safeWidth)}`;
    // Gen 31: color the metadata line by idle duration so stalled sessions
    // stand out — warning past 5 min, error past 15 min.
    const line2Token = idleSeverityToken(now - quest.lastActivityAt);
    // Gen 13: when awaiting approval, surface what needs a decision.
    // Gen 21: when failed, surface why it failed.
    let stepText: string;
    let line3Token: 'warning' | 'error' | 'muted';
    if (quest.state === 'waiting-approval' && quest.pendingApprovalSummary !== undefined) {
      stepText = quest.pendingApprovalSummary;
      line3Token = 'warning';
    } else if (quest.state === 'failed' && quest.lastErrorMessage !== undefined) {
      stepText = `✗ ${quest.lastErrorMessage}`;
      line3Token = 'error';
    } else {
      stepText = quest.planStep;
      line3Token = 'muted';
    }
    const line3 = `${focusIndicator}  ▸ ${stepText}`;

    // Gen 66: preview the most recent stream line so the cell shows what the
    // quest is doing right now without pinning it. Falls back to nothing when
    // the stream is empty.
    // Gen 69: colorize error/warning preview lines so problems are spotted
    // straight from the grid, matching the expand-view emphasis (Gen 20).
    // Gen 71: prefix the gutter line number so the operator can jump straight
    // to it with `:N` after pinning.
    const expandView = this.expandViews.get(quest.id);
    const lastLine = expandView?.getLastStreamLine();
    let preview: string | undefined;
    if (lastLine !== undefined && lastLine.length > 0) {
      const lineNo = expandView?.getLastStreamLineNumber() ?? 0;
      const lineNoTag = lineNo > 0 ? currentTheme.dim(`${String(lineNo)} `) : '';
      const clipped = clip(lastLine, Math.max(1, width - focusIndicator.length - 3 - String(lineNo).length - 1));
      const highlighted = highlightStreamLine(clipped);
      const previewBody = highlighted === clipped ? currentTheme.dim(clipped) : highlighted;
      preview = `${focusIndicator}  ${currentTheme.dim('│')} ${lineNoTag}${previewBody}`;
    }

    // Gen 32: line2 is composed of dim metadata segments plus the colorized
    // change-count segment. Width is managed on plain text before coloring so
    // the ANSI escapes are never clipped mid-sequence.
    const dimToken = (text: string): string =>
      line2Token === 'warning'
        ? currentTheme.fg('warning', text)
        : line2Token === 'error'
          ? currentTheme.fg('error', text)
          : currentTheme.dim(text);
    // Gen 48/52: health mini-bar segment (colorized by severity).
    const health = questHealthScore(quest, now);
    const healthPlain = `  ${formatHealthBar(health)}`;
    const healthSegment = `  ${renderHealthBar(health)}`;
    // Gen 76: diff line count segment so the cell shows how much code the
    // quest has produced (pairs with the d-key diff view, Gen 50).
    const diffCount = expandView?.getDiffLineCount() ?? 0;
    const diffPlain = diffCount > 0 ? `  ≡${String(diffCount)}` : '';
    const diffSegment = diffCount > 0 ? currentTheme.fg('textMuted', `  ≡${String(diffCount)}`) : '';
    // Gen 79: stream line count segment so the cell shows how much output the
    // quest has generated.
    const streamCount = expandView?.getStreamLineCount() ?? 0;
    const streamPlain = streamCount > 0 ? `  ≣${String(streamCount)}` : '';
    const streamSegment = streamCount > 0 ? currentTheme.fg('textMuted', `  ≣${String(streamCount)}`) : '';
    // Gen 82: stream/diff ratio mini-bar so the cell shows the output/code
    // balance at a glance, mirroring the expand-view header (Gen 81).
    const ratioPlain = formatRatioBar(streamCount, diffCount);
    const ratioSegment = ratioPlain.length > 0 ? `  ${currentTheme.dim(ratioPlain)}` : '';
    const ratioPlainSeg = ratioPlain.length > 0 ? `  ${ratioPlain}` : '';
    // Gen 83: error/warning count badge so the cell shows the problem scale
    // at a glance, mirroring the expand-view header badge (Gen 65).
    const problems = expandView?.getProblemCounts();
    const problemPlain =
      problems !== undefined && (problems.errors > 0 || problems.warnings > 0)
        ? `  ${problems.errors > 0 ? `✖${String(problems.errors)}` : ''}${problems.errors > 0 && problems.warnings > 0 ? ' ' : ''}${problems.warnings > 0 ? `⚠${String(problems.warnings)}` : ''}`
        : '';
    const problemSegment =
      problems !== undefined && (problems.errors > 0 || problems.warnings > 0)
        ? `  ${problems.errors > 0 ? currentTheme.fg('error', `✖${String(problems.errors)}`) : ''}${problems.errors > 0 && problems.warnings > 0 ? ' ' : ''}${problems.warnings > 0 ? currentTheme.fg('warning', `⚠${String(problems.warnings)}`) : ''}`
        : '';
    const plainLine2 = `${line2Prefix}${formatChangeCount(quest.changeCount)}${healthPlain}${diffPlain}${streamPlain}${ratioPlainSeg}${problemPlain}${line2Suffix}`;
    const line2 =
      plainLine2.length > width
        ? dimToken(clip(plainLine2, width))
        : `${dimToken(line2Prefix)}${changeSegment}${healthSegment}${diffSegment}${streamSegment}${ratioSegment}${problemSegment}${dimToken(line2Suffix)}`;

    return [
      // line1 is width-managed manually (badge carries ANSI color), so skip clip.
      line1,
      line2,
      line3Token === 'warning'
        ? currentTheme.fg('warning', clip(line3, width))
        : line3Token === 'error'
          ? currentTheme.fg('error', clip(line3, width))
          : currentTheme.dim(clip(line3, width)),
      // Gen 66: recent stream preview (only when the stream has content).
      ...(preview !== undefined ? [preview] : []),
    ];
  }

  // -------------------------------------------------------------------------
  // Pinned mode — expand view + thumbnail strip
  // -------------------------------------------------------------------------

  private renderPinned(pinned: Quest, allQuests: readonly Quest[], width: number): string[] {
    const expandView = this.expandViews.get(pinned.id);
    const lines: string[] = [];

    // Gen 67: line-number jump prompt while typing `:N`.
    if (this.lineJumpMode) {
      lines.push(currentTheme.fg('accent', clip(`  :${this.lineJumpBuffer}█  (Enter to jump, Esc to cancel)`, width)));
    }

    if (expandView) {
      // Gen 45: when the strip is hidden, give the expand view the extra rows.
      const visibleRows = this.stripHidden ? 24 : Math.max(1, 24 - 2); // reserve strip + spacing
      expandView.setMaxVisibleLines(visibleRows);
      const stream = expandView.render(pinned, width);
      for (const row of stream) {
        lines.push(clip(row, width));
      }
    } else {
      lines.push(clip(`── ${pinned.name} [${pinned.state}] (no stream) ──`, width));
    }

    // Thumbnail strip for the non-pinned quests (numbered for direct jump, Gen 6b)
    // Gen 45: hidden when the operator toggles full-height mode with `f`.
    if (!this.stripHidden) {
      const entries = buildThumbnailStrip(allQuests, pinned.id, this.blinkPhase);
      if (entries.length > 0) {
        const strip = renderThumbnailStripLine(entries, width, true);
        lines.push(currentTheme.dim(clip(strip, width)));
      }
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

/**
 * Gen 29 / Gen 31 / Gen 36: mini-bar renderers live in quest-types so the
 * dashboard cells and the expand-view header share one implementation.
 * Re-exported here to keep the existing import path stable.
 */
export { renderContextBar, renderTodoBar } from '../../controllers/quest-types';

/**
 * Gen 32: render the change-count stats with semantic colors — additions in
 * green, removals in red — so churn magnitude is scannable at a glance.
 */
export function renderChangeCount(cc: QuestChangeCount): string {
  const added = currentTheme.fg('success', `+${String(cc.added)}`);
  const removed = currentTheme.fg('error', `-${String(cc.removed)}`);
  return `${added} ${removed}`;
}

/**
 * Gen 48: render a colorized health score, e.g. `♥ 82`. Green when healthy,
 * warning as it degrades, error when critical — so fleet health is scannable.
 */
export function renderHealthScore(score: number): string {
  const token = score >= 60 ? 'success' : score >= 30 ? 'warning' : 'error';
  return currentTheme.fg(token, `♥ ${String(score)}`);
}

/**
 * Gen 52: render a colorized health mini-bar, e.g. `♥ ▓▓▓░░ 82`.
 * Mirrors the todo/context mini-bars so fleet health is scannable at a glance.
 */
export function renderHealthBar(score: number): string {
  const cells = 5;
  const clamped = Math.max(0, Math.min(100, score));
  const filled = Math.round((clamped / 100) * cells);
  const bar = '▓'.repeat(filled) + '░'.repeat(cells - filled);
  const token = score >= 60 ? 'success' : score >= 30 ? 'warning' : 'error';
  return currentTheme.fg(token, `♥ ${bar} ${String(score)}`);
}

/** Gen 52: plain-text health mini-bar for width calculations. */
export function formatHealthBar(score: number): string {
  const cells = 5;
  const clamped = Math.max(0, Math.min(100, score));
  const filled = Math.round((clamped / 100) * cells);
  const bar = '▓'.repeat(filled) + '░'.repeat(cells - filled);
  return `♥ ${bar} ${String(score)}`;
}

/**
 * Gen 82: render a stream/diff ratio mini-bar, e.g. `▓▓▓░░ ≣/≡`. Filled cells
 * represent stream lines, empty cells represent diff lines. Mirrors the
 * expand-view header ratio bar (Gen 81) so the balance is scannable in cells.
 */
export function renderRatioBar(streamLines: number, diffLines: number): string {
  const total = streamLines + diffLines;
  if (total === 0) return '';
  const cells = 5;
  const filled = Math.round((streamLines / total) * cells);
  const bar = '▓'.repeat(filled) + '░'.repeat(cells - filled);
  return `${bar} ≣/≡`;
}

/** Gen 82: plain-text ratio mini-bar for width calculations. */
export function formatRatioBar(streamLines: number, diffLines: number): string {
  return renderRatioBar(streamLines, diffLines);
}

/** Gen 33: braille spinner frames for the running state. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Gen 34: build the bottom action-hint bar. When a quest is focused and
 * needs attention, surface the approval shortcuts prominently; otherwise
 * show the general navigation hints.
 */
export function actionHintBar(focused: Quest | undefined): string {
  const nav = 'j/k move · Enter pin · / filter · s sort · ! attn · ? help · q quit';
  if (focused !== undefined && ATTENTION_STATES.has(focused.state)) {
    return `⚡ ${focused.name}: a approve · x reject · r rewind · ${nav}`;
  }
  return nav;
}

/**
 * Gen 33: pick the spinner frame for a given timestamp. Time-based (not a
 * separate timer) so it animates whenever the dashboard re-renders on its
 * refresh tick without extra state.
 */
export function spinnerFrame(nowMs: number): string {
  const frame = Math.floor(nowMs / 100) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[frame]!;
}

/**
 * Gen 31: map an idle duration (ms) to a severity token so stalled sessions
 * stand out — muted when fresh, warning past 5 min, error past 15 min.
 */
export function idleSeverityToken(idleMs: number): 'muted' | 'warning' | 'error' {
  const safe = Math.max(0, idleMs);
  if (safe >= IDLE_ERROR_MS) return 'error';
  if (safe >= IDLE_WARN_MS) return 'warning';
  return 'muted';
}

/** Height of a single dashboard cell block (for layout accounting). */
export const BENTO_CELL_BLOCK_HEIGHT = CELL_BLOCK_HEIGHT;

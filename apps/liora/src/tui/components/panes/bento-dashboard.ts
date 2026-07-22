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
  ATTENTION_STATES,
  formatChangeCount,
  formatElapsed,
  questStateIcon,
  questStateColorToken,
  renderContextBar,
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

  // Gen 22: context-aware help overlay
  private helpVisible = false;

  // Gen 24: dashboard quest filter
  private filterMode = false;
  private filterBuffer = '';

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

    // Esc or Ctrl+G → close dashboard
    if (matchesKey(data, Key.escape) || data === '\x07') {
      // Gen 22: if help is open, close it first instead of the whole dashboard.
      if (this.helpVisible) {
        this.helpVisible = false;
        return;
      }
      // Gen 24: if a filter is active, clear it first instead of closing.
      if (this.filterBuffer !== '') {
        this.filterBuffer = '';
        this.gridController.setFilter('');
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
      // Gen 16: / starts inline search; n/N jump between matches.
      if (k === '/') {
        this.searchMode = true;
        this.searchBuffer = '';
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

    // Gen 25: Tab → jump to the next quest that needs attention.
    if (matchesKey(data, Key.tab)) {
      this.gridController.focusNextAttention();
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

    // Gen 30: s → cycle the dashboard sort mode.
    if (k === 's') {
      this.gridController.cycleSortMode();
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
    // Gen 22: help overlay replaces the normal view while visible.
    if (this.helpVisible) {
      return this.renderHelp(pinned !== null, width);
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
          ['G / g', 'Jump to bottom / top'],
          ['/  n  N', 'Search · next / previous match'],
          ['Enter / p', 'Unpin back to the grid'],
          ['1–9', 'Jump to the Nth thumbnail quest'],
          ['a / x / r', 'Approve / reject / rewind approval'],
          ['? / Esc', 'Close this help'],
          ['q', 'Close the dashboard'],
        ]
      : [
          ['j / k  ↓ ↑', 'Move focus between quests'],
          ['Tab', 'Jump to the next quest needing attention'],
          ['!', 'Toggle attention-only view'],
          ['Enter / p', 'Pin (expand) the focused quest'],
          ['/', 'Filter quests by name or state'],
          ['s', 'Cycle sort mode (attention/cost/age/name)'],
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
  // Dashboard mode — one cell block per quest
  // -------------------------------------------------------------------------

  private renderDashboard(quests: readonly Quest[], width: number): string[] {
    const lines: string[] = [];

    // Gen 19: summary bar — total quests, attention count, total cost.
    const attentionCount = quests.filter((q) => ATTENTION_STATES.has(q.state)).length;
    const totalCost = quests.reduce((sum, q) => sum + (q.sessionCostUsd ?? 0), 0);
    const summaryParts = [`${String(quests.length)} quests`];
    if (attentionCount > 0) {
      summaryParts.push(`⚡ ${String(attentionCount)} need attention`);
    }
    if (totalCost > 0) {
      summaryParts.push(`$${totalCost.toFixed(2)}`);
    }
    // Gen 26: indicate when attention-only mode is active.
    if (this.gridController.isAttentionOnly()) {
      summaryParts.push('⚠ attention-only');
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
    lines.push('');

    if (quests.length === 0) {
      lines.push(currentTheme.dim('  No quests match the current filter.'));
      return lines;
    }

    const now = this.now();
    for (const quest of quests) {
      const block = this.renderCellBlock(quest, width, now);
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

  private renderCellBlock(quest: Quest, width: number, now: number): string[] {
    const pulsing = this.attentionController.isPulsing(quest.id);
    const focused = this.gridController.getFocusedQuestId() === quest.id;
    const marker = pulsing ? (this.blinkPhase ? '⚡' : '·') : ' ';
    const focusIndicator = focused ? '▶ ' : '  ';
    const safeWidth = Math.max(1, width - 4);

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
      progressParts.push(renderContextBar(quest.contextUsage));
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
    const nameBudget = Math.max(1, width - prefix.length - badgeText.length - 2);
    const name = quest.name.length > nameBudget ? quest.name.slice(0, nameBudget) : quest.name;
    const line1 = `${prefix}${badge} ${name}`;
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

    // Gen 32: line2 is composed of dim metadata segments plus the colorized
    // change-count segment. Width is managed on plain text before coloring so
    // the ANSI escapes are never clipped mid-sequence.
    const dimToken = (text: string): string =>
      line2Token === 'warning'
        ? currentTheme.fg('warning', text)
        : line2Token === 'error'
          ? currentTheme.fg('error', text)
          : currentTheme.dim(text);
    const plainLine2 = `${line2Prefix}${formatChangeCount(quest.changeCount)}${line2Suffix}`;
    const line2 =
      plainLine2.length > width
        ? dimToken(clip(plainLine2, width))
        : `${dimToken(line2Prefix)}${changeSegment}${dimToken(line2Suffix)}`;

    return [
      // line1 is width-managed manually (badge carries ANSI color), so skip clip.
      line1,
      line2,
      line3Token === 'warning'
        ? currentTheme.fg('warning', clip(line3, width))
        : line3Token === 'error'
          ? currentTheme.fg('error', clip(line3, width))
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

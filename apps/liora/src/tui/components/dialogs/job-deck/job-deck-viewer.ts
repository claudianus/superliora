/**
 * JobDeckViewer — interactive Conductor monitoring deck mounted as an
 * editor replacement. Two stacked surfaces:
 *
 *  - **Deck list**: every ledger job as a searchable row with live status,
 *    kind, priority, wall-clock age, phase, and step progress; actions
 *    steer / answer / resume / cancel route through the conductor Job*
 *    tools (same prompt-injection pattern as `/job …`).
 *  - **Worker transcript**: Enter on a running worker drills into its live
 *    session trace (polled while open) with token usage, elapsed time, and
 *    an inline steer composer.
 *
 * The component is presentation-only: data arrives via the `getSnapshot` /
 * `loadWorker` closures wired by the opener.
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererDividerRow,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';

import { PULSE_ACTIVE_FRAMES, SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderParticleRail,
  renderPremiumHeadline,
  renderPulseGlyph,
  renderShimmerPrefix,
  renderToneSettleFlash,
} from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import { SearchableList } from '#/tui/utils/ui/searchable-list';
import {
  JOB_STATUS_META,
  shortJobId,
} from '#/tui/components/job-board/job-board-helpers';
import type { ConductorJobCard, ConductorJobsSnapshot } from '#/tui/utils/job/job-strip';
import {
  formatJobDuration,
  jobElapsedMs,
  longestActiveJobElapsedMs,
  resolveConductorJobCard,
} from '#/tui/utils/job/job-strip';

/** Worker transcript + usage payload for the drill-down surface. */
export interface JobDeckWorkerLoad {
  readonly lines: readonly string[];
  readonly usage?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
  };
  readonly error?: string;
}

export interface JobDeckViewerOptions {
  readonly getSnapshot: () => ConductorJobsSnapshot;
  readonly initialJobId?: string;
  readonly loadWorker: (card: ConductorJobCard) => Promise<JobDeckWorkerLoad>;
  /** Route an operator action through the conductor Job* tools. */
  readonly onAction: (
    action: 'steer' | 'answer' | 'resume' | 'cancel',
    card: ConductorJobCard,
    text?: string,
  ) => void;
  readonly onCancel: () => void;
  /** Repaint hook for async loads (falls back to Container.invalidate). */
  readonly requestRender?: () => void;
}

const DECK_LIST_ROWS = 12;
const DECK_TRANSCRIPT_ROWS = 16;
/** Transcript re-poll cadence while the drill-down stays open. */
const DECK_TRANSCRIPT_REFRESH_MS = 2000;
/** Rows recently moved lanes get a settle flash. */
const DECK_SETTLE_MS = 4000;

/** Actionable attention first, terminal states last — mirrors the board. */
const DECK_STATUS_RANK: Record<ConductorJobCard['status'], number> = {
  needs_user: 0,
  blocked: 1,
  running: 2,
  queued: 3,
  interrupted: 4,
  failed: 5,
  done: 6,
  cancelled: 7,
};

interface TranscriptState {
  card: ConductorJobCard;
  lines: readonly string[];
  usage: JobDeckWorkerLoad['usage'];
  loading: boolean;
  error: string | undefined;
  scrollOffset: number;
  followTail: boolean;
  lastFetchMs: number;
  fetching: boolean;
  fetchGeneration: number;
}

export class JobDeckViewerComponent extends Container implements Focusable {
  focused = false;

  private readonly getSnapshot: () => ConductorJobsSnapshot;
  private readonly loadWorker: (card: ConductorJobCard) => Promise<JobDeckWorkerLoad>;
  private readonly onAction: JobDeckViewerOptions['onAction'];
  private readonly onCancel: () => void;
  private readonly requestRenderHook?: () => void;

  private snapshot: ConductorJobsSnapshot;
  private list: SearchableList<ConductorJobCard>;
  private transcript: TranscriptState | undefined;
  private composing: { readonly kind: 'steer' | 'answer'; readonly card: ConductorJobCard } | undefined;
  private draft = '';
  private confirmCancelId: string | undefined;
  private statusText: string | undefined;

  constructor(opts: JobDeckViewerOptions) {
    super();
    this.getSnapshot = opts.getSnapshot;
    this.loadWorker = opts.loadWorker;
    this.onAction = opts.onAction;
    this.onCancel = opts.onCancel;
    this.requestRenderHook = opts.requestRender;
    this.snapshot = opts.getSnapshot();
    const focus =
      opts.initialJobId === undefined
        ? undefined
        : resolveConductorJobCard(this.snapshot.jobs, opts.initialJobId);
    this.list = this.buildList(this.snapshot, focus?.id ?? opts.initialJobId);
    if (focus?.workerAgentId !== undefined) this.openTranscript(focus);
  }

  handleInput(data: string): void {
    if (this.composing !== undefined) {
      this.handleComposeInput(data);
      return;
    }
    if (this.transcript !== undefined) {
      this.handleTranscriptInput(data);
      return;
    }
    this.handleListInput(data);
  }

  override render(width: number): string[] {
    this.syncSnapshot();
    if (this.transcript !== undefined) {
      this.maybeRefreshTranscript();
      return this.renderTranscript(this.transcript, width);
    }
    return this.renderList(width);
  }

  // ── list mode ─────────────────────────────────────────────────────────

  private handleListInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      if (this.confirmCancelId !== undefined) {
        this.confirmCancelId = undefined;
        this.repaint();
        return;
      }
      if (this.list.clearQuery()) {
        this.repaint();
        return;
      }
      this.onCancel();
      return;
    }
    if (this.confirmCancelId !== undefined) {
      const ch = printableChar(data);
      if (ch === 'y' || ch === 'Y') {
        const card = this.snapshot.jobs.find((entry) => entry.id === this.confirmCancelId);
        this.confirmCancelId = undefined;
        if (card !== undefined) {
          this.onAction('cancel', card);
          this.setStatus(`Cancel requested for ${shortJobId(card.id)}.`);
        }
      } else {
        this.confirmCancelId = undefined;
        this.repaint();
      }
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const card = this.list.selected();
      if (card === undefined) return;
      if (card.workerAgentId === undefined) {
        this.setStatus(
          card.status === 'queued'
            ? `${shortJobId(card.id)} is queued — no worker session yet.`
            : `${shortJobId(card.id)} has no worker transcript.`,
        );
        return;
      }
      this.openTranscript(card);
      return;
    }
    const ch = printableChar(data);
    if (ch === 's' || ch === 'S') {
      const card = this.list.selected();
      if (card !== undefined && card.status === 'running') {
        this.composing = { kind: 'steer', card };
        this.draft = '';
        this.repaint();
      } else {
        this.setStatus('Steer needs a running worker — pick a ▸ row.');
      }
      return;
    }
    if (ch === 'a' || ch === 'A') {
      const card = this.list.selected();
      if (card !== undefined && card.status === 'needs_user') {
        this.composing = { kind: 'answer', card };
        this.draft = '';
        this.repaint();
      } else {
        this.setStatus('Answer needs a ? (needs you) row.');
      }
      return;
    }
    if (ch === 'r' || ch === 'R') {
      const card = this.list.selected();
      if (card !== undefined && card.status === 'interrupted') {
        this.onAction('resume', card);
        this.setStatus(`Resume requested for ${shortJobId(card.id)}.`);
      } else {
        this.setStatus('Resume needs a ⏸ interrupted row.');
      }
      return;
    }
    if (ch === 'x' || ch === 'X') {
      const card = this.list.selected();
      if (card === undefined) return;
      this.confirmCancelId = card.id;
      this.repaint();
      return;
    }
    if (this.list.handleKey(data)) {
      this.repaint();
    }
  }

  private renderList(width: number): string[] {
    const theme = currentTheme;
    const view = this.list.view();
    const border = renderRendererDividerRow({
      width,
      style: (text) => theme.fg('primary', text),
    });
    const suffix =
      view.query.length === 0 ? theme.fg('textMuted', '  (type to search)') : '';
    const title = renderPremiumHeadline('Conductor Job Deck — Mission Monitor', 'job-deck:title');
    const lines: string[] = [
      border,
      ` ${title}${suffix}`,
      theme.fg(
        'textMuted',
        ' ↑↓ navigate · Enter transcript · S steer · A answer · R resume · X cancel · Esc cancel',
      ),
      this.renderMissionStrip(width),
      ` ${renderParticleRail(Math.max(8, width - 4), getActiveAppearancePreferences(), 'job-deck:rail')}`,
      '',
    ];
    if (view.query.length > 0) {
      lines.push(theme.fg('text', ` Search: ${view.query}`));
    }
    if (view.items.length === 0) {
      lines.push(theme.fg('textMuted', ' No Conductor jobs on the ledger yet.'));
    }
    const now = Date.now();
    const pageItems = view.items.slice(view.page.start, view.page.end);
    for (const [index, card] of pageItems.entries()) {
      const selected = view.page.start + index === view.selectedIndex;
      lines.push(this.renderJobRow(card, selected, width, now));
    }
    if (view.page.pageCount > 1 && view.page.end < view.items.length) {
      lines.push(
        theme.fg(
          'textDim',
          `  ▼ ${String(view.items.length - view.page.end)} more · page ${String(view.page.page + 1)}/${String(view.page.pageCount)}`,
        ),
      );
    }
    if (this.confirmCancelId !== undefined) {
      lines.push(theme.boldFg('warning', ` Cancel ${shortJobId(this.confirmCancelId)} and abort its worker? [y/N]`));
    } else if (this.composing !== undefined) {
      const label = this.composing.kind === 'steer' ? 'Steer' : 'Answer';
      const draft = this.draft.length === 0 ? theme.fg('textMuted', '…') : theme.fg('text', this.draft);
      lines.push(`${theme.boldFg('primary', ` ${label} ${shortJobId(this.composing.card.id)}: `)}${draft}`);
    } else if (this.statusText !== undefined) {
      lines.push(theme.fg('textDim', ` ${this.statusText}`));
    }
    lines.push('');
    lines.push(border);
    return lines;
  }

  private renderMissionStrip(width: number): string {
    const theme = currentTheme;
    const s = this.snapshot;
    const now = Date.now();
    const attention = s.needsUser + s.blocked;
    const workers = s.jobs.filter(
      (card) => card.status === 'running' && card.workerAgentId !== undefined,
    ).length;
    const wall = longestActiveJobElapsedMs(s.jobs, now);
    const parts = [
      theme.fg('primary', `${String(s.running)}▸`),
      theme.fg('info', `${String(s.queued)}…`),
      theme.fg('textDim', `${String(s.total)} total`),
    ];
    if (workers > 0) parts.push(theme.fg('text', `${String(workers)} workers`));
    if (wall !== undefined) parts.push(theme.fg('textMuted', `⏱ ${formatJobDuration(wall)}`));
    if (attention > 0) {
      parts.push(
        theme.boldFg(s.blocked > 0 ? 'error' : 'warning', `${String(attention)} need you`),
      );
    }
    if (s.maxConcurrent !== undefined && s.maxConcurrent > 0) {
      parts.push(theme.fg('textMuted', `pool ${String(s.running)}/${String(s.maxConcurrent)}`));
    }
    return truncateToWidth(` ${parts.join(theme.fg('textMuted', ' · '))}`, width);
  }

  private renderJobRow(
    card: ConductorJobCard,
    selected: boolean,
    width: number,
    now: number,
  ): string {
    const theme = currentTheme;
    const meta = JOB_STATUS_META[card.status];
    const pointer = selected
      ? theme.boldFg('primary', SELECT_POINTER)
      : ' '.repeat(visibleWidth(SELECT_POINTER));
    const glyph =
      card.status === 'running'
        ? renderPulseGlyph(PULSE_ACTIVE_FRAMES, `job-deck:${card.id}`, meta.glyph, meta.token)
        : theme.fg(meta.token, meta.glyph);
    const changedRecently =
      card.statusChangedAtMs !== undefined &&
      card.previousStatus !== undefined &&
      now - card.statusChangedAtMs < DECK_SETTLE_MS;

    const elapsed = jobElapsedMs(card, now);
    const rightParts: string[] = [card.kind, `p${String(card.priority)}`];
    if (elapsed !== undefined) rightParts.push(formatJobDuration(elapsed));
    if (card.progress?.phase !== undefined && card.progress.phase.length > 0) {
      rightParts.push(card.progress.phase);
    } else if (
      card.progress?.stepsTotal !== undefined &&
      card.progress.stepsTotal > 0
    ) {
      rightParts.push(`${String(card.progress.stepsCompleted ?? 0)}/${String(card.progress.stepsTotal)} steps`);
    }
    if (card.usage !== undefined) {
      rightParts.push(
        `${formatTokenCount(card.usage.input + card.usage.output)}tok`,
      );
    }
    if (card.workerAgentId !== undefined) {
      rightParts.push(shortAgentId(card.workerAgentId));
    }
    const right = theme.fg('textMuted', rightParts.join(' · '));

    // Truncate the plain title first so ANSI settle/selection styles stay intact.
    const leftBudget = Math.max(8, width - visibleWidth(right) - 4);
    const prefix = `${pointer} ${glyph} `;
    const titleBudget = Math.max(3, leftBudget - visibleWidth(prefix));
    const titlePlain = truncateToWidth(card.title, titleBudget, '…');
    const title = changedRecently
      ? renderToneSettleFlash(titlePlain, `job-deck-row:${card.id}`, card.statusChangedAtMs!, meta.token)
      : selected
        ? theme.boldFg('primary', titlePlain)
        : theme.fg('text', titlePlain);
    const left = `${prefix}${title}`;
    const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(right));
    return ` ${left}${' '.repeat(gap)}${right}`;
  }

  // ── transcript drill-down ─────────────────────────────────────────────

  private openTranscript(card: ConductorJobCard): void {
    this.transcript = {
      card,
      lines: [],
      usage: undefined,
      loading: true,
      error: undefined,
      scrollOffset: 0,
      followTail: true,
      lastFetchMs: 0,
      fetching: false,
      fetchGeneration: 0,
    };
    this.statusText = undefined;
    this.repaint();
    void this.fetchTranscript(this.transcript);
  }

  private handleTranscriptInput(data: string): void {
    const state = this.transcript;
    if (state === undefined) return;
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.transcript = undefined;
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.up)) {
      state.followTail = false;
      state.scrollOffset = Math.max(0, state.scrollOffset - 1);
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.down)) {
      const maxOffset = Math.max(0, state.lines.length - DECK_TRANSCRIPT_ROWS);
      state.scrollOffset = Math.min(maxOffset, state.scrollOffset + 1);
      state.followTail = state.scrollOffset >= maxOffset;
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      state.followTail = false;
      state.scrollOffset = Math.max(0, state.scrollOffset - DECK_TRANSCRIPT_ROWS);
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      const maxOffset = Math.max(0, state.lines.length - DECK_TRANSCRIPT_ROWS);
      state.scrollOffset = Math.min(maxOffset, state.scrollOffset + DECK_TRANSCRIPT_ROWS);
      state.followTail = state.scrollOffset >= maxOffset;
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.home)) {
      state.scrollOffset = 0;
      state.followTail = false;
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.end)) {
      state.scrollOffset = Math.max(0, state.lines.length - DECK_TRANSCRIPT_ROWS);
      state.followTail = true;
      this.repaint();
      return;
    }
    const ch = printableChar(data);
    if (ch === 'g' || ch === 'G') {
      state.scrollOffset = 0;
      state.followTail = false;
      this.repaint();
      return;
    }
    if (ch === 'f' || ch === 'F') {
      state.followTail = true;
      state.scrollOffset = Math.max(0, state.lines.length - DECK_TRANSCRIPT_ROWS);
      this.repaint();
      return;
    }
    if (ch === 'r' || ch === 'R') {
      void this.fetchTranscript(state);
      return;
    }
    if (ch === 's' || ch === 'S') {
      if (state.card.status === 'running') {
        this.composing = { kind: 'steer', card: state.card };
        this.draft = '';
        this.repaint();
      }
    }
  }

  private maybeRefreshTranscript(): void {
    const state = this.transcript;
    if (state === undefined || state.fetching || state.error !== undefined) return;
    if (state.card.status !== 'running') return;
    if (Date.now() - state.lastFetchMs < DECK_TRANSCRIPT_REFRESH_MS) return;
    void this.fetchTranscript(state);
  }

  private async fetchTranscript(state: TranscriptState): Promise<void> {
    const requestId = state.fetchGeneration + 1;
    state.fetchGeneration = requestId;
    state.fetching = true;
    state.lastFetchMs = Date.now();
    try {
      const load = await this.loadWorker(state.card);
      // Drop stale responses if the operator already left the drill-down.
      if (this.transcript !== state || state.fetchGeneration !== requestId) return;
      state.lines = load.lines;
      state.usage = load.usage;
      state.error = load.error;
      state.loading = false;
      if (state.followTail) {
        state.scrollOffset = Math.max(0, state.lines.length - DECK_TRANSCRIPT_ROWS);
      }
    } catch {
      if (this.transcript === state && state.fetchGeneration === requestId) {
        state.loading = false;
        state.error = 'Could not load the worker transcript.';
      }
    } finally {
      if (this.transcript === state && state.fetchGeneration === requestId) {
        state.fetching = false;
        this.repaint();
      }
    }
  }

  private renderTranscript(state: TranscriptState, width: number): string[] {
    const theme = currentTheme;
    const meta = JOB_STATUS_META[state.card.status];
    const now = Date.now();
    const border = renderRendererDividerRow({
      width,
      style: (text) => theme.fg('primary', text),
    });
    const elapsed = jobElapsedMs(state.card, now);
    const headerParts = [
      `${meta.glyph} ${shortJobId(state.card.id)}`,
      state.card.title,
      meta.label,
    ];
    if (elapsed !== undefined) headerParts.push(`⏱ ${formatJobDuration(elapsed)}`);
    if (state.card.workerAgentId !== undefined) {
      headerParts.push(shortAgentId(state.card.workerAgentId));
    }
    const title = renderPremiumHeadline(
      truncateToWidth(headerParts.join(' · '), Math.max(8, width - 4), '…'),
      'job-deck:transcript-title',
    );

    const lines: string[] = [
      border,
      ` ${title}`,
      theme.fg(
        'textMuted',
        ' ↑↓ scroll · PgUp/PgDn page · Home/End · G/F top/tail · S steer · R refresh · Esc back',
      ),
      this.renderUsageStrip(state, width),
      ` ${renderParticleRail(
        Math.max(8, width - 4),
        getActiveAppearancePreferences(),
        `job-deck:tx:${state.card.id}`,
      )}`,
    ];

    if (state.loading) {
      lines.push('', theme.fg('textMuted', `  ${renderShimmerPrefix()}Loading worker transcript…`));
    } else if (state.error !== undefined) {
      lines.push('', theme.fg('error', `  ${state.error}`));
    } else if (state.lines.length === 0) {
      lines.push('', theme.fg('textMuted', '  No transcript output from this worker yet.'));
    } else {
      const visible = state.lines.slice(
        state.scrollOffset,
        state.scrollOffset + DECK_TRANSCRIPT_ROWS,
      );
      for (const line of visible) {
        lines.push(truncateToWidth(`  ${line}`, width));
      }
      if (state.scrollOffset + DECK_TRANSCRIPT_ROWS < state.lines.length) {
        lines.push(
          theme.fg(
            'textDim',
            `  ▼ ${String(state.lines.length - state.scrollOffset - DECK_TRANSCRIPT_ROWS)} more · F jumps to tail`,
          ),
        );
      }
    }

    if (this.composing !== undefined) {
      const draft = this.draft.length === 0 ? theme.fg('textMuted', '…') : theme.fg('text', this.draft);
      lines.push('', `${theme.boldFg('primary', ' Steer: ')}${draft}`);
    }
    lines.push('');
    lines.push(border);
    return lines;
  }

  private renderUsageStrip(state: TranscriptState, width: number): string {
    const theme = currentTheme;
    const parts: string[] = [];
    if (state.usage !== undefined) {
      parts.push(
        theme.fg(
          'info',
          `tokens ${formatTokenCount(state.usage.input)} in · ${formatTokenCount(state.usage.output)} out · ${formatTokenCount(state.usage.cacheRead)} cache`,
        ),
      );
    }
    if (state.card.progress?.phase !== undefined && state.card.progress.phase.length > 0) {
      parts.push(theme.fg('textMuted', `phase ${state.card.progress.phase}`));
    }
    const tools = state.card.progress?.recentTools;
    if (tools !== undefined && tools.length > 0) {
      parts.push(theme.fg('textDim', tools.slice(-3).join(' → ')));
    }
    if (state.card.liveActivity !== undefined) {
      const activity = state.card.liveActivity;
      const target = activity.target === undefined ? '' : ` ${activity.target}`;
      parts.push(theme.fg('primary', `${activity.name}${target}`));
    }
    if (state.card.liveTokens !== undefined) {
      parts.push(theme.fg('textMuted', `~${formatTokenCount(state.card.liveTokens)} live tok`));
    }
    if (state.fetching && !state.loading) {
      parts.push(theme.fg('textMuted', `${renderShimmerPrefix()}syncing`));
    }
    if (parts.length === 0) return '';
    return truncateToWidth(` ${parts.join(theme.fg('textMuted', ' · '))}`, width);
  }

  // ── shared ────────────────────────────────────────────────────────────

  private handleComposeInput(data: string): void {
    const composing = this.composing;
    if (composing === undefined) return;
    if (matchesKey(data, Key.escape)) {
      this.composing = undefined;
      this.draft = '';
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const text = this.draft.trim();
      if (text.length === 0) return;
      this.onAction(composing.kind, composing.card, text);
      this.setStatus(
        composing.kind === 'steer'
          ? `Steer sent to ${shortJobId(composing.card.id)}.`
          : `Answer sent to ${shortJobId(composing.card.id)}.`,
      );
      this.composing = undefined;
      this.draft = '';
      return;
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (this.draft.length > 0) {
        this.draft = this.draft.slice(0, -1);
        this.repaint();
      }
      return;
    }
    const ch = printableChar(data);
    if (ch !== undefined && ch.length > 0) {
      this.draft += ch;
      this.repaint();
    }
  }

  /** Rebuild the list when the ledger snapshot changes, keeping the cursor. */
  private syncSnapshot(): void {
    const next = this.getSnapshot();
    if (next === this.snapshot) return;
    this.snapshot = next;
    const selectedId = this.list.selected()?.id;
    this.list = this.buildList(next, selectedId);
    if (this.transcript !== undefined) {
      const fresh = next.jobs.find((entry) => entry.id === this.transcript?.card.id);
      if (fresh !== undefined) this.transcript.card = fresh;
    }
  }

  private buildList(
    snapshot: ConductorJobsSnapshot,
    focusJobId: string | undefined,
  ): SearchableList<ConductorJobCard> {
    const cards = [...snapshot.jobs].sort(
      (a, b) =>
        DECK_STATUS_RANK[a.status] - DECK_STATUS_RANK[b.status] ||
        b.priority - a.priority ||
        b.updatedAtMs - a.updatedAtMs,
    );
    const initialIndex = Math.max(
      0,
      focusJobId === undefined ? 0 : cards.findIndex((card) => card.id === focusJobId),
    );
    return new SearchableList({
      items: cards,
      toSearchText: (card) => `${card.id} ${card.title} ${card.status} ${card.kind}`,
      pageSize: DECK_LIST_ROWS,
      searchable: true,
      initialIndex,
    });
  }

  private setStatus(text: string): void {
    this.statusText = text;
    this.repaint();
  }

  private repaint(): void {
    this.invalidate();
    this.requestRenderHook?.();
  }
}

/** `12482` → `12.5k` for dense token strips. */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/** Compact worker agent id for dense mission rows (`agent_abcd…` → `abcd`). */
export function shortAgentId(agentId: string): string {
  const bare = agentId.replace(/^agent[_-]?/iu, '');
  return bare.length <= 8 ? bare : bare.slice(0, 8);
}

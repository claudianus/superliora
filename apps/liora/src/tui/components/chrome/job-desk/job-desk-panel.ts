/**
 * JobDeskPanel — Conductor job desk rendered as a live kanban board inside
 * the transcript screen (chrome slot below the Todo board). Replaces the
 * former full-screen control-tower takeover: the operator keeps the prompt
 * input, the transcript, and the live Job lanes on one surface.
 *
 * Data flows in through {@link setSnapshot} (`job.*` protocol events →
 * `appState.conductorJobs`); the panel is passive (no focus/input) and
 * collapses to zero rows while the ledger is empty so the layout slot
 * disappears entirely.
 *
 * v2 "Mission Deck" surface: pool gauge, desk wall clock, per-card elapsed
 * chips, lane-move settle flashes, a live activity ticker, and a card hit
 * map so the mouse router can drill into the interactive Job Deck viewer.
 */

import {
  renderRendererDividerRow,
  renderRendererSegmentedProgressBar,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '#/tui/renderer';

import { PULSE_ACTIVE_FRAMES } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme/theme';
import type { ColorToken } from '#/tui/theme';
import {
  ambientAnimationActive,
  getActiveAppearancePreferences,
  renderDangerBreathe,
  renderParticleRail,
  renderPulseGlyph,
  renderPulseText,
  renderShimmerPrefix,
  renderToneSettleFlash,
} from '#/tui/features/appearance/appearance-effects';
import { renderRoundedPanel } from '#/tui/utils/ui/panel-frame';
import {
  computeJobBackpressure,
  JOB_STATUS_META,
  shortJobId,
  sortJobCards,
} from '#/tui/components/job-board/job-board-helpers';
import type {
  ConductorJobCard,
  ConductorJobsSnapshot,
} from '#/tui/utils/job/job-strip';
import {
  emptyConductorJobsSnapshot,
  formatJobDuration,
  jobElapsedMs,
  longestActiveJobElapsedMs,
} from '#/tui/utils/job/job-strip';

/** Minimum interior width for the 4-column kanban grid; below → stacked lanes. */
export const JOB_DESK_BOARD_MIN_WIDTH = 84;
const JOB_DESK_COLUMN_MIN_WIDTH = 18;
const JOB_DESK_INDENT = '  ';
const BOARD_SEPARATOR = ' │ ';
/** Cards per lane before a `+N more` footer trims the column. */
const LANE_CARD_CAP = 6;
/** Frame geometry of renderRoundedPanel(leftMargin=2, sidePadding=1). */
const FRAME_INSET_X = 4;
const FRAME_INSET_Y = 1;
/** Ticker rotates through running workers on this cadence. */
const TICKER_ROTATE_MS = 2400;

interface JobDeskLane {
  readonly key: string;
  readonly label: string;
  readonly statuses: readonly ConductorJobCard['status'][];
  readonly token: ColorToken;
}

/** Actionable attention first (contract §5.2 pin), terminal states last. */
const JOB_DESK_LANES: readonly JobDeskLane[] = [
  { key: 'attention', label: 'Needs you', statuses: ['needs_user', 'blocked'], token: 'warning' },
  { key: 'running', label: 'Running', statuses: ['running'], token: 'primary' },
  { key: 'queue', label: 'Queue', statuses: ['queued', 'interrupted'], token: 'info' },
  { key: 'closed', label: 'Closed', statuses: ['failed', 'done', 'cancelled'], token: 'textDim' },
];

/** Clickable card region recorded during render (content-row space). */
interface JobDeskCardHit {
  readonly row: number;
  readonly x0: number;
  readonly x1: number;
  readonly jobId: string;
}

export interface JobDeskPanelStateLike {
  readonly jobDeskPanel: JobDeskPanelComponent;
  readonly jobDeskPanelContainer: {
    clear(): void;
    addChild(child: Component): void;
  };
}

/** Mount/unmount the panel in its chrome slot from its own visibility state. */
export function syncJobDeskPanelContainer(state: JobDeskPanelStateLike): void {
  state.jobDeskPanelContainer.clear();
  if (state.jobDeskPanel.shouldMount()) {
    state.jobDeskPanelContainer.addChild(state.jobDeskPanel);
  }
}

export class JobDeskPanelComponent implements Component {
  private snapshot: ConductorJobsSnapshot = emptyConductorJobsSnapshot();
  /** Operator hid the panel (`/jobs board` toggle); job events never force it back. */
  private hidden = false;
  private lastRender:
    | { readonly width: number; readonly snapshot: ConductorJobsSnapshot; readonly lines: string[] }
    | undefined;
  /** Card hit map from the last render, keyed by panel-local coordinates. */
  private cardHits: readonly JobDeskCardHit[] = [];
  private hitInsetX = FRAME_INSET_X;
  private hitInsetY = FRAME_INSET_Y;

  setSnapshot(snapshot: ConductorJobsSnapshot): void {
    this.snapshot = snapshot;
  }

  getSnapshot(): ConductorJobsSnapshot {
    return this.snapshot;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }

  isHidden(): boolean {
    return this.hidden;
  }

  clear(): void {
    this.snapshot = emptyConductorJobsSnapshot();
    this.hidden = false;
    this.lastRender = undefined;
    this.cardHits = [];
  }

  isEmpty(): boolean {
    return this.snapshot.jobs.length === 0;
  }

  /** The chrome slot mounts the panel while it has cards and is not hidden. */
  shouldMount(): boolean {
    return !this.hidden && !this.isEmpty();
  }

  invalidate(): void {}

  /**
   * Map a panel-local point to the job card rendered there (mouse router).
   * Coordinates are relative to the panel's top-left screen cell.
   */
  hitTestCard(localX: number, localY: number): string | undefined {
    const row = localY - this.hitInsetY;
    const x = localX - this.hitInsetX;
    if (row < 0 || x < 0) return undefined;
    for (const hit of this.cardHits) {
      if (hit.row === row && x >= hit.x0 && x < hit.x1) return hit.jobId;
    }
    return undefined;
  }

  render(width: number): string[] {
    if (!this.shouldMount()) return [];
    const memo = this.lastRender;
    // Motion (pulse glyphs, ticker rotation, settle flashes, wall clock) is
    // clock-driven: skip the snapshot memo while animation runs so ambient
    // repaints actually advance the frames.
    if (
      memo !== undefined &&
      memo.width === width &&
      memo.snapshot === this.snapshot &&
      !ambientAnimationActive()
    ) {
      return memo.lines;
    }

    const s = this.snapshot;
    const now = Date.now();
    const laneHits: JobDeskCardHit[] = [];
    const contentWidth = Math.max(1, width - 2 - 2 - 2); // margin + border + padding
    const lines: string[] = [this.renderMeta(s)];
    if (s.running > 0) {
      lines.push(
        `${JOB_DESK_INDENT}${renderParticleRail(
          Math.max(8, contentWidth - 2),
          getActiveAppearancePreferences(),
          'job-desk:rail',
        )}`,
      );
    }
    const ticker = this.renderTicker(s, contentWidth, now);
    if (ticker !== undefined) lines.push(ticker);
    // Lane hits are recorded in lane-local rows; shift them into content-row
    // space (meta + ticker/rail rows precede the lanes) before hit-testing.
    const laneRowOffset = lines.length;
    lines.push(...this.renderLanes(s.jobs, contentWidth, now, laneHits));
    this.cardHits = laneHits.map((hit) => ({ ...hit, row: hit.row + laneRowOffset }));
    this.hitInsetX = width < 48 ? 2 : FRAME_INSET_X;
    this.hitInsetY = width < 48 ? 0 : FRAME_INSET_Y;
    lines.push(this.renderFooterHint(contentWidth));

    const unread = s.unreadInbox > 0 ? ` · inbox ${String(s.unreadInbox)}` : '';
    const wall = longestActiveJobElapsedMs(s.jobs, now);
    const clock = wall !== undefined ? ` · ⏱ ${formatJobDuration(wall)}` : '';
    const workers = s.jobs.filter((card) => card.workerAgentId !== undefined).length;
    const workerChip = workers > 0 ? ` · ${String(workers)} workers` : '';
    const title = ` Conductor Job Desk · ${String(s.running)}▸ ${String(s.queued)}…${clock}${workerChip}${unread} `;

    const panelLines = renderRoundedPanel({
      title,
      content: lines,
      width,
      borderToken: this.borderToken(s),
      leftMargin: 2,
      minBoxWidth: 48,
    });
    this.lastRender = { width, snapshot: s, lines: panelLines };
    return panelLines;
  }

  // ── meta row ──────────────────────────────────────────────────────────

  private renderMeta(s: ConductorJobsSnapshot): string {
    const parts: string[] = [];
    const attention = s.needsUser + s.blocked;
    if (attention > 0) {
      const label = `attention ${String(attention)} — /job answer <id> <text>`;
      parts.push(
        s.blocked > 0
          ? renderDangerBreathe(label, 'job-desk:attention')
          : currentTheme.boldFg('warning', label),
      );
    }
    const gauge = this.renderPoolGauge(s);
    if (gauge !== undefined) parts.push(gauge);
    const backpressure = computeJobBackpressure(s);
    if (backpressure !== undefined && gauge === undefined) {
      parts.push(currentTheme.fg(backpressure.token, backpressure.label));
    }
    const done = Math.max(
      0,
      s.total - s.running - s.queued - s.blocked - s.needsUser - s.interrupted - s.failed,
    );
    const workers = s.jobs.filter(
      (card) => card.status === 'running' && card.workerAgentId !== undefined,
    ).length;
    const counts = [
      `running ${String(s.running)}`,
      `queued ${String(s.queued)}`,
      workers > 0 ? `workers ${String(workers)}` : undefined,
      s.interrupted > 0 ? `⏸ ${String(s.interrupted)}` : undefined,
      s.failed > 0 ? `✗ ${String(s.failed)}` : undefined,
      `done ${String(done)}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · ');
    parts.push(
      s.running > 0 ? renderPulseText(counts, 'job-desk:counts', 'primary') : currentTheme.fg('textDim', counts),
    );
    return `${JOB_DESK_INDENT}${parts.join(currentTheme.fg('textMuted', ' · '))}`;
  }

  /** Discoverability footer — click, Alt+J, or `/jobs deck` opens the monitor. */
  private renderFooterHint(width: number): string {
    return truncateToWidth(
      `${JOB_DESK_INDENT}${currentTheme.fg('textMuted', 'click · Alt+J · /jobs deck — worker transcript · tokens · steer')}`,
      width,
      '…',
    );
  }

  /** `pool ▰▰▱· 2/4` worker-slot gauge when the ledger knows the cap. */
  private renderPoolGauge(s: ConductorJobsSnapshot): string | undefined {
    const max = s.maxConcurrent;
    if (max === undefined || max <= 0) return undefined;
    const running = Math.min(s.running, max);
    const queued = Math.min(s.queued, Math.max(0, max - running));
    const free = Math.max(0, max - running - queued);
    const bar = renderRendererSegmentedProgressBar({
      width: Math.max(4, Math.min(10, max + 2)),
      segments: [
        { value: running, char: '▰', style: (text) => currentTheme.fg('primary', text) },
        { value: queued, char: '▱', style: (text) => currentTheme.fg('info', text) },
        { value: free, char: '·', style: (text) => currentTheme.fg('textMuted', text) },
      ],
    });
    const loadToken: ColorToken =
      s.queued > 0 && s.running >= max ? 'warning' : s.running > 0 ? 'primary' : 'textDim';
    return `${currentTheme.fg('textMuted', 'pool')} ${bar} ${currentTheme.fg(
      loadToken,
      `${String(s.running)}/${String(max)}`,
    )}`;
  }

  /** Live activity ticker: rotates through running workers' phase + tools. */
  private renderTicker(
    s: ConductorJobsSnapshot,
    width: number,
    now: number,
  ): string | undefined {
    const running = s.jobs.filter(
      (card) =>
        card.status === 'running' &&
        ((card.progress?.phase !== undefined && card.progress.phase.length > 0) ||
          (card.progress?.recentTools !== undefined && card.progress.recentTools.length > 0)),
    );
    if (running.length === 0) return undefined;
    const index = Math.floor(now / TICKER_ROTATE_MS) % running.length;
    const card = running[index]!;
    const phase = card.progress?.phase ?? '';
    const tools = card.progress?.recentTools ?? [];
    const toolTrail = tools.slice(-3).join(' → ');
    const body = [shortJobId(card.id), phase, toolTrail]
      .filter((part) => part.length > 0)
      .join(' · ');
    const stale = isHeartbeatStale(card, now);
    const text = `${renderShimmerPrefix()}${currentTheme.fg(
      'primary',
      '▸',
    )} ${truncateToWidth(body, Math.max(1, width - 6), '…')}${
      stale ? currentTheme.fg('warning', ' ⌛ heartbeat stale') : ''
    }`;
    return `${JOB_DESK_INDENT}${truncateToWidth(text, width, '…')}`;
  }

  // ── kanban grid / stacked lanes ───────────────────────────────────────

  private renderLanes(
    cards: readonly ConductorJobCard[],
    width: number,
    now: number,
    hits: JobDeskCardHit[],
  ): string[] {
    const lanes = JOB_DESK_LANES.map((lane) => ({
      lane,
      cards: sortJobCards(cards.filter((card) => lane.statuses.includes(card.status))),
    })).filter((entry) => entry.cards.length > 0 || entry.lane.key !== 'closed');

    const availableWidth = Math.max(1, width - visibleWidth(JOB_DESK_INDENT));
    const columnWidth = Math.floor(
      (availableWidth - visibleWidth(BOARD_SEPARATOR) * (lanes.length - 1)) / lanes.length,
    );
    if (columnWidth >= JOB_DESK_COLUMN_MIN_WIDTH && width >= JOB_DESK_BOARD_MIN_WIDTH) {
      return this.renderBoard(lanes, columnWidth, now, hits);
    }
    return this.renderStacked(lanes.filter((entry) => entry.cards.length > 0), width, now, hits);
  }

  private renderBoard(
    lanes: readonly { lane: JobDeskLane; cards: readonly ConductorJobCard[] }[],
    columnWidth: number,
    now: number,
    hits: JobDeskCardHit[],
  ): string[] {
    const separator = currentTheme.fg('border', BOARD_SEPARATOR);
    const columnRule = renderRendererDividerRow({
      width: columnWidth,
      style: (text) => currentTheme.fg('border', text),
    });
    const lines = [
      JOB_DESK_INDENT +
        lanes
          .map((entry) => padCell(this.renderLaneHeader(entry.lane, entry.cards.length), columnWidth))
          .join(separator),
      JOB_DESK_INDENT + lanes.map(() => columnRule).join(separator),
    ];
    const baseRow = lines.length;

    const rowCount = Math.min(
      LANE_CARD_CAP,
      Math.max(1, ...lanes.map((entry) => entry.cards.length)),
    );
    const xCursorBase = visibleWidth(JOB_DESK_INDENT);
    for (let row = 0; row < rowCount; row++) {
      const cells: string[] = [];
      let x = xCursorBase;
      lanes.forEach((entry) => {
        const card = entry.cards[row];
        if (card === undefined) {
          cells.push(padCell(currentTheme.fg('textMuted', '·'), columnWidth));
        } else {
          cells.push(padCell(this.renderCard(card, entry.lane, columnWidth, now), columnWidth));
          hits.push({ row: baseRow + row, x0: x, x1: x + columnWidth, jobId: card.id });
        }
        x += columnWidth + visibleWidth(BOARD_SEPARATOR);
      });
      lines.push(JOB_DESK_INDENT + cells.join(separator));
    }
    const overflow = lanes
      .filter((entry) => entry.cards.length > LANE_CARD_CAP)
      .map((entry) => `${entry.lane.label.toLowerCase()} +${String(entry.cards.length - LANE_CARD_CAP)}`);
    if (overflow.length > 0) {
      lines.push(currentTheme.fg('textDim', `${JOB_DESK_INDENT}… ${overflow.join(' · ')}`));
    }
    return lines;
  }

  private renderStacked(
    lanes: readonly { lane: JobDeskLane; cards: readonly ConductorJobCard[] }[],
    width: number,
    now: number,
    hits: JobDeskCardHit[],
  ): string[] {
    const lines: string[] = [];
    const indentX = visibleWidth(JOB_DESK_INDENT);
    for (const { lane, cards } of lanes) {
      lines.push(`${JOB_DESK_INDENT}${this.renderLaneHeader(lane, cards.length)}`);
      for (const card of cards.slice(0, LANE_CARD_CAP)) {
        hits.push({ row: lines.length, x0: indentX, x1: width, jobId: card.id });
        lines.push(
          truncateToWidth(`${JOB_DESK_INDENT}  ${this.renderCard(card, lane, width - indentX - 2, now)}`, width),
        );
      }
      if (cards.length > LANE_CARD_CAP) {
        lines.push(
          currentTheme.fg('textDim', `${JOB_DESK_INDENT}  … +${String(cards.length - LANE_CARD_CAP)} more`),
        );
      }
    }
    return lines;
  }

  // ── row primitives ────────────────────────────────────────────────────

  private renderLaneHeader(lane: JobDeskLane, count: number): string {
    return currentTheme.boldFg(lane.token, `${lane.label} (${String(count)})`);
  }

  private renderCard(
    card: ConductorJobCard,
    lane: JobDeskLane,
    columnWidth: number,
    now: number,
  ): string {
    const meta = JOB_STATUS_META[card.status];
    const glyph =
      card.status === 'running'
        ? renderPulseGlyph(PULSE_ACTIVE_FRAMES, `job-desk:${card.id}`, meta.glyph, meta.token)
        : currentTheme.fg(meta.token, meta.glyph);
    const id = currentTheme.fg('textDim', shortJobId(card.id));
    const titleToken: ColorToken =
      card.status === 'done' || card.status === 'cancelled'
        ? 'textMuted'
        : lane.key === 'attention'
          ? lane.token
          : 'text';
    // Lane moves settle-flash; at rest the card reads in its lane tone.
    const changedRecently =
      card.statusChangedAtMs !== undefined &&
      card.previousStatus !== undefined &&
      now - card.statusChangedAtMs < 4000;
    const elapsed = jobElapsedMs(card, now);
    const elapsedChip =
      elapsed !== undefined ? currentTheme.fg('textDim', ` ${formatJobDuration(elapsed)}`) : '';
    const stepsChip =
      card.progress?.stepsTotal !== undefined && card.progress.stepsTotal > 0
        ? currentTheme.fg(
            'textMuted',
            ` ${String(card.progress.stepsCompleted ?? 0)}/${String(card.progress.stepsTotal)}`,
          )
        : '';
    const tokenChip =
      card.usage !== undefined
        ? currentTheme.fg(
            'info',
            ` ${formatDenseTokens(card.usage.input + card.usage.output)}tok`,
          )
        : '';
    const fixedWidth =
      visibleWidth(glyph) +
      1 +
      visibleWidth(id) +
      1 +
      visibleWidth(elapsedChip) +
      visibleWidth(stepsChip) +
      visibleWidth(tokenChip);
    const titleBudget = Math.max(3, columnWidth - fixedWidth);
    const titlePlain = truncateToWidth(card.title, titleBudget, '…');
    const title = changedRecently
      ? renderToneSettleFlash(titlePlain, `job-desk-card:${card.id}`, card.statusChangedAtMs!, lane.token)
      : currentTheme.fg(titleToken, titlePlain);
    return `${glyph} ${id} ${title}${stepsChip}${tokenChip}${elapsedChip}`;
  }

  private borderToken(s: ConductorJobsSnapshot): ColorToken {
    if (s.blocked > 0 || s.failed > 0) return 'error';
    if (s.needsUser > 0) return 'warning';
    if (s.running > 0) return 'primary';
    return 'border';
  }
}

/** Heartbeat older than 60s reads as stale on the ticker. */
function isHeartbeatStale(card: ConductorJobCard, now: number): boolean {
  const iso = card.progress?.lastHeartbeatAt;
  if (iso === undefined) return false;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return false;
  return now - at > 60_000;
}

/** Dense token chip for kanban cards (`12482` → `12.5k`). */
function formatDenseTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function padCell(content: string, width: number): string {
  if (width <= 0) return '';
  const fitted =
    visibleWidth(content) <= width ? content : truncateToWidth(content, width, '…');
  return fitted + ' '.repeat(Math.max(0, width - visibleWidth(fitted)));
}

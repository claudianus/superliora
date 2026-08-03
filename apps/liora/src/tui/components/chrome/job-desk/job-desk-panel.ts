/**
 * JobDeskPanel — Conductor job desk rendered as a kanban board inside the
 * transcript screen (chrome slot below the Todo board). Replaces the former
 * full-screen control-tower takeover: the operator keeps the prompt input,
 * the transcript, and the live Job lanes on one surface.
 *
 * Data flows in through {@link setSnapshot} (`job.*` protocol events →
 * `appState.conductorJobs`); the panel is passive (no focus/input) and
 * collapses to zero rows while the ledger is empty so the layout slot
 * disappears entirely.
 */

import {
  renderRendererDividerRow,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '#/tui/renderer';

import { PULSE_ACTIVE_FRAMES } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme/theme';
import type { ColorToken } from '#/tui/theme';
import { renderPulseGlyph } from '#/tui/features/appearance/appearance-effects';
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
import { emptyConductorJobsSnapshot } from '#/tui/utils/job/job-strip';

/** Minimum interior width for the 4-column kanban grid; below → stacked lanes. */
export const JOB_DESK_BOARD_MIN_WIDTH = 84;
const JOB_DESK_COLUMN_MIN_WIDTH = 18;
const JOB_DESK_INDENT = '  ';
const BOARD_SEPARATOR = ' │ ';
/** Cards per lane before a `+N more` footer trims the column. */
const LANE_CARD_CAP = 6;

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
  private lastRender: { readonly width: number; readonly snapshot: ConductorJobsSnapshot; readonly lines: string[] } | undefined;

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
  }

  isEmpty(): boolean {
    return this.snapshot.jobs.length === 0;
  }

  /** The chrome slot mounts the panel while it has cards and is not hidden. */
  shouldMount(): boolean {
    return !this.hidden && !this.isEmpty();
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.shouldMount()) return [];
    const memo = this.lastRender;
    if (memo !== undefined && memo.width === width && memo.snapshot === this.snapshot) {
      return memo.lines;
    }

    const s = this.snapshot;
    const contentWidth = Math.max(1, width - 2 - 2 - 2); // margin + border + padding
    const lines: string[] = [this.renderMeta(s), ...this.renderLanes(s.jobs, contentWidth)];
    const unread = s.unreadInbox > 0 ? ` · inbox ${String(s.unreadInbox)}` : '';
    const title = ` Conductor Job Desk · ${String(s.running)}▸ ${String(s.queued)}…${unread} `;

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
      parts.push(
        currentTheme.boldFg(
          s.blocked > 0 ? 'error' : 'warning',
          `attention ${String(attention)} — /job answer <id> <text>`,
        ),
      );
    }
    const backpressure = computeJobBackpressure(s);
    if (backpressure !== undefined) {
      parts.push(currentTheme.fg(backpressure.token, backpressure.label));
    }
    parts.push(
      currentTheme.fg(
        'textDim',
        `running ${String(s.running)} · queued ${String(s.queued)} · done ${String(
          Math.max(0, s.total - s.running - s.queued - s.blocked - s.needsUser - s.interrupted - s.failed),
        )}`,
      ),
    );
    return `${JOB_DESK_INDENT}${parts.join(currentTheme.fg('textMuted', ' · '))}`;
  }

  // ── kanban grid / stacked lanes ───────────────────────────────────────

  private renderLanes(cards: readonly ConductorJobCard[], width: number): string[] {
    const lanes = JOB_DESK_LANES.map((lane) => ({
      lane,
      cards: sortJobCards(cards.filter((card) => lane.statuses.includes(card.status))),
    })).filter((entry) => entry.cards.length > 0 || entry.lane.key !== 'closed');

    const availableWidth = Math.max(1, width - visibleWidth(JOB_DESK_INDENT));
    const columnWidth = Math.floor(
      (availableWidth - visibleWidth(BOARD_SEPARATOR) * (lanes.length - 1)) / lanes.length,
    );
    if (columnWidth >= JOB_DESK_COLUMN_MIN_WIDTH && width >= JOB_DESK_BOARD_MIN_WIDTH) {
      return this.renderBoard(lanes, columnWidth);
    }
    return this.renderStacked(lanes.filter((entry) => entry.cards.length > 0), width);
  }

  private renderBoard(
    lanes: readonly { lane: JobDeskLane; cards: readonly ConductorJobCard[] }[],
    columnWidth: number,
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

    const rowCount = Math.min(
      LANE_CARD_CAP,
      Math.max(1, ...lanes.map((entry) => entry.cards.length)),
    );
    for (let row = 0; row < rowCount; row++) {
      lines.push(
        JOB_DESK_INDENT +
          lanes
            .map((entry) => {
              const card = entry.cards[row];
              if (card === undefined) {
                return padCell(currentTheme.fg('textMuted', '·'), columnWidth);
              }
              return padCell(this.renderCard(card, entry.lane), columnWidth);
            })
            .join(separator),
      );
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
  ): string[] {
    const lines: string[] = [];
    for (const { lane, cards } of lanes) {
      lines.push(`${JOB_DESK_INDENT}${this.renderLaneHeader(lane, cards.length)}`);
      for (const card of cards.slice(0, LANE_CARD_CAP)) {
        lines.push(truncateToWidth(`${JOB_DESK_INDENT}  ${this.renderCard(card, lane)}`, width));
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

  private renderCard(card: ConductorJobCard, lane: JobDeskLane): string {
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
    const title = currentTheme.fg(titleToken, card.title);
    return `${glyph} ${id} ${title}`;
  }

  private borderToken(s: ConductorJobsSnapshot): ColorToken {
    if (s.blocked > 0 || s.failed > 0) return 'error';
    if (s.needsUser > 0) return 'warning';
    if (s.running > 0) return 'primary';
    return 'border';
  }
}

function padCell(content: string, width: number): string {
  if (width <= 0) return '';
  const fitted =
    visibleWidth(content) <= width ? content : truncateToWidth(content, width, '…');
  return fitted + ' '.repeat(Math.max(0, width - visibleWidth(fitted)));
}

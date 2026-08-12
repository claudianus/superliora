/**
 * Conductor Timeline pane — vertical stages from Job desk snapshot.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '#/tui/renderer';
import { SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  renderPremiumHeadline,
  renderToneSettleFlash,
} from '#/tui/features/appearance/appearance-effects';
import { shortJobId } from '#/tui/components/job-board/job-board-helpers';
import {
  buildConductorTimeline,
  countConductorTimelineEntries,
  TIMELINE_ENTRY_WINDOW,
  timelineStageLabel,
  type ConductorTimelineEntry,
  type ConductorTimelineStage,
} from '#/tui/features/control-tower/timeline';
import type { ConductorJobsSnapshot } from '#/tui/utils/job/job-strip';
import { emptyConductorJobsSnapshot } from '#/tui/utils/job/job-strip';
import { JOB_STATUS_META } from '#/tui/components/job-board/job-board-helpers';

export interface ConductorTimelinePanelOptions {
  readonly getSnapshot: () => ConductorJobsSnapshot;
  readonly onOpenChat?: () => void;
  readonly onSelectJob?: (jobId: string) => void;
  readonly requestRender?: () => void;
}

export class ConductorTimelinePanelComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: ConductorTimelinePanelOptions;
  private selectedIndex = 0;
  private scrollOffset = 0;
  /** Memo: rebuild projection only when the snapshot identity changes. */
  private cachedSnap: ConductorJobsSnapshot | undefined;
  private cachedAllCount = 0;
  private cachedEntries: readonly ConductorTimelineEntry[] = [];

  constructor(opts: ConductorTimelinePanelOptions) {
    super();
    this.opts = opts;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.opts.onOpenChat?.();
      return;
    }
    const entries = this.entries();
    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex -= 1;
      } else if (this.scrollOffset > 0) {
        this.scrollOffset -= 1;
        this.cachedSnap = undefined;
      }
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < entries.length - 1) {
        this.selectedIndex += 1;
      } else if (this.scrollOffset + TIMELINE_ENTRY_WINDOW < this.cachedAllCount) {
        this.scrollOffset += 1;
        this.cachedSnap = undefined;
      }
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - TIMELINE_ENTRY_WINDOW);
      this.selectedIndex = 0;
      this.cachedSnap = undefined;
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      const maxOffset = Math.max(0, this.totalCount() - TIMELINE_ENTRY_WINDOW);
      this.scrollOffset = Math.min(maxOffset, this.scrollOffset + TIMELINE_ENTRY_WINDOW);
      this.selectedIndex = 0;
      this.cachedSnap = undefined;
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const entry = entries[this.selectedIndex];
      if (entry !== undefined) this.opts.onSelectJob?.(entry.jobId);
    }
  }

  override render(width: number): string[] {
    const theme = currentTheme;
    const entries = this.entries();
    if (this.selectedIndex >= entries.length) {
      this.selectedIndex = Math.max(0, entries.length - 1);
    }
    const lines: string[] = [
      renderPremiumHeadline('Conductor Timeline', 'conductor-timeline:title'),
      theme.fg('textMuted', ' ↑↓ navigate · Enter select · Esc cancel'),
      '',
    ];
    if (entries.length === 0) {
      lines.push(theme.fg('textDim', '  No active jobs yet — send work to Conductor.'));
      return lines;
    }
    let lastStage: ConductorTimelineStage | undefined;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.stage !== lastStage) {
        lastStage = entry.stage;
        lines.push(this.renderStageHeader(entry.stage, entry));
      }
      lines.push(this.renderEntry(entry, i === this.selectedIndex, width));
    }
    const hiddenAbove = this.scrollOffset;
    const hiddenBelow = Math.max(
      0,
      this.cachedAllCount - this.scrollOffset - entries.length,
    );
    if (hiddenAbove > 0 || hiddenBelow > 0) {
      lines.push(
        theme.fg(
          'textDim',
          `  ${hiddenAbove > 0 ? `▲ ${String(hiddenAbove)} more · ` : ''}${
            hiddenBelow > 0 ? `▼ ${String(hiddenBelow)} more` : ''
          }`.trimEnd(),
        ),
      );
    }
    return lines;
  }

  private totalCount(): number {
    this.entries();
    return this.cachedAllCount;
  }

  private entries(): readonly ConductorTimelineEntry[] {
    const snap = this.opts.getSnapshot() ?? emptyConductorJobsSnapshot();
    if (this.cachedSnap === snap) return this.cachedEntries;
    this.cachedSnap = snap;
    this.cachedAllCount = countConductorTimelineEntries(snap);
    const maxOffset = Math.max(0, this.cachedAllCount - TIMELINE_ENTRY_WINDOW);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
    this.cachedEntries = buildConductorTimeline(snap, {
      scrollOffset: this.scrollOffset,
      windowSize: TIMELINE_ENTRY_WINDOW,
    });
    return this.cachedEntries;
  }

  private renderStageHeader(
    stage: ConductorTimelineStage,
    sample: ConductorTimelineEntry,
  ): string {
    const theme = currentTheme;
    const label = `── ${timelineStageLabel(stage)} ──`;
    const changedAt = sample.statusChangedAtMs;
    if (
      changedAt !== undefined &&
      appearanceAnimationNow() - changedAt < 1_200
    ) {
      return ` ${renderToneSettleFlash(label, `timeline-stage:${stage}`, changedAt, 'accent')}`;
    }
    return theme.fg('accent', ` ${label}`);
  }

  private renderEntry(entry: ConductorTimelineEntry, selected: boolean, width: number): string {
    const theme = currentTheme;
    const idle = ' '.repeat(visibleWidth(SELECT_POINTER));
    const pointer = selected ? theme.boldFg('primary', SELECT_POINTER) : idle;
    const meta = JOB_STATUS_META[entry.status] ?? JOB_STATUS_META.running;
    const titlePlain = entry.title;
    const title =
      entry.statusChangedAtMs !== undefined &&
      appearanceAnimationNow() - entry.statusChangedAtMs < 1_200
        ? renderToneSettleFlash(
            titlePlain,
            `timeline-row:${entry.jobId}`,
            entry.statusChangedAtMs,
            meta.token,
          )
        : theme.fg(selected ? 'textStrong' : 'text', titlePlain);
    const idMeta = theme.fg('textDim', ` ${shortJobId(entry.jobId)} · ${entry.status}`);
    const detail =
      entry.detail === undefined || entry.detail.length === 0
        ? ''
        : theme.fg('textMuted', ` · ${entry.detail}`);
    return truncateToWidth(` ${pointer} ${title}${idMeta}${detail}`, Math.max(1, width), '…');
  }
}

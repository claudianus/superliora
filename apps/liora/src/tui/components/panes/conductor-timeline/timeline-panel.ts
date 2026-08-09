/**
 * Conductor Timeline pane — vertical stages from Job desk snapshot.
 */

import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { renderPremiumHeadline } from '#/tui/features/appearance/appearance-effects';
import { shortJobId } from '#/tui/components/job-board/job-board-helpers';
import {
  buildConductorTimeline,
  timelineStageLabel,
  type ConductorTimelineEntry,
  type ConductorTimelineStage,
} from '#/tui/features/control-tower/timeline';
import type { ConductorJobsSnapshot } from '#/tui/utils/job/job-strip';
import { emptyConductorJobsSnapshot } from '#/tui/utils/job/job-strip';

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
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.opts.requestRender?.();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(Math.max(0, entries.length - 1), this.selectedIndex + 1);
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
    const snap = this.opts.getSnapshot() ?? emptyConductorJobsSnapshot();
    const entries = this.entries();
    if (this.selectedIndex >= entries.length) {
      this.selectedIndex = Math.max(0, entries.length - 1);
    }
    const lines: string[] = [
      renderPremiumHeadline('Conductor Timeline', 'conductor-timeline:title'),
      theme.fg('textMuted', ' Intake → Running → Needs you → Land · Esc chat'),
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
        lines.push(theme.fg('accent', `── ${timelineStageLabel(entry.stage)} ──`));
      }
      lines.push(this.renderEntry(entry, i === this.selectedIndex, width));
    }
    return lines;
  }

  private entries(): readonly ConductorTimelineEntry[] {
    return buildConductorTimeline(this.opts.getSnapshot() ?? emptyConductorJobsSnapshot());
  }

  private renderEntry(entry: ConductorTimelineEntry, selected: boolean, width: number): string {
    const theme = currentTheme;
    const pointer = selected ? theme.fg('primary', '›') : ' ';
    const title = theme.fg(selected ? 'textStrong' : 'text', entry.title);
    const meta = theme.fg('textDim', ` ${shortJobId(entry.jobId)} · ${entry.status}`);
    const detail =
      entry.detail === undefined || entry.detail.length === 0
        ? ''
        : theme.fg('textMuted', ` · ${entry.detail}`);
    return truncateToWidth(` ${pointer} ${title}${meta}${detail}`, Math.max(1, width), '…');
  }
}

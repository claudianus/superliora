/**
 * Worker transcript drill-down — opened from the Worker Dock (Enter / click).
 * Presentation-only: data arrives via `loadTranscript` / `getWorker` closures.
 *
 * Prefer Job Deck when the worker is a Conductor job agent; this surface covers
 * subagents and background workers that have no job card.
 */

import {
  Container,
  Key,
  matchesKey,
  renderRendererDividerRow,
  truncateToWidth,
  type Focusable,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import {
  getActiveAppearancePreferences,
  renderParticleRail,
  renderPremiumHeadline,
  renderShimmerPrefix,
} from '#/tui/features/appearance/appearance-effects';
import { printableChar } from '#/tui/utils/printable-key';
import { formatJobDuration } from '#/tui/utils/job/job-strip';
import type { MissionWorker } from '#/tui/controllers/mission-control/registry';
import { ttui } from '#/tui/utils/tui-i18n';

const TRANSCRIPT_ROWS = 16;
/** Slow fallback when dock telemetry is quiet but the worker is still live. */
const REFRESH_FALLBACK_MS = 5_000;

export interface WorkerTranscriptLoad {
  readonly lines: readonly string[];
  readonly error?: string;
}

export interface WorkerTranscriptViewerOptions {
  readonly workerId: string;
  readonly getWorker: () => MissionWorker | undefined;
  readonly loadTranscript: (workerId: string) => Promise<WorkerTranscriptLoad>;
  readonly onCancel: () => void;
  readonly requestRender?: () => void;
}

interface LoadState {
  lines: readonly string[];
  loading: boolean;
  error: string | undefined;
  scrollOffset: number;
  followTail: boolean;
  lastFetchMs: number;
  fetching: boolean;
  fetchGeneration: number;
  /** Dock telemetry fingerprint that last triggered a fetch. */
  lastWorkerSignal: string;
}

export class WorkerTranscriptViewerComponent extends Container implements Focusable {
  focused = false;

  private readonly workerId: string;
  private readonly getWorker: () => MissionWorker | undefined;
  private readonly loadTranscript: (workerId: string) => Promise<WorkerTranscriptLoad>;
  private readonly onCancel: () => void;
  private readonly requestRenderHook?: () => void;
  private state: LoadState;

  constructor(opts: WorkerTranscriptViewerOptions) {
    super();
    this.workerId = opts.workerId;
    this.getWorker = opts.getWorker;
    this.loadTranscript = opts.loadTranscript;
    this.onCancel = opts.onCancel;
    this.requestRenderHook = opts.requestRender;
    this.state = {
      lines: [],
      loading: true,
      error: undefined,
      scrollOffset: 0,
      followTail: true,
      lastFetchMs: 0,
      fetching: false,
      fetchGeneration: 0,
      lastWorkerSignal: workerSignal(opts.getWorker()),
    };
    void this.fetch();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('c'))) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.state.followTail = false;
      this.state.scrollOffset = Math.max(0, this.state.scrollOffset - 1);
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.down)) {
      const maxOffset = Math.max(0, this.state.lines.length - TRANSCRIPT_ROWS);
      this.state.scrollOffset = Math.min(maxOffset, this.state.scrollOffset + 1);
      this.state.followTail = this.state.scrollOffset >= maxOffset;
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.state.followTail = false;
      this.state.scrollOffset = Math.max(0, this.state.scrollOffset - TRANSCRIPT_ROWS);
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      const maxOffset = Math.max(0, this.state.lines.length - TRANSCRIPT_ROWS);
      this.state.scrollOffset = Math.min(maxOffset, this.state.scrollOffset + TRANSCRIPT_ROWS);
      this.state.followTail = this.state.scrollOffset >= maxOffset;
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.state.scrollOffset = 0;
      this.state.followTail = false;
      this.repaint();
      return;
    }
    if (matchesKey(data, Key.end)) {
      this.state.scrollOffset = Math.max(0, this.state.lines.length - TRANSCRIPT_ROWS);
      this.state.followTail = true;
      this.repaint();
      return;
    }
    const ch = printableChar(data);
    if (ch === 'g' || ch === 'G') {
      this.state.scrollOffset = 0;
      this.state.followTail = false;
      this.repaint();
      return;
    }
    if (ch === 'f' || ch === 'F') {
      this.state.followTail = true;
      this.state.scrollOffset = Math.max(0, this.state.lines.length - TRANSCRIPT_ROWS);
      this.repaint();
      return;
    }
    if (ch === 'r' || ch === 'R') {
      void this.fetch();
    }
  }

  override render(width: number): string[] {
    this.maybeRefresh();
    const theme = currentTheme;
    const worker = this.getWorker();
    const border = renderRendererDividerRow({
      width,
      style: (text) => theme.fg('primary', text),
    });
    const name = worker?.name ?? this.workerId;
    const status = worker?.status ?? 'running';
    const statusToken =
      status === 'failed'
        ? 'error'
        : status === 'stalled' || status === 'suspended'
          ? 'warning'
          : status === 'completed'
            ? 'textDim'
            : 'primary';
    const elapsed =
      worker === undefined ? '' : ` · ${formatJobDuration(worker.elapsedMs)}`;
    const tools =
      worker === undefined || worker.toolCount <= 0
        ? ''
        : ` · ${String(worker.toolCount)} tools`;
    const titlePlain = truncateToWidth(
      `${name} · ${status}${elapsed}${tools}`,
      Math.max(8, width - 4),
      '…',
    );
    const title = renderPremiumHeadline(titlePlain, `worker-tx:${this.workerId}`);
    const lines: string[] = [
      border,
      ` ${title}`,
      theme.fg(
        'textMuted',
        ` ${ttui('tui.missionControl.transcriptHint')}`,
      ),
      this.renderMetaStrip(worker, width),
      ...(status === 'running' || status === 'finishing'
        ? [
            ` ${renderParticleRail(
              Math.max(8, width - 4),
              getActiveAppearancePreferences(),
              `worker-tx:rail:${this.workerId}`,
            )}`,
          ]
        : []),
    ];

    if (this.state.loading) {
      lines.push(
        '',
        theme.fg(
          'textMuted',
          `  ${renderShimmerPrefix()}${ttui('tui.missionControl.transcriptLoading')}`,
        ),
      );
    } else if (this.state.error !== undefined) {
      lines.push('', theme.fg('error', `  ${this.state.error}`));
    } else if (this.state.lines.length === 0) {
      lines.push(
        '',
        theme.fg('textMuted', `  ${ttui('tui.missionControl.transcriptEmpty')}`),
      );
      if (worker?.liveText !== undefined && worker.liveText.length > 0) {
        lines.push(
          theme.fg(statusToken, `  ◌ ${truncateToWidth(worker.liveText, Math.max(8, width - 6), '…')}`),
        );
      }
      if (worker?.lastTool !== undefined) {
        const target = worker.lastTarget === undefined ? '' : ` ${worker.lastTarget}`;
        lines.push(theme.fg('textDim', `  → ${worker.lastTool}${target}`));
      }
      if (worker?.error !== undefined) {
        lines.push(theme.fg('error', `  ${worker.error}`));
      }
    } else {
      const visible = this.state.lines.slice(
        this.state.scrollOffset,
        this.state.scrollOffset + TRANSCRIPT_ROWS,
      );
      for (const line of visible) {
        lines.push(truncateToWidth(`  ${line}`, width));
      }
      if (this.state.scrollOffset + TRANSCRIPT_ROWS < this.state.lines.length) {
        lines.push(
          theme.fg(
            'textDim',
            `  ▼ ${String(this.state.lines.length - this.state.scrollOffset - TRANSCRIPT_ROWS)} more · F → tail`,
          ),
        );
      }
    }

    lines.push('');
    lines.push(border);
    return lines;
  }

  private renderMetaStrip(worker: MissionWorker | undefined, width: number): string {
    const theme = currentTheme;
    if (worker === undefined) {
      return theme.fg('textDim', ` ${ttui('tui.missionControl.transcriptWorkerGone')}`);
    }
    const parts: string[] = [theme.fg('textMuted', worker.kind)];
    if (worker.modelAlias !== undefined) {
      parts.push(theme.fg('textDim', worker.modelAlias));
    }
    if (worker.focusTodo !== undefined && worker.focusTodo.length > 0) {
      parts.push(theme.fg('text', truncateToWidth(worker.focusTodo, 40, '…')));
    } else if (worker.description !== undefined && worker.description.length > 0) {
      parts.push(theme.fg('textDim', truncateToWidth(worker.description, 40, '…')));
    }
    if (this.state.fetching && !this.state.loading) {
      parts.push(theme.fg('textMuted', `${renderShimmerPrefix()}sync`));
    }
    return truncateToWidth(` ${parts.join(theme.fg('textMuted', ' · '))}`, width, '…');
  }

  private maybeRefresh(): void {
    const worker = this.getWorker();
    if (worker === undefined) return;
    if (worker.status !== 'running' && worker.status !== 'finishing') return;
    if (this.state.fetching || this.state.error !== undefined) return;
    // Event-driven: dock liveText / tool activity already advances; refetch
    // transcript when those signals move rather than on a fixed 2s poll.
    const signal = workerSignal(worker);
    if (signal !== this.state.lastWorkerSignal) {
      this.state.lastWorkerSignal = signal;
      void this.fetch();
      return;
    }
    if (Date.now() - this.state.lastFetchMs < REFRESH_FALLBACK_MS) return;
    void this.fetch();
  }

  private async fetch(): Promise<void> {
    const requestId = this.state.fetchGeneration + 1;
    this.state.fetchGeneration = requestId;
    this.state.fetching = true;
    this.state.lastFetchMs = Date.now();
    try {
      const load = await this.loadTranscript(this.workerId);
      if (this.state.fetchGeneration !== requestId) return;
      this.state.lines = load.lines;
      this.state.error = load.error;
      this.state.loading = false;
      if (this.state.followTail) {
        this.state.scrollOffset = Math.max(0, this.state.lines.length - TRANSCRIPT_ROWS);
      }
    } catch {
      if (this.state.fetchGeneration === requestId) {
        this.state.loading = false;
        this.state.error = ttui('tui.missionControl.transcriptLoadFailed');
      }
    } finally {
      if (this.state.fetchGeneration === requestId) {
        this.state.fetching = false;
        this.repaint();
      }
    }
  }

  private repaint(): void {
    this.invalidate();
    this.requestRenderHook?.();
  }
}

/** Dock telemetry fingerprint for event-driven transcript refresh. */
function workerSignal(worker: MissionWorker | undefined): string {
  if (worker === undefined) return '';
  return [
    worker.status,
    String(worker.toolCount),
    worker.lastTool ?? '',
    worker.lastTarget ?? '',
    String(worker.lastActivityAtMs),
    worker.liveText ?? '',
    String(worker.tokens),
  ].join('|');
}

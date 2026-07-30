/**
 * Footer/status bar — multi-line status display at the bottom of the TUI.
 *
 * Layout:
 *   Line 1: [yolo] [ultrawork] [plan] <model> <cwd>  <git-badge>  <shortcut hints>
 *   Line 2: context: XX.X% (tokens/max)
 */

import type { Component } from '#/tui/renderer';
import { truncateToWidth } from '#/tui/renderer';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import type { AppState } from '#/tui/types';
import type { MotionBeatSnapshot } from '#/tui/utils/motion-beats';
import {
  createGitStatusCache,
  type GitStatusCache,
} from '#/utils/git/git-status';

import type { FooterTranscriptViewportSnapshot } from '#/tui/components/chrome/footer-chrome';
import {
  GOAL_TIMER_INTERVAL_MS,
  goalSnapshotKey,
} from '#/tui/components/chrome/footer-goal';
import {
  renderFooterLine1,
  type FooterLine1TipState,
} from '#/tui/components/chrome/footer-render-line1';
import { renderFooterLine2 } from '#/tui/components/chrome/footer-render-line2';

export { buildWeightedTips } from '#/tui/components/chrome/footer-tips';
export {
  contextUsageSeverity,
  formatContextOSFooterBadge,
  formatMediaFooterBadge,
  formatMicroCompactionFooterBadge,
  formatProviderQuotaFooterBadge,
  formatWorkingSetFooterBadge,
  mediaImageKeyReady,
  mediaProviderKeyReady,
  mediaVideoKeyReady,
  type FooterBadge,
  type FooterBadgeSeverity,
} from '#/tui/components/chrome/footer-badges';
export { formatFooterGitBadge } from '#/tui/components/chrome/footer-chrome';

export class FooterComponent implements Component {
  private state: AppState;
  private readonly onRefresh: () => void;
  private readonly getTranscriptViewport: (() => FooterTranscriptViewportSnapshot) | undefined;
  private gitCache: GitStatusCache;
  private gitCacheWorkDir: string;
  private transientHint: string | null = null;
  private goalSnapshotKey: string | null = null;
  private goalObservedAtMs = Date.now();
  private goalTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Non-terminal background-task counts split by kind so the footer can
   * render two distinct badges. `bashTasks` covers `bash-*` BPM tasks
   * spawned via `Shell run_in_background=true`; `agentTasks` covers
   * `agent-*` BPM tasks (background subagents). Either zero hides its
   * respective badge.
   */
  private backgroundBashTaskCount = 0;
  private backgroundAgentCount = 0;
  private readonly tipState: FooterLine1TipState = { tipDisplay: '', tipChangedAtMs: 0 };
  private getActiveMotionBeat: (() => MotionBeatSnapshot | undefined) | undefined;

  constructor(
    state: AppState,
    onRefresh: () => void = () => {},
    getTranscriptViewport?: () => FooterTranscriptViewportSnapshot,
  ) {
    this.state = state;
    this.onRefresh = onRefresh;
    this.getTranscriptViewport = getTranscriptViewport;
    this.gitCacheWorkDir = state.workDir;
    this.gitCache = createGitStatusCache(state.workDir, { onChange: this.onRefresh });
    this.syncGoalClock(state.goal);
    this.syncGoalTimer(state.goal);
  }

  /** Optional source for mode_enter/mode_exit shimmer while a beat is live. */
  setMotionBeatSource(getActive: () => MotionBeatSnapshot | undefined): void {
    this.getActiveMotionBeat = getActive;
  }

  setState(state: AppState): void {
    if (state.workDir !== this.gitCacheWorkDir) {
      this.gitCacheWorkDir = state.workDir;
      this.gitCache = createGitStatusCache(state.workDir, { onChange: this.onRefresh });
    }
    this.syncGoalClock(state.goal);
    this.syncGoalTimer(state.goal);
    this.state = state;
  }

  /**
   * Short-lived hint that replaces the rotating toolbar tips on line 1.
   * Used by the exit-confirmation double-tap flow to show "Press Ctrl+C
   * again to exit" without requiring a toast/overlay subsystem.
   * Pass `null` to clear.
   */
  setTransientHint(hint: string | null): void {
    this.transientHint = hint;
  }

  getTransientHint(): string | null {
    return this.transientHint;
  }

  /**
   * Sync both background-task badges with live counts. Each non-zero
   * count produces its own bracketed badge on line 1; zeros hide them
   * independently.
   */
  setBackgroundCounts(counts: { bashTasks: number; agentTasks: number }): void {
    this.backgroundBashTaskCount = Math.max(0, counts.bashTasks);
    this.backgroundAgentCount = Math.max(0, counts.agentTasks);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const state = this.state;
    const appearance = state.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    const activeBeat = this.getActiveMotionBeat?.();
    const git = this.gitCache.getStatus();

    const line1 = renderFooterLine1({
      state,
      appearance,
      activeBeat,
      getTranscriptViewport: this.getTranscriptViewport,
      goalWallClockMs: this.goalWallClockMs(state.goal),
      backgroundBashTaskCount: this.backgroundBashTaskCount,
      backgroundAgentCount: this.backgroundAgentCount,
      git,
      width,
      tipState: this.tipState,
    });

    const line2 = renderFooterLine2({
      state,
      appearance,
      git,
      width,
      transientHint: this.transientHint,
      activeBeat,
    });

    return [truncateToWidth(line1, width), truncateToWidth(line2, width)];
  }

  /**
   * Tear down owned resources (goal timer). Called from the TUI shutdown path
   * so the refresh interval does not keep firing into a stopped renderer.
   * Idempotent.
   */
  dispose(): void {
    if (this.goalTimer !== null) {
      clearInterval(this.goalTimer);
      this.goalTimer = null;
    }
  }

  private syncGoalClock(goal: AppState['goal']): void {
    const key = goalSnapshotKey(goal);
    if (key === this.goalSnapshotKey) return;
    this.goalSnapshotKey = key;
    this.goalObservedAtMs = Date.now();
  }

  private syncGoalTimer(goal: AppState['goal']): void {
    if (goal?.status === 'active') {
      if (this.goalTimer !== null) return;
      this.goalTimer = setInterval(() => {
        this.onRefresh();
      }, GOAL_TIMER_INTERVAL_MS);
      this.goalTimer.unref?.();
      return;
    }

    if (this.goalTimer !== null) {
      clearInterval(this.goalTimer);
      this.goalTimer = null;
    }
  }

  private goalWallClockMs(goal: AppState['goal']): number | undefined {
    if (goal === null || goal === undefined) return undefined;
    if (goal.status !== 'active') return goal.wallClockMs;
    return goal.wallClockMs + Math.max(0, Date.now() - this.goalObservedAtMs);
  }
}

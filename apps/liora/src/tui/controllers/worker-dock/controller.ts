/**
 * WorkerDockController — owns the worker registry and pushes composed
 * views (registry snapshot + operator Job ledger) into the shared panel.
 * The session-event handler feeds every session event through
 * {@link handleEvent}; the app-state sync calls {@link pushView} when the
 * `conductorJobs` ledger changes. Render invalidation escalates to a layout
 * render only when the panel crosses empty↔non-empty or the mode changes
 * (the bottom band height depends on both).
 */

import type { Event, IndependentSessionActivity } from '@superliora/sdk';

import type { TUIState } from '../../tui-state';
import {
  requestTUIContentRender,
  requestTUILayoutRender,
} from '../../utils/render/frame-render';
import { invalidateTranscriptHitTestCache } from '../../features/transcript/transcript-hit-test';
import { emptyConductorJobsSnapshot } from '../../utils/job/job-strip';
import type { WorkerDockMode } from '../../features/worker-dock/dock';
import { workerDockModeOf } from '../../features/worker-dock/dock';
import { WorkerDockRegistry } from './registry';
import type { WorkerDockGhostJob } from './registry';

export interface WorkerDockHost {
  readonly state: TUIState;
}

export class WorkerDockController {
  readonly registry = new WorkerDockRegistry();

  constructor(private readonly host: WorkerDockHost) {}

  /** Feed one session event into the worker roster; repaints on change. */
  handleEvent(event: Event): void {
    if (!this.registry.apply(event)) return;
    this.pushView();
  }

  /** Independent-session telemetry goes only to task panels, never main chat. */
  handleIndependentActivity(activity: IndependentSessionActivity): void {
    if (activity.type === 'attention') {
      if (this.registry.setWorkerAttention(activity.sessionId, activity.agentId, activity.attention)) this.pushView();
    } else if (activity.type === 'snapshot') {
      const metadata = activity.total === undefined || activity.truncated === undefined || activity.counts === undefined
        ? undefined : { total: activity.total, truncated: activity.truncated, counts: activity.counts };
      if (this.registry.applyIndependentFacts(activity.conductorSessionId, activity.records, metadata)) this.pushView();
    } else {
      if (this.registry.applyIndependentEvent(activity.conductorSessionId, activity.record, activity.event)) this.pushView();
    }
  }

  /**
   * After resume, seed ghost workers from the job ledger so the Dock shows
   * job titles before live subagent events arrive.
   */
  hydrateGhostsFromJobs(
    jobs: { readonly jobs: readonly WorkerDockGhostJob[] },
  ): void {
    if (this.registry.hydrateJobGhosts(jobs.jobs)) {
      this.pushView();
      return;
    }
    this.pushView();
  }

  /** Compose the latest view into the panel and invalidate the frame. */
  pushView(): void {
    const { state } = this.host;
    const panel = state.workerDockPanel;
    const wasEmpty = panel.isEmpty();
    const workDir = state.appState.workDir || process.cwd();
    const jobs = state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
    // Ghost hydrate is idempotent and field-equality gated; still needed so
    // resume queues appear, but no longer version-bumps on every heartbeat.
    this.registry.hydrateJobGhosts(jobs.jobs);
    panel.setView({
      snapshot: this.registry.snapshot(),
      tree: this.registry.treeSnapshot(state.appState.sessionId),
      jobs,
      workDir,
    });
    if (panel.isEmpty() !== wasEmpty) {
      // Mount/unmount moves chrome regions — bust the mouse hit-test cache
      // and relayout.
      invalidateTranscriptHitTestCache(state);
      requestTUILayoutRender(state);
      return;
    }
    requestTUIContentRender(state);
  }

  mode(): WorkerDockMode {
    return workerDockModeOf(this.host.state);
  }

  /** Startup sync: reflect the persisted mode on the panel (no repaint). */
  syncPreferences(): void {
    this.host.state.workerDockPanel.setPinned(this.mode() === 'pinned');
  }

  /**
   * Ambient-clock hook (wiring `forceAmbientSchedule`): any worker on the
   * roster — active or completed-but-lingering — needs 1s chrome ticks so
   * elapsed clocks advance and the linger expiry collapses the panel.
   * O(workers) membership only — never builds a full projected snapshot.
   */
  hasLiveWorkers(): boolean {
    return this.registry.hasVisibleWorkers();
  }

  /** `/agents` cycle: auto → pinned → hidden → auto. */
  cycleMode(): WorkerDockMode {
    const next: WorkerDockMode =
      this.mode() === 'auto' ? 'pinned' : this.mode() === 'pinned' ? 'hidden' : 'auto';
    this.setMode(next);
    return next;
  }

  setMode(mode: WorkerDockMode): void {
    if (mode === this.mode()) return;
    const { state } = this.host;
    state.appState.appearance = {
      ...state.appState.appearance,
      workerDock: mode,
    } as NonNullable<typeof state.appState.appearance>;
    state.workerDockPanel.setPinned(mode === 'pinned');
    invalidateTranscriptHitTestCache(state);
    requestTUILayoutRender(state);
  }

  /** Session close: drop the roster so the next session starts clean. */
  reset(): void {
    this.registry.reset();
    this.pushView();
  }
}

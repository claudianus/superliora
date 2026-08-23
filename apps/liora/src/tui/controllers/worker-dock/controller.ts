/**
 * WorkerDockController — owns the worker registry and pushes composed
 * views (registry snapshot + Conductor jobs ledger) into the shared panel.
 * The session-event handler feeds every session event through
 * {@link handleEvent}; the app-state sync calls {@link pushView} when the
 * `conductorJobs` ledger changes. Render invalidation escalates to a layout
 * render only when the panel crosses empty↔non-empty or the mode changes
 * (the bottom band height depends on both).
 */

import type { Event } from '@superliora/sdk';

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

  /**
   * After resume, seed ghost workers from the job ledger so the Dock shows
   * job titles before live subagent events arrive.
   */
  hydrateGhostsFromJobs(
    jobs: ReturnType<typeof emptyConductorJobsSnapshot> | {
      readonly jobs: readonly {
        readonly id: string;
        readonly title: string;
        readonly status: string;
        readonly workerAgentId?: string;
        readonly progress?: { readonly phase?: string };
      }[];
    },
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

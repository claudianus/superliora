/**
 * In-stack Mission Control band: mounts once in the chrome stack (just above
 * the editor) and renders the shared panel at the stage's full reading width
 * when {@link workerDockBandActive} — zero rows otherwise, so the region
 * collapses exactly like the other situational panes.
 */

import type { Component } from '#/tui/renderer';

import type { WorkerDockPanelComponent } from './panel';

export interface WorkerDockFallbackOptions {
  readonly panel: WorkerDockPanelComponent;
  /** `workerDockBandActive` decision for the current view. */
  readonly visible: () => boolean;
}

export class WorkerDockFallbackComponent implements Component {
  constructor(private readonly options: WorkerDockFallbackOptions) {}

  invalidate(): void {
    this.options.panel.invalidate();
  }

  render(width: number): string[] {
    if (!this.options.visible()) return [];
    return this.options.panel.render(width);
  }
}

/**
 * In-stack Mission Control band: mounts once in the chrome stack (just above
 * the editor) and renders the shared panel at the stage's full reading width
 * when {@link missionBandActive} — zero rows otherwise, so the region
 * collapses exactly like the other situational panes.
 */

import type { Component } from '#/tui/renderer';

import type { MissionControlPanelComponent } from './panel';

export interface MissionControlFallbackOptions {
  readonly panel: MissionControlPanelComponent;
  /** `missionBandActive` decision for the current view. */
  readonly visible: () => boolean;
}

export class MissionControlFallbackComponent implements Component {
  constructor(private readonly options: MissionControlFallbackOptions) {}

  invalidate(): void {
    this.options.panel.invalidate();
  }

  render(width: number): string[] {
    if (!this.options.visible()) return [];
    return this.options.panel.render(width);
  }
}

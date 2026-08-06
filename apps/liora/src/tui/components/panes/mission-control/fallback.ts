/**
 * In-stack Mission Control band for narrow terminals: mounts once in the
 * chrome stack and renders the shared panel when the right dock cannot own
 * the surface (below the width threshold) — zero rows otherwise, so the
 * region collapses exactly like the other situational panes.
 */

import type { Component } from '#/tui/renderer';

import type { MissionControlPanelComponent } from './panel';

export interface MissionControlFallbackOptions {
  readonly panel: MissionControlPanelComponent;
  /** `missionFallbackActive` decision for the current terminal width. */
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

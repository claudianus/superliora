/**
 * Interactive Ops Theatre panel — Enter focuses a pending approval panel; Esc closes.
 */

import { Key, matchesKey, type Component, type Focusable } from '#/tui/renderer';

import {
  UsagePanelComponent,
  type UsagePanelComponentOptions,
} from '../../components/messages/usage-panel/index';

export interface OpsTheatrePanelOptions extends UsagePanelComponentOptions {
  readonly hasPendingApproval: () => boolean;
  readonly onFocusApproval: () => void;
  readonly onDismiss: () => void;
}

/** Bordered Ops grid with keyboard hooks for the intervention tray. */
export class OpsTheatrePanelComponent implements Component, Focusable {
  private readonly usage: UsagePanelComponent;
  private readonly hasPendingApproval: () => boolean;
  private readonly onFocusApproval: () => void;
  private readonly onDismiss: () => void;

  constructor(options: OpsTheatrePanelOptions) {
    this.hasPendingApproval = options.hasPendingApproval;
    this.onFocusApproval = options.onFocusApproval;
    this.onDismiss = options.onDismiss;
    this.usage = new UsagePanelComponent(options);
  }

  invalidate(): void {
    this.usage.invalidate();
  }

  render(width: number): string[] {
    return this.usage.render(width);
  }

  snapshotBodyLines(fillProgress = 1): readonly string[] {
    return this.usage.snapshotBodyLines(fillProgress);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.onDismiss();
      return;
    }
    if (matchesKey(data, Key.enter) && this.hasPendingApproval()) {
      this.onFocusApproval();
    }
  }
}

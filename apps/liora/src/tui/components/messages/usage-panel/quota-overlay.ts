/**
 * QuotaOverlayComponent — mounts the live remaining-credits (Quota) report as
 * an *editor-replacement* overlay so it behaves like the homepage demo's Q
 * overlay: pressing Q again (or Esc) closes it and returns to the free editor,
 * and opening it never stacks a duplicate report.
 *
 * The report body reuses the battle-tested {@link UsagePanelComponent}
 * renderer (bordered rounded panel + entrance animation); this thin wrapper
 * only adds the editor-replacement surface contract (`Focusable`, `render`,
 * `invalidate`) and input routing so the panel can live in the editor area and
 * be dismissed. Data/build lines are supplied by the opener via `buildLines`.
 */

import type { Component, Focusable } from '#/tui/renderer';
import { Key, matchesKey } from '#/tui/renderer';
import type { ColorToken } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { UsagePanelComponent } from './index';

export interface QuotaOverlayOptions {
  /** Rebuild the report body; re-run by `invalidate` (theme switches etc.). */
  readonly buildLines: () => readonly string[];
  /** Panel title text (bordered-box header). */
  readonly title: string;
  /** Close the overlay and hand focus back to the free editor. */
  readonly onCancel: () => void;
  /** Repaint hook for clock-driven entrance/ambient animation frames. */
  readonly requestRender?: () => void;
  readonly borderToken?: ColorToken;
}

/**
 * Focusable editor-replacement wrapper around the usage-report renderer.
 * Closes on Esc and on a bare `q`/`Q` (the same key that opens it from an
 * empty idle prompt), giving the overlay real press-again-to-close semantics.
 */
export class QuotaOverlayComponent implements Component, Focusable {
  focused = false;
  private readonly panel: UsagePanelComponent;
  private readonly onCancel: () => void;

  constructor(options: QuotaOverlayOptions) {
    this.panel = new UsagePanelComponent({
      buildLines: () => options.buildLines(),
      title: options.title,
      borderToken: options.borderToken,
      requestRender: options.requestRender,
      enterBeatSeed: 'quota',
    });
    this.onCancel = options.onCancel;
  }

  invalidate(): void {
    this.panel.invalidate();
  }

  render(width: number): string[] {
    return this.panel.render(width);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.onCancel();
      return;
    }
    const printable = printableChar(data);
    if (printable !== undefined && printable.toLowerCase() === 'q') {
      this.onCancel();
    }
  }
}

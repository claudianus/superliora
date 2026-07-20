/**
 * TerminalDiagnosticsPanel — compact capability report shown by `/term`.
 *
 * Wraps the pure formatter from `terminal-diagnostics` in the shared rounded
 * panel frame.
 */

import type { Component } from '#/tui/renderer';

import { renderRoundedPanel } from '#/tui/utils/panel-frame';
import {
  formatTerminalDiagnosticsLines,
  type TerminalDiagnosticsReport,
} from '#/tui/utils/terminal-diagnostics';

export class TerminalDiagnosticsPanel implements Component {
  constructor(private readonly report: TerminalDiagnosticsReport) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    return renderRoundedPanel({
      title: ' Terminal ',
      content: formatTerminalDiagnosticsLines(this.report),
      width: safeWidth,
      borderToken: 'primary',
      leftMargin: 2,
      minBoxWidth: 40,
    });
  }
}

/**
 * TerminalDiagnosticsPanel — compact capability report shown by `/term`.
 *
 * Wraps the pure formatter from `terminal-diagnostics` in the shared rounded
 * panel frame.
 */

import type { Component } from '#/tui/renderer';

import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
} from '#/tui/features/appearance/appearance-effects';
import {
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';
import { renderRoundedPanel } from '#/tui/utils/ui/panel-frame';
import {
  formatTerminalDiagnosticsLines,
  type TerminalDiagnosticsReport,
} from '#/tui/utils/terminal/terminal-diagnostics';

export class TerminalDiagnosticsPanel implements Component {
  private readonly entranceStartedAtMs = appearanceAnimationNow();

  constructor(private readonly report: TerminalDiagnosticsReport) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];
    const lines = renderRoundedPanel({
      title: ' Terminal ',
      content: formatTerminalDiagnosticsLines(this.report),
      width: safeWidth,
      borderToken: 'primary',
      leftMargin: 2,
      minBoxWidth: 40,
    });
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs)) return lines;
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'status',
      appearance: getActiveAppearancePreferences(),
    });
  }
}

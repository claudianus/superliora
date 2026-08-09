/**
 * Per-turn tool chain summary for `minimal` (and optional compact chrome).
 * Live: `▌ tools · Edit · 7 tools · +42/−10`
 * Settled: `▌ tools · Worked for 10m 4s · 7 tools · 2 failed`
 *
 * Individual tool cards stay mounted under the summary; at `minimal` density
 * they render empty until expanded (failure punch-through still shows).
 */

import { Container, Text } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
} from '#/tui/features/appearance/appearance-effects';
import {
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';
import {
  createToolChainStats,
  formatChainLiveSummary,
  formatChainSettledSummary,
  getActiveTranscriptDetail,
  isChainOnlyToolLevel,
  recordChainTool,
  settleToolChain,
  type ChainToolRecord,
  type ToolChainStats,
} from '#/tui/features/transcript/transcript-density';
import {
  formatPhaseHeaderLine,
  phaseGutter,
} from '#/tui/features/transcript/transcript-phase-tint';

export class ToolChainSummaryComponent extends Container {
  private stats: ToolChainStats;
  private currentLabel: string | undefined;
  private readonly summaryText: Text;
  private settled = false;
  private readonly entranceStartedAtMs = appearanceAnimationNow();

  constructor(startedAt: number = Date.now()) {
    super();
    this.stats = createToolChainStats(startedAt);
    // No leading spacer — phase bar sits tight under thinking / user blocks.
    this.summaryText = new Text('', 0, 0);
    this.addChild(this.summaryText);
    this.refresh();
  }

  override render(width: number): string[] {
    const body = this.settled
      ? formatChainSettledSummary(this.stats)
      : formatChainLiveSummary(this.stats, this.currentLabel);
    // Strip leading ⚙ from pure formatter — phase header supplies chrome.
    let detail = body.replace(/^⚙\s*/, '');
    // minimal: tools are hidden — nudge click-to-expand on the chain bar.
    if (isChainOnlyToolLevel(getActiveTranscriptDetail()) && this.stats.toolCount > 0) {
      detail = `${detail} · click expand`;
    }
    // No leading blank — chain bar continues the thinking→tools work block.
    const header = formatPhaseHeaderLine('tools', detail, width);
    const lines = [header];
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs)) {
      return lines;
    }
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'tool',
      streaming: !this.settled,
      appearance: getActiveAppearancePreferences(),
    });
  }

  /** Paint-only invalidate — do not re-enter refresh (avoids invalidate↔refresh loops). */
  override invalidate(): void {
    super.invalidate();
  }

  /** Live "what is running now" label (typically the current tool name). */
  setCurrentLabel(label: string | undefined): void {
    if (this.currentLabel === label) return;
    this.currentLabel = label;
    this.refresh();
  }

  /** Fold one finished tool into the aggregate. */
  record(record: ChainToolRecord): void {
    this.stats = recordChainTool(this.stats, record);
    this.refresh();
  }

  /** Turn ended: switch to the settled past-tense summary (idempotent). */
  settle(now: number = Date.now()): void {
    if (this.settled) return;
    this.settled = true;
    this.currentLabel = undefined;
    this.stats = settleToolChain(this.stats, now);
    this.refresh();
  }

  isSettled(): boolean {
    return this.settled;
  }

  getStats(): ToolChainStats {
    return this.stats;
  }

  private refresh(): void {
    // Keep Text child non-empty so container height stays stable for layout;
    // real paint is done in override render() with phase tint.
    const body = this.settled
      ? formatChainSettledSummary(this.stats)
      : formatChainLiveSummary(this.stats, this.currentLabel);
    this.summaryText.setText(
      currentTheme.fg('primary', `${phaseGutter('tools')} tools  `) +
        currentTheme.dim(body.replace(/^⚙\s*/, '')),
    );
    this.invalidate();
  }
}

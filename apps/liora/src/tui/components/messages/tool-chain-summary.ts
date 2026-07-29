/**
 * One-line per-turn tool chain summary for the `minimal` transcript density
 * (PREMIUM.md §7.9). While the turn's tools run it shows a live aggregate
 * (`⚙ Edit · 7 tools · +42/−10`); once the turn settles it switches to past
 * tense (`Worked for 10m 4s · 7 tools · 2 failed`). Individual tool cards
 * stay mounted as one-line headers under the summary, so failure punch-through
 * and click-to-expand keep working exactly as in `compact`.
 *
 * All statistics are pure projections from `#/tui/utils/transcript-density`;
 * this component only owns styling and mount lifecycle.
 */

import { Container, Spacer, Text } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  createToolChainStats,
  formatChainLiveSummary,
  formatChainSettledSummary,
  recordChainTool,
  settleToolChain,
  type ChainToolRecord,
  type ToolChainStats,
} from '#/tui/utils/transcript-density';

export class ToolChainSummaryComponent extends Container {
  private stats: ToolChainStats;
  private currentLabel: string | undefined;
  private readonly summaryText: Text;
  private settled = false;

  constructor(startedAt: number = Date.now()) {
    super();
    this.stats = createToolChainStats(startedAt);
    this.addChild(new Spacer(1));
    this.summaryText = new Text('', 0, 0);
    this.addChild(this.summaryText);
    this.refresh();
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
    const body = this.settled
      ? formatChainSettledSummary(this.stats)
      : formatChainLiveSummary(this.stats, this.currentLabel);
    this.summaryText.setText(currentTheme.dim(body));
    this.invalidate();
  }
}

/**
 * Renders a compaction block in the transcript.
 *
 * Lifecycle:
 *   - constructed on `compaction.started` → blinking white bullet +
 *     "Compacting context..." and optional custom instruction
 *   - `markDone()` on `compaction.completed` → solid green bullet +
 *     "Compaction complete (X → Y tokens)"
 *   - `markCanceled()` on `compaction.cancelled` → solid warning bullet +
 *     "Compaction cancelled"
 *
 * Bullet animation mirrors `ToolCallComponent` (500ms blink) so the user
 * reads the same "work in progress" signal across the UI.
 */

import { Container, Text, Spacer } from '#/tui/renderer';
import type { RendererRootUI } from '#/tui/renderer';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPremiumHeadline,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

const BLINK_INTERVAL = 500;

export class CompactionComponent extends Container {
  private readonly ui: RendererRootUI | undefined;
  private readonly headerText: Text;
  private readonly instruction: string | undefined;
  private readonly tip: string | undefined;
  private done = false;
  private canceled = false;
  private tokensBefore: number | undefined;
  private tokensAfter: number | undefined;

  constructor(ui?: RendererRootUI, instruction?: string | undefined, tip?: string) {
    super();
    this.ui = ui;
    this.instruction = instruction;
    this.tip = tip;

    // Top margin so the block isn't glued to the previous transcript
    // entry (status line, tool result, etc.).
    this.addChild(new Spacer(1));
    this.headerText = new Text(this.buildHeader(), 0, 0);
    this.addChild(this.headerText);
    this.addInstructionChild();
  }

  private addInstructionChild(): void {
    if (this.instruction !== undefined) {
      this.addChild(new Text(currentTheme.dim(`  ${this.instruction}`), 0, 0));
    }
  }

  override invalidate(): void {
    // Repaint the header with the active palette (it caches ANSI codes).
    this.headerText.setText(this.buildHeader());
    // Rebuild instruction line with fresh theme colours.
    if (this.instruction !== undefined) {
      // Remove the last child if it is the instruction line (it is always
      // added after headerText and Spacer).
      if (this.children.length > 2) {
        this.children.pop();
      }
      this.addInstructionChild();
    }
    super.invalidate();
  }

  override render(width: number): string[] {
    // Recompute the blink state from the shared animation clock so the bullet
    // pulses with the render loop's ticker instead of a private setInterval.
    // See PREMIUM.md §7.1 (single animation clock).
    if (!this.done && !this.canceled) {
      this.headerText.setText(this.buildHeader());
    }
    return super.render(width);
  }

  markDone(tokensBefore?: number, tokensAfter?: number): void {
    if (this.done || this.canceled) return;
    this.done = true;
    this.tokensBefore = tokensBefore;
    this.tokensAfter = tokensAfter;
    this.headerText.setText(this.buildHeader());
    this.ui?.requestRender();
  }

  markCanceled(): void {
    if (this.done || this.canceled) return;
    this.canceled = true;
    this.headerText.setText(this.buildHeader());
    this.ui?.requestRender();
  }

  dispose(): void {}

  private buildHeader(): string {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    if (this.done) {
      const bullet = currentTheme.fg('success', STATUS_BULLET);
      const label = animated
        ? renderPremiumHeadline('Compaction complete', 'compaction:done', appearance)
        : currentTheme.boldFg('success', 'Compaction complete');
      const detail =
        this.tokensBefore !== undefined && this.tokensAfter !== undefined
          ? currentTheme.dim(` (${String(this.tokensBefore)} → ${String(this.tokensAfter)} tokens)`)
          : '';
      return `${bullet}${label}${detail}`;
    }
    if (this.canceled) {
      const bullet = currentTheme.fg('warning', STATUS_BULLET);
      const label = animated
        ? renderPremiumHeadline('Compaction cancelled', 'compaction:cancel', appearance)
        : currentTheme.boldFg('warning', 'Compaction cancelled');
      return `${bullet}${label}`;
    }
    // Derive the blink phase from the animation clock — no private timer.
    const blinkOn = Math.floor(appearanceAnimationNow() / BLINK_INTERVAL) % 2 === 0;
    const bullet = blinkOn ? currentTheme.fg('text', STATUS_BULLET) : '  ';
    const label = animated
      ? renderPremiumHeadline('Compacting context...', 'compaction:active', appearance)
      : currentTheme.boldFg('primary', 'Compacting context...');
    const tip = this.tip ? currentTheme.fg('textDim', ` · Tip: ${this.tip}`) : '';
    return `${bullet}${label}${tip}`;
  }
}

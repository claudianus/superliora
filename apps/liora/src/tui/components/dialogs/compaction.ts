/**
 * Renders a compaction block in the transcript.
 *
 * Lifecycle:
 *   - constructed on `compaction.started` → blinking white bullet +
 *     "Compacting context..." (or background variant) and optional custom instruction
 *   - `markDone()` on `compaction.completed` → solid green bullet +
 *     "Compaction complete (X → Y tokens)"
 *   - `markCanceled()` on `compaction.cancelled` → solid warning bullet +
 *     "Compaction cancelled"
 *
 * Under premium ambient, enter/exit beats replace the blink-only header with a
 * short particle-rail theatre while preserving token-delta copy on complete.
 */

import { Container, Text, Spacer } from '#/tui/renderer';
import type { RendererRootUI } from '#/tui/renderer';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  EXIT_BEAT_MS,
  getActiveAppearancePreferences,
  renderEnterBeat,
  renderExitBeat,
  renderPremiumHeadline,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

const BLINK_INTERVAL = 500;

export class CompactionComponent extends Container {
  private readonly ui: RendererRootUI | undefined;
  private readonly headerText: Text;
  private readonly instruction: string | undefined;
  private readonly tip: string | undefined;
  private background: boolean;
  private done = false;
  private canceled = false;
  private tokensBefore: number | undefined;
  private tokensAfter: number | undefined;
  private detail: string | undefined;
  private readonly startedAtMs = appearanceAnimationNow();
  private doneAtMs: number | undefined;

  constructor(
    ui?: RendererRootUI,
    instruction?: string | undefined,
    tip?: string,
    options?: { readonly background?: boolean },
  ) {
    super();
    this.ui = ui;
    this.instruction = instruction;
    this.tip = tip;
    this.background = options?.background === true;

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
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);

    if (!this.done && !this.canceled && animated) {
      const title = this.background ? 'Compacting context (bg)' : 'Compacting context';
      const beat = renderEnterBeat(title, width, 'compaction', this.startedAtMs, appearance);
      const tip = this.tip ? currentTheme.fg('textDim', ` · Tip: ${this.tip}`) : '';
      const headed =
        tip.length > 0 && beat.length > 0
          ? [...beat.slice(0, -1), `${beat[beat.length - 1] ?? ''}${tip}`]
          : beat;
      return this.composeBeatRender(headed);
    }

    if (this.done && animated && this.doneAtMs !== undefined) {
      // Exit beat only — do not overlap crossfade on the same clock (that
      // briefly revived the old "Compacting context" label and muted the
      // token delta). After the beat, settle on buildHeader() below.
      const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
      const exitMs = mode === 'subtle' ? EXIT_BEAT_MS * 1.2 : EXIT_BEAT_MS;
      if (appearanceAnimationNow() - this.doneAtMs < exitMs) {
        return this.composeBeatRender(
          renderExitBeat(
            this.buildCompletePlain(),
            width,
            'compaction',
            this.doneAtMs,
            appearance,
          ),
        );
      }
    }

    // Recompute blink / settled header from the shared animation clock.
    // See PREMIUM.md §7.1 (single animation clock).
    this.headerText.setText(this.buildHeader());
    return super.render(width);
  }

  markDone(tokensBefore?: number, tokensAfter?: number, detail?: string): void {
    if (this.done || this.canceled) return;
    this.done = true;
    this.doneAtMs = appearanceAnimationNow();
    this.tokensBefore = tokensBefore;
    this.tokensAfter = tokensAfter;
    if (detail !== undefined && detail.length > 0) {
      this.detail = detail;
      this.addChild(new Text(currentTheme.dim(`  ${detail}`), 0, 0));
    }
    this.headerText.setText(this.buildHeader());
    this.ui?.requestRender();
  }

  markCanceled(): void {
    if (this.done || this.canceled) return;
    this.canceled = true;
    this.headerText.setText(this.buildHeader());
    this.ui?.requestRender();
  }

  promoteToBlocking(): void {
    if (this.done || this.canceled || !this.background) return;
    this.background = false;
    this.headerText.setText(this.buildHeader());
    this.ui?.requestRender();
  }

  dispose(): void {}

  private composeBeatRender(beatLines: readonly string[]): string[] {
    const lines: string[] = ['', ...beatLines];
    if (this.instruction !== undefined) {
      lines.push(currentTheme.dim(`  ${this.instruction}`));
    }
    if (this.detail !== undefined) {
      lines.push(currentTheme.dim(`  ${this.detail}`));
    }
    return lines;
  }

  private buildCompletePlain(): string {
    const detail =
      this.tokensBefore !== undefined && this.tokensAfter !== undefined
        ? ` (${String(this.tokensBefore)} → ${String(this.tokensAfter)} tokens)`
        : '';
    return `Compaction complete${detail}`;
  }

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
    const activeLabel = this.background
      ? 'Compacting in background...'
      : 'Compacting context...';
    const label = animated
      ? renderPremiumHeadline(
          activeLabel,
          this.background ? 'compaction:bg' : 'compaction:active',
          appearance,
        )
      : currentTheme.boldFg(this.background ? 'warning' : 'primary', activeLabel);
    const tip = this.tip ? currentTheme.fg('textDim', ` · Tip: ${this.tip}`) : '';
    return `${bullet}${label}${tip}`;
  }
}

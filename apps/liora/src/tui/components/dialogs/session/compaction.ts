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
 * While in flight, the progress line carries a bar shimmer, a shimmer-frame
 * activity marker, and a blinking preview cursor — all off the shared
 * animation clock, all gone once the block settles.
 */

import type { CompactionPhase } from '@superliora/sdk';

import { Container, Text, Spacer } from '#/tui/renderer';
import type { RendererRootUI } from '#/tui/renderer';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  enterBeatDurationMs,
  exitBeatDurationMs,
  getActiveAppearancePreferences,
  renderEnterBeat,
  renderExitBeat,
  renderPremiumHeadline,
  renderShimmerPrefix,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { ttui } from '#/tui/utils/tui-i18n';

const BLINK_INTERVAL = 500;

type CompactionUiPhase = 'preparing' | CompactionPhase;

interface PhaseProgress {
  readonly base: number;
  readonly label: string;
}

/**
 * Deterministic phase → progress mapping. Fractions are a presentation
 * concern kept client-side; the wire only carries the phase. `summarizing`
 * creeps asymptotically toward SUMMARY_CREEP_CEILING while the long LLM call
 * is in flight so the bar stays alive without ever claiming completion.
 */
function phaseProgress(phase: CompactionUiPhase): PhaseProgress {
  switch (phase) {
    case 'preparing':
      return { base: 0.12, label: ttui('tui.dialog.compaction.phase.preparing') };
    case 'summarizing':
      return { base: 0.3, label: ttui('tui.dialog.compaction.phase.summarizing') };
    case 'repairing':
      return { base: 0.78, label: ttui('tui.dialog.compaction.phase.repairing') };
    case 'finalizing':
      return { base: 0.92, label: ttui('tui.dialog.compaction.phase.finalizing') };
  }
}

const SUMMARY_CREEP_CEILING = 0.7;
const SUMMARY_CREEP_TAU_MS = 6000;
const SHIMMER_PERIOD_MS = 1400;
const BAR_MIN_WIDTH = 10;
const BAR_MAX_WIDTH = 24;
const BAR_FILL_CHAR = '█';
const BAR_PULSE_CHAR = '▓';
const BAR_EMPTY_CHAR = '░';
const SUMMARY_PREVIEW_LINES = 5;
const SUMMARY_PREVIEW_MAX_WIDTH = 96;
const SUMMARY_BUFFER_MAX_CHARS = 12_000;
/**
 * Reserved in-flight geometry cell. Must survive `Text` empty-line collapse
 * (`text.trim() === ''` → 0 rows). Braille blank is non-trimming and paints as
 * an empty-looking cell in typical terminals.
 */
const RESERVED_ROW = '\u2800';

type CompactionStreamMeta = {
  readonly streamKind?: 'summary' | 'block' | 'merge' | 'repair';
  readonly blockIndex?: number;
  readonly blockCount?: number;
  readonly blocksCompleted?: number;
  /** Engine-computed overall fraction in [0, 1); preferred over phase creep. */
  readonly fraction?: number;
};

export class CompactionComponent extends Container {
  private readonly ui: RendererRootUI | undefined;
  private readonly headerText: Text;
  private readonly instruction: string | undefined;
  private readonly tip: string | undefined;
  private readonly modelAlias: string | undefined;
  private background: boolean;
  private done = false;
  private canceled = false;
  private tokensBefore: number | undefined;
  private tokensAfter: number | undefined;
  private detail: string | undefined;
  private readonly startedAtMs = appearanceAnimationNow();
  private doneAtMs: number | undefined;
  private phase: CompactionUiPhase = 'preparing';
  private phaseEnteredAt = this.startedAtMs;
  private progressFloor = 0;
  private streamMeta: CompactionStreamMeta = {};
  private streamedChars = 0;
  private readonly progressText: Text;
  private summaryBuffer = '';
  private readonly summaryPreviewText: Text;

  constructor(
    ui?: RendererRootUI,
    instruction?: string | undefined,
    tip?: string,
    options?: { readonly background?: boolean; readonly modelAlias?: string },
  ) {
    super();
    this.ui = ui;
    this.instruction = instruction;
    this.tip = tip;
    this.modelAlias = options?.modelAlias;
    this.background = options?.background === true;

    // Top margin so the block isn't glued to the previous transcript
    // entry (status line, tool result, etc.).
    this.addChild(new Spacer(1));
    this.headerText = new Text(this.buildHeader(), 0, 0);
    this.addChild(this.headerText);
    // Phase-driven progress bar. While in-flight we always hold a single
    // reserved row so transcript geometry does not jump when the first
    // progress paint lands. Empty text renders zero lines once settled.
    this.progressText = new Text(this.reservedProgressPlaceholder(), 0, 0);
    this.addChild(this.progressText);
    // Live tail preview of the streamed summary. Reserve a fixed row budget
    // for the whole in-flight window so token deltas only repaint content
    // (no 0→N line thrash-resize of the transcript card).
    this.summaryPreviewText = new Text(this.reservedSummaryPreviewText(), 0, 0);
    this.addChild(this.summaryPreviewText);
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
    // Repaint the streamed summary preview with fresh theme colours.
    // In-flight always keeps the reserved row budget even when the buffer
    // is still empty (stable geometry for content-only invalidation).
    if (!this.done && !this.canceled) {
      this.summaryPreviewText.setText(this.buildSummaryPreviewLines().join('\n'));
    } else if (this.summaryBuffer.length > 0) {
      this.summaryPreviewText.setText(this.buildSummaryPreviewLines().join('\n'));
    }
    super.invalidate();
  }

  override render(width: number): string[] {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const now = appearanceAnimationNow();

    // Enter beat only for its TTL. Replaying the multi-line rail for the
    // entire compaction window thrash-resized the transcript (rail ↔ title)
    // and made live progress look frozen / flicker-heavy under premium.
    if (
      !this.done &&
      !this.canceled &&
      animated &&
      now - this.startedAtMs < enterBeatDurationMs(appearance)
    ) {
      const title = this.background
        ? ttui('tui.dialog.compaction.titleActiveBg')
        : ttui('tui.dialog.compaction.titleActive');
      // Pin to a single title line so geometry stays stable while the beat
      // paints (renderEnterBeat otherwise toggles 1↔2 lines).
      const beatHead = renderEnterBeat(title, width, 'compaction', this.startedAtMs, appearance);
      const titleLine = beatHead.at(-1) ?? currentTheme.boldFg('textStrong', title);
      const model =
        this.modelAlias !== undefined && this.modelAlias.length > 0
          ? currentTheme.fg('glow', ` · ${this.modelAlias}`)
          : '';
      const tip = this.tip ? currentTheme.fg('textDim', ` · Tip: ${this.tip}`) : '';
      return this.composeBeatRender([`${titleLine}${model}${tip}`], width);
    }

    if (this.done && animated && this.doneAtMs !== undefined) {
      // Exit beat only — do not overlap crossfade on the same clock (that
      // briefly revived the old "Compacting context" label and muted the
      // token delta). After the beat, settle on buildHeader() below.
      if (now - this.doneAtMs < exitBeatDurationMs(appearance)) {
        return this.composeBeatRender(
          renderExitBeat(
            this.buildCompletePlain(),
            width,
            'compaction',
            this.doneAtMs,
            appearance,
          ),
          width,
        );
      }
    }

    // Recompute blink / settled header from the shared animation clock.
    // See PREMIUM.md §7.1 (single animation clock).
    this.headerText.setText(this.buildHeader());
    this.progressText.setText(this.done || this.canceled ? '' : this.buildProgressLine(width));
    // Keep the reserved preview slot filled for the whole in-flight window
    // (not only when the buffer has content) so content ticks never change
    // transcript row count.
    if (!this.done && !this.canceled) {
      this.summaryPreviewText.setText(this.buildSummaryPreviewLines().join('\n'));
    }
    return super.render(width);
  }

  markDone(tokensBefore?: number, tokensAfter?: number, detail?: string): void {
    if (this.done || this.canceled) return;
    this.done = true;
    this.doneAtMs = appearanceAnimationNow();
    this.progressText.setText('');
    this.summaryBuffer = '';
    this.summaryPreviewText.setText('');
    this.tokensBefore = tokensBefore;
    this.tokensAfter = tokensAfter;
    if (detail !== undefined && detail.length > 0) {
      this.detail = detail;
      this.addChild(new Text(currentTheme.dim(`  ${detail}`), 0, 0));
    }
    this.headerText.setText(this.buildHeader());
    // Terminal geometry change (drop reserved progress/preview slots). Host
    // controller issues layout invalidate; this is a safety paint only.
    this.ui?.requestRender();
  }

  markCanceled(): void {
    if (this.done || this.canceled) return;
    this.canceled = true;
    this.progressText.setText('');
    this.summaryBuffer = '';
    this.summaryPreviewText.setText('');
    this.headerText.setText(this.buildHeader());
    this.ui?.requestRender();
  }

  promoteToBlocking(): void {
    if (this.done || this.canceled || !this.background) return;
    this.background = false;
    this.headerText.setText(this.buildHeader());
    this.ui?.requestRender();
  }

  /** Advance the phase-driven progress bar (wire `compaction.progress`). */
  setPhase(phase: CompactionPhase): void {
    if (this.done || this.canceled || this.phase === phase) return;
    this.phase = phase;
    this.phaseEnteredAt = appearanceAnimationNow();
    this.progressFloor = Math.max(this.progressFloor, phaseProgress(phase).base);
    // No requestRender here — progress ticks are high-frequency. The streaming
    // host scopes a content-only invalidate after applying phase/meta/delta.
  }

  /** Live stream source (summary / block N / merge / repair) for progress label. */
  setStreamMeta(meta: CompactionStreamMeta): void {
    if (this.done || this.canceled) return;
    const blockCount = meta.blockCount ?? this.streamMeta.blockCount;
    const incomingCompleted = meta.blocksCompleted ?? this.streamMeta.blocksCompleted;
    const previousCompleted = this.streamMeta.blocksCompleted;
    const next: CompactionStreamMeta = {
      streamKind: meta.streamKind ?? this.streamMeta.streamKind,
      blockIndex: meta.blockIndex ?? this.streamMeta.blockIndex,
      blockCount,
      // Within one round the completed count only moves forward; out-of-order
      // stream events must not rewind the "block n/N" label. A changed
      // blockCount starts a new round and resets the clamp.
      blocksCompleted:
        blockCount === this.streamMeta.blockCount &&
        previousCompleted !== undefined &&
        incomingCompleted !== undefined
          ? Math.max(incomingCompleted, previousCompleted)
          : incomingCompleted,
      fraction: meta.fraction ?? this.streamMeta.fraction,
    };
    // Engine fraction is monotonic within a session — never rewind the floor.
    if (next.fraction !== undefined && Number.isFinite(next.fraction)) {
      this.progressFloor = Math.max(this.progressFloor, Math.min(0.99, next.fraction));
    } else if (
      next.blocksCompleted !== undefined &&
      next.blockCount !== undefined &&
      next.blockCount > 0
    ) {
      // Block completion alone: map into the summarizing band (0.30 → 0.70).
      const blockFrac =
        phaseProgress('summarizing').base +
        (SUMMARY_CREEP_CEILING - phaseProgress('summarizing').base) *
          Math.min(1, Math.max(0, next.blocksCompleted / next.blockCount));
      this.progressFloor = Math.max(this.progressFloor, blockFrac);
    }
    if (
      next.streamKind === this.streamMeta.streamKind &&
      next.blockIndex === this.streamMeta.blockIndex &&
      next.blockCount === this.streamMeta.blockCount &&
      next.blocksCompleted === this.streamMeta.blocksCompleted &&
      next.fraction === this.streamMeta.fraction
    ) {
      return;
    }
    this.streamMeta = next;
    // Host scopes content invalidate after the whole progress tick.
  }

  /** Append streamed summarizer output and show a dimmed tail preview. */
  appendSummaryDelta(delta: string): void {
    if (this.done || this.canceled || delta.length === 0) return;
    this.summaryBuffer += delta;
    this.streamedChars += delta.length;
    if (this.summaryBuffer.length > SUMMARY_BUFFER_MAX_CHARS) {
      this.summaryBuffer = this.summaryBuffer.slice(-SUMMARY_BUFFER_MAX_CHARS);
    }
    // Update the reserved preview slot only. Height is fixed for the in-flight
    // window; host issues a content-only frame (not layout/transcript rebuild).
    this.summaryPreviewText.setText(this.buildSummaryPreviewLines().join('\n'));
  }

  dispose(): void {}

  private composeBeatRender(beatLines: readonly string[], width: number): string[] {
    const lines: string[] = ['', ...beatLines];
    if (!this.done && !this.canceled) {
      // Match the reserved in-flight geometry of the container path so the
      // enter/exit beat does not thrash-resize vs the live progress card.
      lines.push(this.buildProgressLine(width));
      lines.push(...this.buildSummaryPreviewLines());
    }
    if (this.instruction !== undefined) {
      lines.push(currentTheme.dim(`  ${this.instruction}`));
    }
    if (this.detail !== undefined) {
      lines.push(currentTheme.dim(`  ${this.detail}`));
    }
    return lines;
  }

  /** One non-empty row so Text measures height 1 before the first paint. */
  private reservedProgressPlaceholder(): string {
    return `  ${RESERVED_ROW}`;
  }

  /** Fixed SUMMARY_PREVIEW_LINES rows of non-empty placeholders. */
  private reservedSummaryPreviewText(): string {
    return Array.from({ length: SUMMARY_PREVIEW_LINES }, () => `  ${RESERVED_ROW}`).join(
      '\n',
    );
  }

  private currentFraction(now: number, animated: boolean): number {
    // Prefer engine-reported fraction (block % / merge / repair) when present.
    const engine = this.streamMeta.fraction;
    if (engine !== undefined && Number.isFinite(engine)) {
      return Math.min(0.99, Math.max(engine, this.progressFloor));
    }
    // Block completion without explicit fraction still drives the bar.
    const completed = this.streamMeta.blocksCompleted;
    const count = this.streamMeta.blockCount;
    if (
      this.phase === 'summarizing' &&
      completed !== undefined &&
      count !== undefined &&
      count > 0
    ) {
      const blockFrac =
        phaseProgress('summarizing').base +
        (SUMMARY_CREEP_CEILING - phaseProgress('summarizing').base) *
          Math.min(1, Math.max(0, completed / count));
      return Math.min(0.99, Math.max(blockFrac, this.progressFloor));
    }
    const cfg = phaseProgress(this.phase);
    let fraction = cfg.base;
    if (animated && this.phase === 'summarizing') {
      const elapsed = Math.max(0, now - this.phaseEnteredAt);
      const creep = 1 - Math.exp(-elapsed / SUMMARY_CREEP_TAU_MS);
      fraction = cfg.base + (SUMMARY_CREEP_CEILING - cfg.base) * creep;
    }
    // Never rewind within a session (multi-round compaction re-emits phases).
    return Math.min(0.99, Math.max(fraction, this.progressFloor));
  }

  private streamStatusSuffix(): string {
    const kind = this.streamMeta.streamKind;
    if (kind === undefined) {
      return this.streamedChars > 0 ? ` · ${String(this.streamedChars)} chars` : '';
    }
    let label: string;
    switch (kind) {
      case 'block': {
        const completed = this.streamMeta.blocksCompleted;
        const index = this.streamMeta.blockIndex;
        const count = this.streamMeta.blockCount;
        if (completed !== undefined && count !== undefined) {
          // Prefer completed/total — more accurate than "currently streaming" index.
          label = `block ${String(completed)}/${String(count)}`;
        } else if (index !== undefined && count !== undefined) {
          label = `block ${String(index)}/${String(count)}`;
        } else {
          label = 'blocks';
        }
        break;
      }
      case 'merge':
        label = 'merging blocks';
        break;
      case 'repair':
        label = 'repairing summary';
        break;
      default:
        label = 'streaming summary';
        break;
    }
    const chars =
      this.streamedChars > 0 ? ` · ${String(this.streamedChars)} chars` : '';
    return ` · ${label}${chars}`;
  }

  private buildProgressLine(width: number): string {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    const now = appearanceAnimationNow();
    const fraction = this.currentFraction(now, animated);
    const { label } = phaseProgress(this.phase);
    const status = `${label}${this.streamStatusSuffix()}`;
    const barWidth = Math.max(BAR_MIN_WIDTH, Math.min(BAR_MAX_WIDTH, width - 18));
    const filled = Math.min(barWidth, Math.round(fraction * barWidth));
    const shimmerIndex = animated
      ? Math.floor(((now % SHIMMER_PERIOD_MS) / SHIMMER_PERIOD_MS) * (barWidth + 2)) - 1
      : -1;
    let bar = '';
    for (let i = 0; i < barWidth; i += 1) {
      if (i < filled) {
        bar += currentTheme.fg(i === shimmerIndex ? 'primary' : 'accent', BAR_FILL_CHAR);
      } else if (i === shimmerIndex) {
        bar += currentTheme.fg('textDim', BAR_PULSE_CHAR);
      } else {
        bar += currentTheme.fg('textMuted', BAR_EMPTY_CHAR);
      }
    }
    const pct = currentTheme.fg('textDim', `${String(Math.round(fraction * 100)).padStart(3)}%`);
    // Clock-driven activity marker in front of the phase label: the shared
    // shimmer frames keep the in-flight surface visibly alive and disappear
    // with the whole line once compaction settles (PREMIUM.md §7.1). Empty
    // string when ambient motion is off, so static renders stay byte-stable.
    const marker = animated ? renderShimmerPrefix(appearance) : '';
    return `  ${bar} ${pct} ${marker}${currentTheme.fg('textMuted', status)}`;
  }

  private buildSummaryPreviewLines(): string[] {
    const content = this.summaryBuffer
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0)
      .slice(-SUMMARY_PREVIEW_LINES)
      .map((line) => {
        const clipped =
          line.length > SUMMARY_PREVIEW_MAX_WIDTH
            ? `${line.slice(0, SUMMARY_PREVIEW_MAX_WIDTH - 1)}…`
            : line;
        return currentTheme.dim(`  ${clipped}`);
      });
    // While in-flight always emit a fixed row budget. Empty slots use a
    // non-empty spacer so Text measures the same height as filled slots
    // (empty Text renders zero lines and thrash-resizes the transcript).
    if (this.done || this.canceled) {
      return content;
    }
    const lines = content.slice();
    while (lines.length < SUMMARY_PREVIEW_LINES) {
      // Non-trimming spacer — plain spaces collapse to 0 Text rows.
      lines.push(`  ${RESERVED_ROW}`);
    }
    // Live cursor on the last real content line while summarizing / repairing.
    // Under ambient motion the cursor blinks on the shared animation clock
    // (same cadence as the header bullet); with motion off it stays solidly
    // on so quality-gated renders remain byte-stable. Profile off → no motion
    // extras (cursor stays solid, no shimmer elsewhere).
    if (
      content.length > 0 &&
      (this.phase === 'summarizing' || this.phase === 'repairing')
    ) {
      const blinkOn = shouldRenderAmbientEffects(getActiveAppearancePreferences())
        ? Math.floor(appearanceAnimationNow() / BLINK_INTERVAL) % 2 === 0
        : true;
      if (blinkOn) {
        const cursorAt = content.length - 1;
        const last = lines[cursorAt] ?? '';
        lines[cursorAt] = `${last}${currentTheme.fg('accent', '▌')}`;
      }
    }
    return lines;
  }

  private buildCompletePlain(): string {
    const detail =
      this.tokensBefore !== undefined && this.tokensAfter !== undefined
        ? ` (${String(this.tokensBefore)} → ${String(this.tokensAfter)} tokens)`
        : '';
    return `${ttui('tui.dialog.compaction.complete')}${detail}`;
  }

  private buildHeader(): string {
    const appearance = getActiveAppearancePreferences();
    const animated = shouldRenderAmbientEffects(appearance);
    if (this.done) {
      const bullet = currentTheme.fg('success', STATUS_BULLET);
      const label = animated
        ? renderPremiumHeadline(ttui('tui.dialog.compaction.complete'), 'compaction:done', appearance)
        : currentTheme.boldFg('success', ttui('tui.dialog.compaction.complete'));
      const detail =
        this.tokensBefore !== undefined && this.tokensAfter !== undefined
          ? currentTheme.dim(` (${String(this.tokensBefore)} → ${String(this.tokensAfter)} tokens)`)
          : '';
      return `${bullet}${label}${detail}`;
    }
    if (this.canceled) {
      const bullet = currentTheme.fg('warning', STATUS_BULLET);
      const label = animated
        ? renderPremiumHeadline(ttui('tui.dialog.compaction.cancelled'), 'compaction:cancel', appearance)
        : currentTheme.boldFg('warning', ttui('tui.dialog.compaction.cancelled'));
      return `${bullet}${label}`;
    }
    // Derive the blink phase from the animation clock — no private timer.
    const blinkOn = Math.floor(appearanceAnimationNow() / BLINK_INTERVAL) % 2 === 0;
    const bullet = blinkOn ? currentTheme.fg('text', STATUS_BULLET) : '  ';
    const activeLabel = this.background
      ? ttui('tui.dialog.compaction.titleProgressBg')
      : ttui('tui.dialog.compaction.titleProgress');
    const label = animated
      ? renderPremiumHeadline(
          activeLabel,
          this.background ? 'compaction:bg' : 'compaction:active',
          appearance,
        )
      : currentTheme.boldFg(this.background ? 'warning' : 'primary', activeLabel);
    const model =
      this.modelAlias !== undefined && this.modelAlias.length > 0
        ? currentTheme.fg('glow', ` · ${this.modelAlias}`)
        : '';
    const tip = this.tip ? currentTheme.fg('textDim', ` · Tip: ${this.tip}`) : '';
    return `${bullet}${label}${model}${tip}`;
  }
}

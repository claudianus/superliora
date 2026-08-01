import {
  Text,
  truncateAnsiDisplayText,
  type RendererComponent,
} from '../text/component';
import type {
  RendererTruncatedOutputFormatContext,
  RendererTruncatedOutputOptions,
} from './types';
import { trimRendererTrailingEmptyLines } from './line-block';
import { projectRendererLinePreview } from './line-projection';
import { isTranscriptMeasureMode, shouldSkipExpensiveTranscriptFormat } from './measure-mode';
import { normalizeTranscriptWidth } from './normalize';

export const DEFAULT_RENDERER_TRUNCATED_OUTPUT_LINES = 3;
export const DEFAULT_RENDERER_TRUNCATED_OUTPUT_INDENT = 2;

/**
 * Hard ceiling on raw source lines held/formatted by a single truncated
 * output block. Nested tool viewports still window further; this stops a
 * multi-megabyte tool result from blocking the main thread on expand/mount.
 */
export const RENDERER_TRUNCATED_OUTPUT_HARD_CAP_LINES = 800;

/**
 * Even when "expanded", never materialize more than this many *visual* rows
 * from one TruncatedOutput.render() call. The transcript nested viewport
 * windows further; this is a last-line defence against paint storms.
 */
export const RENDERER_TRUNCATED_OUTPUT_EXPANDED_VISUAL_CAP = 600;

/**
 * Default char threshold for deferred formatting when a host provides
 * {@link RendererTruncatedOutputOptions.onDeferredFormat}. Below this,
 * format stays sync for snappy small outputs.
 */
export const RENDERER_TRUNCATED_OUTPUT_DEFER_CHARS = 1_500;

export class RendererTruncatedOutputComponent implements RendererComponent {
  private readonly textComponent: Text;
  private output: string;
  private readonly expanded: boolean;
  private readonly isError: boolean;
  private readonly maxLines: number;
  private readonly indent: number;
  private readonly expandHint: boolean;
  private readonly tail: boolean;
  private readonly truncateMark: string;
  private readonly hintMode: 'key' | 'scroll';
  private readonly formatText: (
    text: string,
    context: RendererTruncatedOutputFormatContext,
  ) => string;
  private readonly formatHint: (hint: string) => string;
  private readonly deferFormatAboveChars: number | undefined;
  private readonly onDeferredFormat: ((apply: () => void) => void) | undefined;
  private readonly onFormatApplied: (() => void) | undefined;
  private readonly formatPendingHint: (() => string | undefined) | undefined;
  /** Source lines dropped by the hard cap (shown in the footer when > 0). */
  private hardCapHidden = 0;
  /**
   * Lazy format: avoid highlight/pretty-print on construction (mount storms)
   * and during geometry measure (virtual-scroll line counts).
   */
  private formattedReady = false;
  private formattedText = '';
  /** Plain body laid out for measure / deferred-first paint. */
  private plainLaidOut = false;
  private deferredScheduled = false;
  private formatPending = false;
  /** Bumps when body text or format state changes (parent cache bust). */
  private contentRevision = 0;

  constructor(output: string, options: RendererTruncatedOutputOptions) {
    const capped = capRawOutputLines(output, RENDERER_TRUNCATED_OUTPUT_HARD_CAP_LINES);
    this.output = capped.text;
    this.hardCapHidden = capped.hidden;
    this.expanded = options.expanded;
    this.isError = options.isError ?? false;
    this.maxLines = options.maxLines ?? DEFAULT_RENDERER_TRUNCATED_OUTPUT_LINES;
    this.indent = options.indent ?? DEFAULT_RENDERER_TRUNCATED_OUTPUT_INDENT;
    this.expandHint = options.expandHint ?? true;
    this.tail = options.tail ?? false;
    this.truncateMark = options.truncateMark ?? '…';
    this.hintMode = options.hintMode ?? 'key';
    this.formatText = options.formatText ?? ((text) => text);
    this.formatHint = options.formatHint ?? ((hint) => hint);
    this.deferFormatAboveChars = options.deferFormatAboveChars;
    this.onDeferredFormat = options.onDeferredFormat;
    this.onFormatApplied = options.onFormatApplied;
    this.formatPendingHint = options.formatPendingHint;
    // Empty until first paint — construction must stay O(cap scan), not highlight.
    this.textComponent = new Text('', this.indent, 0);
  }

  /** True while deferred highlight/pretty-print has not finished. */
  get isFormatPending(): boolean {
    return this.formatPending;
  }

  /** Monotonic body revision for parent paint caches. */
  getContentRevision(): number {
    return this.contentRevision;
  }

  invalidate(): void {
    this.formattedReady = false;
    this.formattedText = '';
    this.plainLaidOut = false;
    this.deferredScheduled = false;
    this.formatPending = false;
    this.contentRevision += 1;
    this.textComponent.invalidate();
  }

  /**
   * Replace body text in place (live tool stdout). Avoids remounting the
   * component tree on every stream chunk.
   */
  setOutput(output: string): void {
    const capped = capRawOutputLines(output, RENDERER_TRUNCATED_OUTPUT_HARD_CAP_LINES);
    this.output = capped.text;
    this.hardCapHidden = capped.hidden;
    this.invalidate();
  }

  render(width: number): string[] {
    this.ensureBodyReady();
    const contentLines = this.textComponent.render(width);
    // Expanded still applies a visual soft-cap so one tool cannot materialize
    // tens of thousands of ANSI rows into the parent paint/geometry path.
    const effectiveExpanded =
      this.expanded && contentLines.length <= RENDERER_TRUNCATED_OUTPUT_EXPANDED_VISUAL_CAP;
    const preview = projectRendererLinePreview({
      lines: contentLines,
      expanded: effectiveExpanded,
      maxLines: this.expanded
        ? RENDERER_TRUNCATED_OUTPUT_EXPANDED_VISUAL_CAP
        : this.maxLines,
      tail: this.tail,
    });

    const hiddenFromPreview = preview.hiddenLineCount;
    const hiddenTotal = hiddenFromPreview + this.hardCapHidden;
    // Do not add a pending-only footer row when nothing is truncated — that
    // would change geometry vs measure-mode plain layout (1-line jump).
    if (hiddenTotal <= 0) {
      return [...preview.lines];
    }

    const pendingHint = this.formatPending ? this.formatPendingHint?.() : undefined;
    const baseHint = this.tail
      ? `... (${String(hiddenTotal)} earlier lines)`
      : !this.expandHint
        ? `... (${String(hiddenTotal)} more lines)`
        : this.hintMode === 'scroll'
          ? `⋯ ${String(hiddenTotal)} more lines — scroll for more`
          : `... (${String(hiddenTotal)} more lines, ctrl+o to expand)`;
    // Prefer a combined footer so deferred format does not drop the overflow count.
    // Keep the words "more lines" so existing scroll/overflow tests and UX match.
    const hint = pendingHint !== undefined
      ? `${pendingHint} · ${String(hiddenTotal)} more lines`
      : baseHint;
    const hintLine = this.renderHint(width, hint);
    return preview.hintPosition === 'before'
      ? [hintLine, ...preview.lines]
      : [...preview.lines, hintLine];
  }

  /**
   * Lay out body for geometry or paint without necessarily running the
   * expensive formatText highlighter.
   *
   * - Measure mode: always plain (virtual-scroll line counts must not pay
   *   highlight/pretty-print for every off-screen tool).
   * - Paint, small body: format sync.
   * - Paint, large body + host queue: plain first, format deferred.
   */
  private ensureBodyReady(): void {
    if (this.formattedReady) return;

    // Geometry probes: never pay for highlight/pretty-print.
    if (isTranscriptMeasureMode()) {
      this.ensurePlainLaidOut();
      return;
    }

    // Pure-scroll / measure cheap paint: plain only. Do NOT enqueue deferred
    // highlight here — a wheel storm intersecting dozens of cold tool cards
    // used to schedule that many format jobs, and each completion wiped the
    // whole transcript geometry cache (see host onFormatApplied). Stay plain
    // until a real ambient/content paint schedules format once.
    if (shouldSkipExpensiveTranscriptFormat()) {
      this.ensurePlainLaidOut();
      return;
    }

    if (this.shouldDeferFormat()) {
      this.ensurePlainLaidOut();
      if (!this.deferredScheduled && this.onDeferredFormat !== undefined) {
        this.deferredScheduled = true;
        this.formatPending = true;
        this.onDeferredFormat(() => {
          // Drop work if a newer setOutput/invalidate already reset us.
          if (this.formattedReady || !this.deferredScheduled) return;
          this.applyFormat();
          // Host busts parent paint caches + requests a content frame.
          this.onFormatApplied?.();
        });
      }
      return;
    }

    // Small bodies on ambient/content paint: format sync for snappy UX.
    this.applyFormat();
  }

  private shouldDeferFormat(): boolean {
    if (this.onDeferredFormat === undefined) return false;
    const threshold = this.deferFormatAboveChars ?? RENDERER_TRUNCATED_OUTPUT_DEFER_CHARS;
    return this.output.length > threshold;
  }

  private ensurePlainLaidOut(): void {
    if (this.plainLaidOut || this.formattedReady) return;
    this.textComponent.setText(this.output);
    this.plainLaidOut = true;
  }

  private applyFormat(): void {
    this.formattedText = this.formatText(this.output, { isError: this.isError });
    this.formattedReady = true;
    this.formatPending = false;
    this.plainLaidOut = true;
    this.contentRevision += 1;
    this.textComponent.setText(this.formattedText);
  }

  private renderHint(width: number, hint: string): string {
    const safeWidth = normalizeTranscriptWidth(width);
    const indentWidth = Math.min(this.indent, safeWidth);
    const hintWidth = Math.max(0, safeWidth - indentWidth);
    const formatted = this.formatHint(hint);
    return ' '.repeat(indentWidth) +
      truncateAnsiDisplayText(formatted, hintWidth, this.truncateMark);
  }
}

/** Trim trailing empties, then hard-cap source lines (head keep for stability). */
export function capRawOutputLines(
  output: string,
  maxLines: number,
): { readonly text: string; readonly hidden: number } {
  const trimmed = trimRendererTrailingEmptyLines(output.split('\n'));
  if (trimmed.length <= maxLines) {
    return { text: trimmed.join('\n'), hidden: 0 };
  }
  return {
    text: trimmed.slice(0, maxLines).join('\n'),
    hidden: trimmed.length - maxLines,
  };
}

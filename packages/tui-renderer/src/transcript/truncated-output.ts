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
  /** Source lines dropped by the hard cap (shown in the footer when > 0). */
  private hardCapHidden = 0;
  /** Lazy format: avoid highlight/pretty-print on construction (mount storms). */
  private formattedReady = false;
  private formattedText = '';

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
    // Empty until first paint — construction must stay O(cap scan), not highlight.
    this.textComponent = new Text('', this.indent, 0);
  }

  invalidate(): void {
    this.formattedReady = false;
    this.formattedText = '';
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
    this.ensureFormatted();
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
    if (hiddenTotal <= 0) return [...preview.lines];

    const hint = this.tail
      ? `... (${String(hiddenTotal)} earlier lines)`
      : !this.expandHint
        ? `... (${String(hiddenTotal)} more lines)`
        : this.hintMode === 'scroll'
          ? `⋯ ${String(hiddenTotal)} more lines — scroll for more`
          : `... (${String(hiddenTotal)} more lines, ctrl+o to expand)`;
    const hintLine = this.renderHint(width, hint);
    return preview.hintPosition === 'before'
      ? [hintLine, ...preview.lines]
      : [...preview.lines, hintLine];
  }

  private ensureFormatted(): void {
    if (this.formattedReady) return;
    this.formattedText = this.formatText(this.output, { isError: this.isError });
    this.formattedReady = true;
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

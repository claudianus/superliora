import {
  Text,
  truncateAnsiDisplayText,
  type RendererComponent,
} from './text-component';
import type {
  RendererTruncatedOutputFormatContext,
  RendererTruncatedOutputOptions,
} from './transcript-types';
import { trimRendererTrailingEmptyLines } from './transcript-line-block';
import { projectRendererLinePreview } from './transcript-line-projection';
import { normalizeTranscriptWidth } from './transcript-normalize';

export const DEFAULT_RENDERER_TRUNCATED_OUTPUT_LINES = 3;
export const DEFAULT_RENDERER_TRUNCATED_OUTPUT_INDENT = 2;

export class RendererTruncatedOutputComponent implements RendererComponent {
  private readonly textComponent: Text;
  private readonly output: string;
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

  constructor(output: string, options: RendererTruncatedOutputOptions) {
    this.output = trimRendererTrailingEmptyLines(output.split('\n')).join('\n');
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
    this.textComponent = new Text(this.renderOutputText(), this.indent, 0);
  }

  invalidate(): void {
    this.textComponent.setText(this.renderOutputText());
    this.textComponent.invalidate();
  }

  render(width: number): string[] {
    const contentLines = this.textComponent.render(width);
    const preview = projectRendererLinePreview({
      lines: contentLines,
      expanded: this.expanded,
      maxLines: this.maxLines,
      tail: this.tail,
    });

    if (preview.hiddenLineCount <= 0) return [...preview.lines];

    const hint = this.tail
      ? `... (${String(preview.hiddenLineCount)} earlier lines)`
      : !this.expandHint
        ? `... (${String(preview.hiddenLineCount)} more lines)`
        : this.hintMode === 'scroll'
          ? `⋯ ${String(preview.hiddenLineCount)} more lines — scroll to expand`
          : `... (${String(preview.hiddenLineCount)} more lines, ctrl+o to expand)`;
    const hintLine = this.renderHint(width, hint);
    return preview.hintPosition === 'before'
      ? [hintLine, ...preview.lines]
      : [...preview.lines, hintLine];
  }

  private renderOutputText(): string {
    return this.formatText(this.output, { isError: this.isError });
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

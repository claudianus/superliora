import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
} from '#/tui/features/appearance/appearance-effects';
import {
  isTranscriptEntranceActive,
  polishTranscriptLines,
} from '#/tui/features/transcript/transcript-entrance';
import type { Component } from '#/tui/renderer';
import { Container, Text, projectRendererLineWindow } from '#/tui/renderer';

import { formatShellCommandPreview } from '#/tui/components/media/code-highlight';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import type { ResultRenderer } from '../tool-renderers/types';
import { PREVIEW_LINES } from '../tool-renderers/types';
import { TruncatedOutputComponent } from '../tool-renderers/truncated';

export interface ShellExecutionOptions {
  readonly command?: string;
  readonly result?: ToolResultBlockData;
  readonly expanded?: boolean;
  readonly showCommand?: boolean;
  /**
   * Max command lines to render. `undefined` means no cap — used by the
   * ctrl+o expanded view so the user can see the full multi-line command
   * even when the header preview was truncated.
   */
  readonly commandPreviewLines?: number;
  readonly resultPreviewLines?: number;
  readonly tailOutput?: boolean;
  readonly expandHint?: boolean;
}

export class ShellExecutionComponent extends Container {
  private readonly entranceStartedAtMs = appearanceAnimationNow();
  /** Command-preview Text nodes, kept so streaming deltas can reuse them. */
  private readonly commandPreviewTexts: Text[] = [];
  constructor(options: ShellExecutionOptions) {
    super();

    if (options.showCommand === true) {
      this.addCommandPreview(options.command ?? '', options.commandPreviewLines);
    }

    if (options.result !== undefined) {
      this.addResultPreview(
        options.result,
        options.expanded ?? false,
        options.resultPreviewLines ?? PREVIEW_LINES,
        options.tailOutput ?? false,
        options.expandHint ?? true,
      );
    }
  }

  private addCommandPreview(command: string, previewLines: number | undefined): void {
    if (command.length === 0) return;
    // Highlight binary / flags / strings / redirects; dim only the `$ ` prompt.
    const highlighted = formatShellCommandPreview(command);
    const lines = projectRendererLineWindow({
      lines: highlighted,
      maxLines: previewLines,
    }).lines;
    for (const line of lines) {
      const text = new Text(line, 2, 0);
      this.commandPreviewTexts.push(text);
      this.addChild(text);
    }
  }

  /**
   * Update the command preview in place while arguments stream in. Reusing
   * the existing Text nodes (instead of rebuilding the component per delta)
   * keeps the entrance clock and render cache stable — that churn was the
   * visible flicker during Bash command streaming.
   */
  setCommand(command: string, previewLines: number | undefined): void {
    if (command.length === 0) return;
    const highlighted = formatShellCommandPreview(command);
    const lines = projectRendererLineWindow({
      lines: highlighted,
      maxLines: previewLines,
    }).lines;
    for (const [i, line] of lines.entries()) {
      const existing = this.commandPreviewTexts[i];
      if (existing !== undefined) {
        existing.setText(line);
      } else {
        const text = new Text(line, 2, 0);
        this.commandPreviewTexts.push(text);
        this.addChild(text);
      }
    }
    // Drop surplus nodes left over from a previously longer command.
    while (this.commandPreviewTexts.length > lines.length) {
      const surplus = this.commandPreviewTexts.pop();
      if (surplus === undefined) break;
      const idx = this.children.indexOf(surplus);
      if (idx >= 0) this.children.splice(idx, 1);
    }
    this.invalidate();
  }

  private addResultPreview(
    result: ToolResultBlockData,
    expanded: boolean,
    previewLines: number,
    tailOutput: boolean,
    expandHint: boolean,
  ): void {
    if (!result.output) return;
    this.addChild(
      new TruncatedOutputComponent(result.output, {
        expanded,
        isError: result.is_error ?? false,
        maxLines: previewLines,
        tail: tailOutput,
        expandHint,
      }),
    );
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (!isTranscriptEntranceActive(this.entranceStartedAtMs)) return lines;
    return polishTranscriptLines(lines, {
      startedAtMs: this.entranceStartedAtMs,
      kind: 'status',
      streaming: true,
      appearance: getActiveAppearancePreferences(),
    });
  }
}

export const shellExecutionResultRenderer: ResultRenderer = (
  toolCall: ToolCallBlockData,
  result: ToolResultBlockData,
  ctx,
): Component[] => [
  new ShellExecutionComponent({
    command: typeof toolCall.args['command'] === 'string' ? toolCall.args['command'] : '',
    result,
    expanded: ctx.expanded,
    // Header truncates long bash commands to 60 chars. When the user expands
    // the card with ctrl+o, reveal the full command (no line cap) so they
    // can read what actually ran.
    showCommand: ctx.showCommand ?? ctx.expanded,
    commandPreviewLines: undefined,
  }),
];


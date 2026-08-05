import {
  RENDERER_TRUNCATED_OUTPUT_DEFER_CHARS,
  RendererTruncatedOutputComponent,
  trimRendererTrailingEmptyLines,
  type Component,
} from '#/tui/renderer';

import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
} from '#/tui/constant/rendering';
import { getActiveNeatMode } from '#/tui/features/transcript/transcript-density';
import { currentTheme } from '#/tui/theme';
import type { ToolResultBlockData } from '#/tui/types';
import { scheduleDeferredTranscriptFormat } from '#/tui/utils/transcript/deferred-format-queue';
import { formatTranscriptOutput } from '#/tui/utils/transcript/transcript-output-format';

import { renderNeatCard } from './neat-card';
import type { ResultRenderer } from './types';
import { PREVIEW_LINES } from './types';

const DEFAULT_INDENT = 2;

/**
 * Optional host hook: after a deferred body format finishes, bust nested
 * viewport paint caches and request a content frame. Set once from TUI
 * bootstrap (or tests); components never import LioraTUI directly.
 */
let onDeferredFormatApplied: (() => void) | undefined;

export function setTruncatedOutputFormatAppliedHandler(
  handler: (() => void) | undefined,
): void {
  onDeferredFormatApplied = handler;
}

export const trimTrailingEmptyLines = trimRendererTrailingEmptyLines;

/**
 * Component that renders tool output with wrap-aware line truncation.
 * Uses the renderer Text component to compute actual visual wrapped lines,
 * then caps at PREVIEW_LINES. This handles long single-line output (e.g.
 * JSON blobs) that would otherwise wrap to dozens of visual rows.
 *
 * Body text is pretty-printed + lightly highlighted via
 * {@link formatTranscriptOutput} (JSON, JSONL, diff, stack, logs, URLs…).
 *
 * Large bodies defer that work: geometry/paint first show plain text (and a
 * small loading footer), then a budgeted queue applies highlighting so fast
 * transcript scroll never formats dozens of tools in one frame.
 */
export class TruncatedOutputComponent extends RendererTruncatedOutputComponent {
  constructor(
    output: string,
    options: {
      expanded: boolean;
      isError: boolean | undefined;
      maxLines?: number;
      indent?: number;
      // When false, the truncation footer omits the "ctrl+o to expand" promise
      // (for contexts whose output is fixed-truncated and never expands).
      expandHint?: boolean;
      // When true, collapsed rendering keeps the latest visual rows instead of
      // the first rows. This is useful for live output from a running command.
      tail?: boolean;
      // Footer wording. Defaults to 'scroll': every app usage lives inside the
      // transcript viewport, where scrolling back auto-expands truncated blocks
      // (scroll reveal), so the hint promises the gesture that actually works
      // there. 'key' restores the legacy ctrl+o wording.
      hintMode?: 'key' | 'scroll';
      /** Prefer this language when the body looks like a code dump. */
      languageHint?: string;
      /** File path used to derive a language when languageHint is absent. */
      pathHint?: string;
      /**
       * Force sync format even for large bodies (tests / export). Default
       * defers above {@link RENDERER_TRUNCATED_OUTPUT_DEFER_CHARS}.
       */
      deferFormat?: boolean;
    },
  ) {
    const defer = options.deferFormat !== false;
    super(output, {
      expanded: options.expanded,
      isError: options.isError,
      maxLines: options.maxLines ?? PREVIEW_LINES,
      indent: options.indent ?? DEFAULT_INDENT,
      expandHint: options.expandHint,
      tail: options.tail,
      hintMode: options.hintMode ?? 'scroll',
      formatText: (text, context) =>
        formatTranscriptOutput(text, {
          isError: context.isError,
          languageHint: options.languageHint,
          pathHint: options.pathHint,
          mode: 'tool',
        }),
      formatHint: (hint) => currentTheme.dim(hint),
      deferFormatAboveChars: defer ? RENDERER_TRUNCATED_OUTPUT_DEFER_CHARS : Number.POSITIVE_INFINITY,
      onDeferredFormat: defer
        ? (apply) => {
            scheduleDeferredTranscriptFormat(apply);
          }
        : undefined,
      onFormatApplied: defer
        ? () => {
            onDeferredFormatApplied?.();
          }
        : undefined,
      formatPendingHint: defer
        ? () => {
            const frame =
              BRAILLE_SPINNER_FRAMES[
                Math.floor(Date.now() / BRAILLE_SPINNER_INTERVAL_MS) %
                  BRAILLE_SPINNER_FRAMES.length
              ] ?? '⠋';
            // Combined with overflow count by TruncatedOutput ("· N more").
            return `${frame} formatting`;
          }
        : undefined,
    });
  }
}

export const renderTruncated: ResultRenderer = (toolCall, result, ctx) => {
  // Neat mode intercepts here rather than in the registry: this is the single
  // funnel every raw body passes through (Bash, MCP, unknown builtins, and the
  // error fallback of every dedicated renderer), so one check covers them all.
  const card = neatCardFor(result);
  if (card !== undefined && !ctx.expanded) return card;
  if (!result.output) return card ?? [];
  // Best-effort path hint for generic tools (MCP, unknown builtins).
  const pathHint =
    typeof toolCall.args['path'] === 'string'
      ? toolCall.args['path']
      : typeof toolCall.args['file_path'] === 'string'
        ? toolCall.args['file_path']
        : typeof toolCall.args['filePath'] === 'string'
          ? toolCall.args['filePath']
          : undefined;
  const body = new TruncatedOutputComponent(result.output, {
    expanded: ctx.expanded,
    isError: result.is_error ?? false,
    hintMode: 'key',
    pathHint,
  });
  // Expanded (density `full`) keeps the card as a headline above the raw body,
  // so structure and full text are never mutually exclusive.
  return card === undefined ? [body] : [...card, body];
};

function neatCardFor(result: ToolResultBlockData): Component[] | undefined {
  if (!getActiveNeatMode() || result.display === undefined) return undefined;
  return renderNeatCard(result.display, { seed: result.tool_call_id });
}

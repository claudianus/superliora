/**
 * Pure call-preview builders for ToolCallComponent: the settled (post-args)
 * Write/Edit preview blocks, their streaming (mid-args) counterparts, and
 * ExitPlanMode plan/path/status resolution. No component instance state —
 * callers pass in exactly the fields each builder reads and own `addChild`
 * ordering (including the staged-reveal path for settled previews).
 */

import { projectRendererLineWindow, Text, type Component } from '#/tui/renderer';
import { highlightLines, langFromPath, highlightLinesWindow } from '#/tui/components/media/code-highlight';
import {
  diffLineBackground,
  renderDiffLinesClusteredRows,
} from '#/tui/components/media/diff-preview';
import { COMMAND_PREVIEW_LINES } from '#/tui/constant/rendering';
import { currentTheme } from '#/tui/theme';
import type { ToolResultBlockData } from '#/tui/types';

import { extractPartialStringField, formatByteSize, formatElapsed } from './tool-call-format';
import { extractApprovedPlan, interpretExitPlanModeOutcome, isExitPlanModeOutcomeOutput } from './tool-call-plan';

/** Settled (post-args) Write preview: line-numbered, optionally capped. */
export function buildWriteCallPreviewItems(params: {
  readonly content: string;
  readonly filePath: string;
  readonly expanded: boolean;
}): Text[] {
  const { content, filePath, expanded } = params;
  const lang = langFromPath(filePath);
  // Cap as soon as args finalize, not just when result lands. Otherwise the
  // brief render tick between finalized args and result draws the full file,
  // and the snap back to the collapsed cap triggers pi-tui's full-redraw
  // path which wipes the terminal scrollback (pre-TUI history).
  const writeShouldCap = !expanded;
  const plainLines = content.split('\n');
  const totalLines = plainLines.length;
  // Collapsed: highlight only the visible window (avoid full-file tokenize).
  // Expanded: full highlight (cached) for readable code review.
  let allLines: string[];
  if (writeShouldCap) {
    const end = Math.min(totalLines, COMMAND_PREVIEW_LINES);
    allLines = highlightLinesWindow(content, lang, { startLine: 0, endLine: end });
  } else {
    allLines = highlightLines(content, lang);
  }
  const preview = projectRendererLineWindow({
    lines: allLines,
    maxLines: writeShouldCap ? COMMAND_PREVIEW_LINES : undefined,
  });
  const shown = preview.lines;
  const remaining = preview.hiddenLineCount;
  const previewItems: Text[] = [];
  for (const [i, line] of shown.entries()) {
    const lineNum = currentTheme.dim(String(preview.startIndex + i + 1).padStart(4) + '  ');
    previewItems.push(new Text(lineNum + line, 2, 0));
  }
  if (writeShouldCap && remaining > 0) {
    previewItems.push(
      new Text(
        currentTheme.dim(
          `... (${String(remaining)} more lines, ${String(totalLines)} total, ctrl+o to expand)`,
        ),
        2,
        0,
      ),
    );
  }
  return previewItems;
}

/** Settled (post-args) Edit preview: clustered diff rows with backgrounds. */
export function buildEditCallPreviewItems(params: {
  readonly oldStr: string;
  readonly newStr: string;
  readonly filePath: string;
  readonly shouldCap: boolean;
}): Text[] {
  const { oldStr, newStr, filePath, shouldCap } = params;
  const rows = renderDiffLinesClusteredRows(oldStr, newStr, filePath, {
    contextLines: 3,
    ...(shouldCap ? { maxLines: COMMAND_PREVIEW_LINES } : {}),
  });
  const addBg = diffLineBackground('add');
  const delBg = diffLineBackground('delete');
  const previewItems: Text[] = [];
  for (const row of rows) {
    const bg = row.kind === 'add' ? addBg : row.kind === 'delete' ? delBg : undefined;
    previewItems.push(new Text(row.text, 2, 0, bg));
  }
  return previewItems;
}

/**
 * Streaming (mid-args) Write preview: tail window of the partially-streamed
 * `content` field. Returns `undefined` once there is nothing to show yet.
 */
export function buildStreamingWriteItems(previewText: string): Text[] | undefined {
  const content = extractPartialStringField(previewText, 'content');
  if (content === undefined || content.length === 0) return undefined;
  const filePath =
    extractPartialStringField(previewText, 'file_path') ??
    extractPartialStringField(previewText, 'path') ??
    '';
  const lang = langFromPath(filePath);
  const plainLines = content.split('\n');
  const total = plainLines.length;
  // Tail window only — streaming can be huge; never tokenize the whole blob.
  const tailStart = Math.max(0, total - COMMAND_PREVIEW_LINES);
  const allLines = highlightLinesWindow(content, lang, { startLine: tailStart, endLine: total });
  const preview = projectRendererLineWindow({
    lines: allLines,
    maxLines: COMMAND_PREVIEW_LINES,
    tail: true,
  });
  const scrollLines = preview.lines;
  const items: Text[] = [];
  for (const [i, line] of scrollLines.entries()) {
    const originalLineNumber = preview.startIndex + i;
    const lineNum = currentTheme.dim(String(originalLineNumber + 1).padStart(4) + '  ');
    items.push(new Text(lineNum + line, 2, 0));
  }
  return items;
}

/**
 * Streaming (mid-args) Edit preview: a progress line plus a live incomplete
 * diff once either side of the edit has content. Always returns at least
 * the progress line.
 */
export function buildStreamingEditComponents(params: {
  readonly previewText: string;
  readonly streamingStartedAtMs: number | undefined;
}): Component[] {
  const { previewText, streamingStartedAtMs } = params;
  const filePath =
    extractPartialStringField(previewText, 'file_path') ??
    extractPartialStringField(previewText, 'path') ??
    '';
  const oldStr = extractPartialStringField(previewText, 'old_string') ?? '';
  const newStr = extractPartialStringField(previewText, 'new_string') ?? '';
  const bytes = Buffer.byteLength(previewText, 'utf8');
  const elapsedSeconds =
    streamingStartedAtMs === undefined
      ? 0
      : Math.max(0, Math.floor((Date.now() - streamingStartedAtMs) / 1000));
  const target = filePath.length > 0 ? ` for ${filePath}` : '';
  const progress = `Preparing changes${target}... ${formatByteSize(bytes)} · ${formatElapsed(
    elapsedSeconds,
  )} elapsed`;
  const items: Component[] = [new Text(currentTheme.dim(progress), 2, 0)];
  // Live incomplete diff once either side has content — syntax-colored.
  if (oldStr.length > 0 || newStr.length > 0) {
    const rows = renderDiffLinesClusteredRows(oldStr, newStr, filePath, {
      contextLines: 2,
      maxLines: COMMAND_PREVIEW_LINES,
      isIncomplete: true,
      syntaxHighlight: true,
      // Follow the live edit edge: the viewport tracks the code being
      // written instead of staying pinned to the hunk start.
      tail: true,
    });
    const addBg = diffLineBackground('add');
    const delBg = diffLineBackground('delete');
    for (const row of rows) {
      const bg = row.kind === 'add' ? addBg : row.kind === 'delete' ? delBg : undefined;
      items.push(new Text(row.text, 2, 0, bg));
    }
  }
  return items;
}

/**
 * Priority: inline `args.plan`, approved plan parsed from result, then the
 * asynchronously injected `currentPlan` used while approval is in flight.
 */
export function resolvePlanForPreview(
  inlinePlan: string,
  result: ToolResultBlockData | undefined,
  currentPlan: string | undefined,
): string {
  if (inlinePlan.length > 0) return inlinePlan;
  if (result !== undefined && !result.is_error) {
    const approved = extractApprovedPlan(result.output);
    if (approved.length > 0) return approved;
  }
  return currentPlan ?? '';
}

/**
 * Priority: approved result.output with 'Plan saved to: <path>', then the
 * `planPath` asynchronously injected by `setPlanInfo` while approval is in
 * flight.
 */
export function resolvePlanPath(
  result: ToolResultBlockData | undefined,
  planPath: string | undefined,
): string | undefined {
  if (result !== undefined && !result.is_error) {
    const fromResult = interpretExitPlanModeOutcome(result.output).path;
    if (fromResult !== undefined && fromResult.length > 0) return fromResult;
  }
  return planPath;
}

export function resolvePlanBoxStatus(
  toolCallName: string,
  result: ToolResultBlockData | undefined,
): { label: string; colorHex: string } | undefined {
  if (toolCallName !== 'ExitPlanMode' || result === undefined) return undefined;
  if (!isExitPlanModeOutcomeOutput(result.output)) return undefined;
  const outcome = interpretExitPlanModeOutcome(result.output);
  if (outcome.kind !== 'rejected') return undefined;
  return { label: 'Rejected', colorHex: currentTheme.color('error') };
}

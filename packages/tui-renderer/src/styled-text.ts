import type { RendererCell, RendererCellStyle } from './cell-buffer';
import {
  ANSI_END_HYPERLINK,
  ANSI_RESET_STYLE,
  escapeTerminalText,
  hyperlinkToAnsi,
  styleToAnsi,
  type RendererColorMode,
} from './terminal-output';
import { measureDisplayWidth, splitDisplayClusters, textToCells } from './text-metrics';

export interface RendererStyledTextRun {
  readonly text: string;
  readonly style?: RendererCellStyle;
  readonly link?: string;
}

export interface RendererStyledTextAnsiOptions {
  readonly colorMode?: RendererColorMode;
  readonly resetStyle?: boolean;
}

export interface RendererStyledTextTruncateOptions {
  readonly width: number;
  readonly ellipsis?: string;
  readonly ellipsisStyle?: RendererCellStyle;
  readonly ellipsisLink?: string;
}

export type RendererStyledTextLine = readonly RendererStyledTextRun[];

export interface RendererStyledTextWrapOptions {
  readonly width: number;
  readonly trimEnd?: boolean;
}

export function measureRendererStyledTextRuns(
  runs: readonly RendererStyledTextRun[],
): number {
  return runs.reduce((width, run) => width + measureDisplayWidth(run.text), 0);
}

export function truncateRendererStyledTextRuns(
  runs: readonly RendererStyledTextRun[],
  options: RendererStyledTextTruncateOptions,
): readonly RendererStyledTextRun[] {
  const width = normalizeStyledTextWidth(options.width);
  if (width <= 0) return [];
  if (measureRendererStyledTextRuns(runs) <= width) return runs;

  const ellipsis = options.ellipsis ?? '';
  const ellipsisWidth = measureDisplayWidth(ellipsis);
  const contentWidth = ellipsisWidth >= width ? 0 : width - ellipsisWidth;
  const truncated: RendererStyledTextRun[] = [];
  let used = 0;

  for (const run of runs) {
    if (used >= contentWidth) break;
    let text = '';
    for (const cluster of splitDisplayClusters(run.text)) {
      if (cluster.width <= 0) {
        text += cluster.text;
        continue;
      }
      if (used + cluster.width > contentWidth) break;
      text += cluster.text;
      used += cluster.width;
    }
    if (text.length === 0) continue;
    truncated.push(copyRendererStyledTextRun(run, text));
  }

  const clippedEllipsis = truncateStyledTextEllipsis(ellipsis, width - used);
  if (clippedEllipsis.length > 0) {
    const ellipsisRun: {
      text: string;
      style?: RendererCellStyle;
      link?: string;
    } = { text: clippedEllipsis };
    if (options.ellipsisStyle !== undefined) {
      ellipsisRun.style = options.ellipsisStyle;
    }
    if (options.ellipsisLink !== undefined) {
      ellipsisRun.link = options.ellipsisLink;
    }
    truncated.push(ellipsisRun);
  }

  return truncated;
}

export function wrapRendererStyledTextRuns(
  runs: readonly RendererStyledTextRun[],
  options: RendererStyledTextWrapOptions,
): readonly RendererStyledTextLine[] {
  const width = normalizeStyledTextWidth(options.width);
  if (width <= 0) return [[]];

  const lines: RendererStyledTextRun[][] = [];
  let line: RendererStyledTextRun[] = [];
  let lineWidth = 0;

  const pushLine = (): void => {
    lines.push(options.trimEnd === true ? trimRendererStyledTextLineEnd(line) : line);
    line = [];
    lineWidth = 0;
  };

  for (const run of runs) {
    for (const cluster of splitDisplayClusters(run.text)) {
      if (cluster.text === '\n') {
        pushLine();
        continue;
      }
      if (cluster.width <= 0) {
        appendRendererStyledTextRunText(line, run, cluster.text);
        continue;
      }
      if (lineWidth > 0 && lineWidth + cluster.width > width) {
        pushLine();
      }
      if (cluster.width > width) continue;
      appendRendererStyledTextRunText(line, run, cluster.text);
      lineWidth += cluster.width;
    }
  }

  lines.push(options.trimEnd === true ? trimRendererStyledTextLineEnd(line) : line);
  return lines;
}

export function createRendererStyledTextCells(
  runs: readonly RendererStyledTextRun[],
): readonly RendererCell[] {
  return runs.flatMap((run) => {
    if (run.text.length === 0) return [];
    const cells = textToCells(run.text, run.style);
    if (run.link === undefined) return cells;
    return cells.map((cell) => ({ ...cell, link: run.link }));
  });
}

export function renderRendererStyledTextRunsAnsi(
  runs: readonly RendererStyledTextRun[],
  options: RendererStyledTextAnsiOptions = {},
): string {
  const out: string[] = [];
  let activeStyle: RendererCellStyle | undefined;
  let activeLink: string | undefined;

  for (const run of runs) {
    if (run.text.length === 0) continue;
    if (activeLink !== run.link) {
      activeLink = run.link;
      out.push(hyperlinkToAnsi(activeLink));
    }
    if (!rendererStyledTextStylesEqual(activeStyle, run.style)) {
      activeStyle = run.style;
      out.push(styleToAnsi(activeStyle, { colorMode: options.colorMode }));
    }
    out.push(escapeTerminalText(run.text));
  }

  if (activeLink !== undefined) out.push(ANSI_END_HYPERLINK);
  if (options.resetStyle !== false && activeStyle !== undefined) out.push(ANSI_RESET_STYLE);
  return out.join('');
}

function appendRendererStyledTextRunText(
  target: RendererStyledTextRun[],
  source: RendererStyledTextRun,
  text: string,
): void {
  if (text.length === 0) return;
  const previous = target.at(-1);
  if (
    previous !== undefined &&
    previous.link === source.link &&
    rendererStyledTextStylesEqual(previous.style, source.style)
  ) {
    target[target.length - 1] = copyRendererStyledTextRun(previous, previous.text + text);
    return;
  }
  target.push(copyRendererStyledTextRun(source, text));
}

function trimRendererStyledTextLineEnd(
  runs: readonly RendererStyledTextRun[],
): RendererStyledTextRun[] {
  const trimmed = [...runs];
  while (trimmed.length > 0) {
    const last = trimmed.at(-1)!;
    const nextText = trimStyledTextRunEnd(last.text);
    if (nextText.length === last.text.length) break;
    trimmed.pop();
    if (nextText.length > 0) {
      trimmed.push(copyRendererStyledTextRun(last, nextText));
      break;
    }
  }
  return trimmed;
}

function trimStyledTextRunEnd(text: string): string {
  const clusters = splitDisplayClusters(text);
  let end = clusters.length;
  while (end > 0 && /^\s$/u.test(clusters[end - 1]!.text)) end--;
  return clusters.slice(0, end).map((cluster) => cluster.text).join('');
}

function rendererStyledTextStylesEqual(
  left: RendererCellStyle | undefined,
  right: RendererCellStyle | undefined,
): boolean {
  return (
    left?.fg === right?.fg &&
    left?.bg === right?.bg &&
    left?.bold === right?.bold &&
    left?.dim === right?.dim &&
    left?.italic === right?.italic &&
    left?.underline === right?.underline &&
    left?.inverse === right?.inverse
  );
}

function copyRendererStyledTextRun(
  run: RendererStyledTextRun,
  text: string,
): RendererStyledTextRun {
  const copy: {
    text: string;
    style?: RendererCellStyle;
    link?: string;
  } = { text };
  if (run.style !== undefined) copy.style = run.style;
  if (run.link !== undefined) copy.link = run.link;
  return copy;
}

function truncateStyledTextEllipsis(ellipsis: string, width: number): string {
  if (ellipsis.length === 0 || width <= 0) return '';
  if (measureDisplayWidth(ellipsis) <= width) return ellipsis;
  let used = 0;
  const out: string[] = [];
  for (const cluster of splitDisplayClusters(ellipsis)) {
    if (cluster.width <= 0) continue;
    if (used + cluster.width > width) break;
    out.push(cluster.text);
    used += cluster.width;
  }
  return out.join('');
}

function normalizeStyledTextWidth(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

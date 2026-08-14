import {
  coalesceCellPatches,
  type RendererCell,
  type RendererCellStyle,
  type RendererFrameDiff,
  type RendererRenderRun,
} from '../cell-buffer/index';
import {
  encodeRendererClearInlineImages,
  type RendererInlineImageProtocol,
} from './graphics';
import { splitDisplayClusters } from '../text/metrics';
import {
  createCursorMotionMetrics,
  cursorMoveTo,
  cursorPositionForManagedCursor,
  cursorStateToAnsiFromPosition,
  cursorTo,
  hasTerminalOutput,
  isSafePrintableCluster,
  normalizeHyperlink,
  normalizeOrigin,
  parseHexColor,
  pushColorParams,
  recordCursorMoveMetrics,
  rendererRunCellWidth,
  resolveEraseLineStartIndex,
  snapshotCursorMotionMetrics,
  stripTerminalEscapeSequences,
  stylesEqual,
} from './output-internals';

export {
  cursorBackward,
  cursorDown,
  cursorForward,
  cursorHorizontalAbsolute,
  cursorShapeToAnsi,
  cursorStateToAnsi,
  cursorTo,
  cursorUp,
} from './output-internals';

export const ANSI_BEGIN_SYNCHRONIZED_UPDATE = '\u001B[?2026h';
export const ANSI_END_SYNCHRONIZED_UPDATE = '\u001B[?2026l';
export const ANSI_HIDE_CURSOR = '\u001B[?25l';
export const ANSI_SHOW_CURSOR = '\u001B[?25h';
export const ANSI_RESET_STYLE = '\u001B[0m';
export const ANSI_END_HYPERLINK = '\u001B]8;;\u001B\\';
export const ANSI_ERASE_IN_LINE = '\u001B[K';
export const ANSI_ERASE_FROM_CURSOR_TO_SCREEN_END = '\u001B[0J';
export const ANSI_RESET_SCROLL_REGION = '\u001B[r';

export function encodeTerminalClearBelowRow(
  row: number,
  originX = 0,
  originY = 0,
  fill?: Pick<RendererCell, 'style'> | RendererCellStyle,
  width = 1,
  extraRows = 1,
): string {
  const style = fill && 'style' in fill ? fill.style : fill;
  const bg = style?.bg;
  if (!bg) {
    // Bare CSI 0J / CSI J / CSI K paints the terminal default background
    // (usually black) and shows through as a horizontal stripe. Leave leftover
    // cells for the next theme-bg frame paint instead.
    return '';
  }
  // ConPTY CSI 0J still uses the default background even after an SGR bg
  // prefix. Paint themed spaces so leftover / newly exposed rows stay on theme.
  const columns = Math.max(1, Math.floor(width));
  const rows = Math.max(1, Math.floor(extraRows));
  const themedRow = styleToAnsi({ bg }) + ' '.repeat(columns) + ANSI_RESET_STYLE;
  let output = '';
  for (let index = 0; index < rows; index += 1) {
    output += cursorTo(originX, originY + row + index) + themedRow;
  }
  return output;
}

/**
 * Encode a terminal scroll-region operation. Sets a scroll region from
 * `top` to `bottom` (0-based row indices), scrolls by `delta` rows
 * (positive = scroll up / content moves up, negative = scroll down),
 * then resets the scroll region to full screen.
 *
 * Used by the scroll-aware delta blit path to shift unchanged rows via
 * terminal hardware scroll instead of re-diffing and re-encoding them.
 */
export function encodeScrollRegion(top: number, bottom: number, delta: number): string {
  if (delta === 0 || top >= bottom) return '';
  const setRegion = `\u001B[${top + 1};${bottom + 1}r`;
  const count = Math.abs(delta);
  const scroll = delta > 0
    ? (count === 1 ? '\u001B[S' : `\u001B[${count}S`)
    : (count === 1 ? '\u001B[T' : `\u001B[${count}T`);
  return setRegion + scroll + ANSI_RESET_SCROLL_REGION;
}

export type RendererColorMode = 'truecolor' | 'ansi256' | 'ansi16' | 'none';
export type RendererCursorShape = 'block' | 'underline' | 'bar';
export type RendererCursorMotionMode = 'absolute' | 'relative' | 'auto';

export interface RendererCursorState {
  readonly x: number;
  readonly y: number;
  readonly visible?: boolean;
  readonly shape?: RendererCursorShape;
  readonly blinking?: boolean;
}

export interface RendererTerminalOutputOptions {
  readonly synchronized?: boolean;
  readonly hideCursor?: boolean;
  readonly showCursor?: boolean;
  readonly resetStyle?: boolean;
  readonly originX?: number;
  readonly originY?: number;
  readonly cursor?: RendererCursorState;
  readonly eraseLine?: boolean;
  readonly frameWidth?: number;
  readonly frameHeight?: number;
  readonly colorMode?: RendererColorMode;
  readonly cursorMotion?: RendererCursorMotionMode;
  readonly previousCursor?: RendererCursorState;
  readonly inlineImageProtocol?: RendererInlineImageProtocol;
}

export type RendererCursorMoveKind = 'absolute' | 'relative' | 'horizontal-absolute' | 'none';

export interface RendererCursorMotionMetrics {
  readonly absoluteMoves: number;
  readonly relativeMoves: number;
  readonly horizontalAbsoluteMoves: number;
  readonly moveBytes: number;
  readonly absoluteMoveBytes: number;
  readonly savedBytes: number;
}

export interface RendererTerminalEncodedOutput {
  readonly output: string;
  readonly cursorMotion: RendererCursorMotionMetrics;
}


export function encodeTerminalFrame(
  diff: RendererFrameDiff,
  options: RendererTerminalOutputOptions = {},
): string {
  return encodeTerminalFrameWithMetrics(diff, options).output;
}

export function encodeTerminalFrameWithMetrics(
  diff: RendererFrameDiff,
  options: RendererTerminalOutputOptions = {},
): RendererTerminalEncodedOutput {
  const encoded = encodeTerminalRunsWithMetrics(diff.runs ?? coalesceCellPatches(diff.patches), options);
  // When a scroll delta is present, prepend the terminal scroll-region command
  // so shifted rows are handled by hardware scroll instead of re-encoding.
  if (diff.scrollDelta !== undefined && diff.scrollDelta !== 0 && options.frameWidth !== undefined) {
    const height = options.frameHeight ?? 0;
    if (height > 0) {
      const scrollCmd = encodeScrollRegion(0, height - 1, diff.scrollDelta);
      return { ...encoded, output: scrollCmd + encoded.output };
    }
  }
  return encoded;
}

export function encodeTerminalRuns(
  runs: readonly RendererRenderRun[],
  options: RendererTerminalOutputOptions = {},
): string {
  return encodeTerminalRunsWithMetrics(runs, options).output;
}

/**
 * Reusable string accumulator that avoids per-frame array allocation.
 * The internal chunk array grows to the high-water mark and stays there,
 * so subsequent frames reuse the same storage (zero GC pressure on the
 * encode hot path).
 */
export class FrameOutputBuilder {
  private chunks: string[] = [];
  private length = 0;

  push(s: string): void {
    this.chunks[this.length++] = s;
  }

  reset(): void {
    this.length = 0;
  }

  build(): string {
    if (this.length === 0) return '';
    // Temporarily truncate so join only reads active slots, then restore
    // the high-water mark to preserve allocated capacity.
    const capacity = this.chunks.length;
    this.chunks.length = this.length;
    const result = this.chunks.join('');
    this.chunks.length = capacity;
    return result;
  }
}

/** Module-level shared builder — safe because rendering is synchronous. */
const sharedFrameOutput = new FrameOutputBuilder();

export function encodeTerminalRunsWithMetrics(
  runs: readonly RendererRenderRun[],
  options: RendererTerminalOutputOptions = {},
): RendererTerminalEncodedOutput {
  if (!hasTerminalOutput(runs, options)) {
    return { output: '', cursorMotion: snapshotCursorMotionMetrics(createCursorMotionMetrics()) };
  }

  const out = sharedFrameOutput;
  out.reset();
  const cursorMotionMetrics = createCursorMotionMetrics();
  if (options.synchronized === true) out.push(ANSI_BEGIN_SYNCHRONIZED_UPDATE);
  if (options.hideCursor === true) out.push(ANSI_HIDE_CURSOR);
  const inlineImageClear = encodeRendererClearInlineImages(options.inlineImageProtocol ?? 'none');
  if (inlineImageClear.length > 0) out.push(inlineImageClear);

  let activeStyle: RendererCellStyle | undefined;
  let activeLink: string | undefined;
  const originX = normalizeOrigin(options.originX);
  const originY = normalizeOrigin(options.originY);
  const cursorMotion = options.cursorMotion ?? 'absolute';
  let cursorX: number | undefined;
  let cursorY: number | undefined;

  for (const run of runs) {
    const targetX = originX + run.x;
    const targetY = originY + run.y;
    const cursorMove = cursorMoveTo(targetX, targetY, { x: cursorX, y: cursorY }, cursorMotion);
    recordCursorMoveMetrics(cursorMotionMetrics, cursorMove);
    out.push(cursorMove.output);
    const eraseStartIndex = resolveEraseLineStartIndex(run, options);
    const cells = eraseStartIndex === undefined ? run.cells : run.cells.slice(0, eraseStartIndex);
    for (const cell of cells) {
      if (cell.continuation === true || cell.width === 0) continue;
      const link = normalizeHyperlink(cell.link);
      if (activeLink !== link) {
        activeLink = link;
        out.push(hyperlinkToAnsi(activeLink));
      }
      if (!stylesEqual(activeStyle, cell.style)) {
        activeStyle = cell.style;
        out.push(styleToAnsi(activeStyle, { colorMode: options.colorMode }));
      }
      out.push(escapeTerminalText(cell.char));
    }
    cursorX = targetX + rendererRunCellWidth(cells);
    cursorY = targetY;
    if (eraseStartIndex !== undefined) {
      if (activeLink !== undefined) {
        activeLink = undefined;
        out.push(ANSI_END_HYPERLINK);
      }
      if (activeStyle !== undefined) {
        activeStyle = undefined;
        out.push(ANSI_RESET_STYLE);
      }
      out.push(ANSI_ERASE_IN_LINE);
    }
  }

  if (activeLink !== undefined) out.push(ANSI_END_HYPERLINK);
  if (options.resetStyle !== false && activeStyle !== undefined) out.push(ANSI_RESET_STYLE);
  if (options.cursor !== undefined) {
    const cursorOutput = cursorStateToAnsiFromPosition(
      options.cursor,
      originX,
      originY,
      cursorPositionForManagedCursor(options.previousCursor, originX, originY, cursorX, cursorY),
      cursorMotion,
    );
    recordCursorMoveMetrics(cursorMotionMetrics, cursorOutput.cursorMove);
    out.push(cursorOutput.output);
  }
  if (options.showCursor === true && options.cursor === undefined) out.push(ANSI_SHOW_CURSOR);
  if (options.synchronized === true) out.push(ANSI_END_SYNCHRONIZED_UPDATE);
  return { output: out.build(), cursorMotion: snapshotCursorMotionMetrics(cursorMotionMetrics) };
}

export function hyperlinkToAnsi(link: string | undefined): string {
  const normalized = normalizeHyperlink(link);
  if (normalized === undefined) return ANSI_END_HYPERLINK;
  return `\u001B]8;;${normalized}\u001B\\`;
}

export function styleToAnsi(
  style: RendererCellStyle | undefined,
  options: { readonly colorMode?: RendererColorMode } = {},
): string {
  if (style === undefined) return ANSI_RESET_STYLE;

  const params = ['0'];
  if (style.bold === true) params.push('1');
  if (style.dim === true) params.push('2');
  if (style.italic === true) params.push('3');
  if (style.underline === true) params.push('4');
  if (style.inverse === true) params.push('7');

  const fg = parseHexColor(style.fg);
  const colorMode = options.colorMode ?? 'truecolor';
  if (fg !== undefined) pushColorParams(params, 'fg', fg, colorMode);
  const bg = parseHexColor(style.bg);
  if (bg !== undefined) pushColorParams(params, 'bg', bg, colorMode);

  return `\u001B[${params.join(';')}m`;
}

/**
 * Make text safe for cell/glyph sinks that must not carry control sequences.
 *
 * Full CSI/OSC sequences are stripped first: replacing only `\u001B` would
 * leave the SGR body (`[0;1;38;2;…m`) visible as plain text — the exact leak
 * users see as `[0;1;38;2>` / `[0;1;38;2;…m` in animations. Stripped
 * sequences are zero-width annotations, so dropping them keeps the grid.
 *
 * Lone control characters (e.g. a bare ESC that is not part of a sequence)
 * are deliberately kept for the cluster filter below, which replaces each
 * unsafe cluster with a space. Dropping them instead would shift every later
 * cell in the same run one column left.
 */
export function escapeTerminalText(text: string): string {
  const plain = stripTerminalEscapeSequences(text);
  return splitDisplayClusters(plain)
    .map((cluster) => (isSafePrintableCluster(cluster.text) ? cluster.text : ' '))
    .join('');
}

/** Drop CSI / OSC / other short ESC sequences; leave printable payload only. */
export function stripTerminalControlSequences(text: string): string {
  if (text.length === 0 || !text.includes('\u001B')) return text;
  return text
    // CSI: ESC [ … final byte in @-~
    .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    // OSC: ESC ] … BEL or ST
    .replaceAll(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    // Other 2-byte ESC sequences (e.g. ESC c) and any leftover ESC
    .replaceAll(/\u001B./g, '')
    .replaceAll('\u001B', '');
}

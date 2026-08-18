/**
 * Wrap-safe in-place frame painting for CLI TTY surfaces (upgrade prompt,
 * install theatre).
 *
 * The classic repaint bug: counting logical lines and moving the cursor up by
 * that count breaks as soon as one line soft-wraps (narrow terminal, long
 * detail text), leaving stale rows stacked on screen. This painter clips every
 * line below the terminal width so soft-wrap can never happen, and erases
 * leftovers from taller previous frames with a single erase-down.
 */

import { truncateToWidth } from '#/tui/renderer';

export interface TtyFrameOutput {
  write(chunk: string): boolean;
  readonly isTTY?: boolean;
  readonly columns?: number;
}

const CSI = '\u001B[';
const ERASE_DOWN = `${CSI}0J`;

export function frameColumns(output: TtyFrameOutput): number {
  const columns = output.columns;
  if (typeof columns === 'number' && Number.isFinite(columns) && columns >= 20) {
    return Math.floor(columns);
  }
  return 80;
}

export function clipFrameLine(line: string, columns: number): string {
  return truncateToWidth(line, Math.max(1, columns - 1), '…');
}

export class TtyFramePainter {
  private rows = 0;

  constructor(private readonly output: TtyFrameOutput) {}

  paint(lines: readonly string[]): void {
    const columns = frameColumns(this.output);
    const clipped = lines.map((line) => clipFrameLine(line, columns));
    let chunk = this.rows > 1 ? `${CSI}${this.rows - 1}A` : '';
    chunk += `\r${ERASE_DOWN}${clipped.join('\n')}`;
    this.output.write(chunk);
    this.rows = clipped.length;
  }

  /** Removes the painted frame entirely, leaving the cursor at column 0. */
  clear(): void {
    if (this.rows === 0) return;
    const up = this.rows > 1 ? `${CSI}${this.rows - 1}A` : '';
    this.output.write(`${up}\r${ERASE_DOWN}`);
    this.rows = 0;
  }

  /** Stops in-place painting and moves the cursor to a fresh line below. */
  finish(): void {
    if (this.rows > 0) this.output.write('\n');
    this.rows = 0;
  }
}

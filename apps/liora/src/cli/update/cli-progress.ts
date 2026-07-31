/**
 * TTY install theatre for `liora upgrade` — chalk.hex(darkColors) only.
 * Mirrors Upgrade Studio stage labels without importing TUI theme runtime.
 */

import { clearLine, cursorTo, moveCursor } from 'node:readline';

import chalk from 'chalk';

import { darkColors } from '#/tui/theme/colors';
import type { InstallSource } from './types';
import type { UpgradeInstallStage } from './install-stages';
import {
  formatStageChecklist,
  stageFraction,
  stageLabel,
} from '#/tui/utils/upgrade/upgrade-stage-ui';
import { HIDE_CURSOR, SHOW_CURSOR } from '#/constant/terminal';

export interface CliUpgradeProgressFrame {
  readonly source: InstallSource;
  readonly stage: UpgradeInstallStage;
  readonly targetVersion: string;
  readonly detail?: string;
  readonly startedAtMs: number;
  readonly nowMs?: number;
}

export function renderCliUpgradeProgressLines(
  frame: CliUpgradeProgressFrame,
): readonly string[] {
  const now = frame.nowMs ?? Date.now();
  const fraction = stageFraction(frame.stage);
  const pct = `${String(Math.round(fraction * 100)).padStart(3, ' ')}%`;
  const bar = renderBar(fraction, 28);
  const elapsed = Math.max(0, (now - frame.startedAtMs) / 1000).toFixed(1);
  const checklist = formatStageChecklist(frame.source, frame.stage);
  const lines: string[] = [
    chalk.hex(darkColors.primary).bold(`Upgrading SuperLiora → ${frame.targetVersion}`),
    chalk.hex(darkColors.textMuted)(`Source: ${frame.source}`),
    '',
  ];
  for (const row of checklist) {
    const mark =
      row.marker === 'done'
        ? chalk.hex(darkColors.success)('✓')
        : row.marker === 'failed'
          ? chalk.hex(darkColors.error)('✗')
          : row.marker === 'active'
            ? chalk.hex(darkColors.primary)('●')
            : chalk.hex(darkColors.textDim)('·');
    const label =
      row.marker === 'active'
        ? chalk.hex(darkColors.primary).bold(row.label)
        : row.marker === 'done'
          ? chalk.hex(darkColors.success)(row.label)
          : row.marker === 'failed'
            ? chalk.hex(darkColors.error).bold(row.label)
            : chalk.hex(darkColors.textDim)(row.label);
    lines.push(` ${mark} ${label}`);
  }
  lines.push('');
  lines.push(
    `${chalk.hex(darkColors.text)(stageLabel(frame.stage))}  ${bar} ${chalk.hex(darkColors.primary).bold(pct)}`,
  );
  lines.push(chalk.hex(darkColors.textMuted)(`elapsed ${elapsed}s`));
  if (frame.detail !== undefined && frame.detail.trim().length > 0) {
    const detail = frame.detail.trim();
    lines.push(
      chalk.hex(darkColors.textDim)(detail.length > 100 ? `${detail.slice(0, 97)}…` : detail),
    );
  }
  return lines;
}

export class CliUpgradeProgressWriter {
  private lineCount = 0;
  private readonly startedAtMs = Date.now();

  constructor(
    private readonly output: {
      write(chunk: string): boolean;
      isTTY?: boolean;
    },
  ) {}

  start(): void {
    if (this.output.isTTY) this.output.write(HIDE_CURSOR);
  }

  update(frame: Omit<CliUpgradeProgressFrame, 'startedAtMs' | 'nowMs'>): void {
    const lines = renderCliUpgradeProgressLines({
      ...frame,
      startedAtMs: this.startedAtMs,
      nowMs: Date.now(),
    });
    this.lineCount = writePromptFrame(this.output, lines, this.lineCount);
  }

  finish(): void {
    if (this.lineCount > 0) this.output.write('\n');
    if (this.output.isTTY) this.output.write(SHOW_CURSOR);
    this.lineCount = 0;
  }
}

function renderBar(fraction: number, width: number): string {
  const safe = Math.max(4, width);
  const filled = Math.round(safe * Math.min(1, Math.max(0, fraction)));
  const empty = Math.max(0, safe - filled);
  const body = chalk.hex(darkColors.primary)('█'.repeat(filled));
  const rest = chalk.hex(darkColors.textDim)('░'.repeat(empty));
  return `[${body}${rest}]`;
}

function writePromptFrame(
  output: { write(chunk: string): boolean },
  lines: readonly string[],
  previousLineCount: number,
): number {
  if (previousLineCount > 0) {
    moveCursor(output as NodeJS.WriteStream, 0, -(previousLineCount - 1));
  }
  for (let i = 0; i < lines.length; i++) {
    clearLine(output as NodeJS.WriteStream, 0);
    cursorTo(output as NodeJS.WriteStream, 0);
    output.write(lines[i] ?? '');
    if (i < lines.length - 1) output.write('\n');
  }
  return lines.length;
}

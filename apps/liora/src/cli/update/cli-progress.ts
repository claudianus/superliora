/**
 * TTY install theatre for `liora upgrade` — chalk.hex(darkColors) only.
 * Mirrors Upgrade Studio stage labels without importing TUI theme runtime.
 *
 * Painting goes through TtyFramePainter so a wrapped line can never corrupt
 * the in-place repaint (the bug behind stacked junk output during upgrades).
 * On a live TTY the writer also runs a 120ms ticker for spinner motion, a
 * shimmering gradient bar, eased progress, and a live elapsed clock.
 */

import chalk from 'chalk';

import { darkColors } from '#/tui/theme/colors';
import { mixHexColor } from '#/tui/renderer';
import type { InstallSource } from './types';
import type { UpgradeInstallStage } from './install-stages';
import {
  formatStageChecklist,
  stageFraction,
  stageLabel,
} from '#/tui/utils/upgrade/upgrade-stage-ui';
import { HIDE_CURSOR, SHOW_CURSOR } from '#/constant/terminal';
import { TtyFramePainter, type TtyFrameOutput } from './tty-frame';

export interface CliUpgradeProgressFrame {
  readonly source: InstallSource;
  readonly stage: UpgradeInstallStage;
  readonly targetVersion: string;
  readonly detail?: string;
  readonly startedAtMs: number;
  readonly nowMs?: number;
  /** Eased fraction from the animated writer; defaults to the stage fraction. */
  readonly fractionOverride?: number;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const BAR_WIDTH = 26;
const TICK_INTERVAL_MS = 120;

function spinnerGlyph(nowMs: number): string {
  return SPINNER_FRAMES[Math.floor(nowMs / 80) % SPINNER_FRAMES.length] ?? '⠋';
}

function gradientText(text: string, from: string, to: string): string {
  const chars = [...text];
  const denominator = Math.max(1, chars.length - 1);
  return chars
    .map((char, index) =>
      char === ' ' ? char : chalk.hex(mixHexColor(from, to, index / denominator)).bold(char),
    )
    .join('');
}

function renderBar(fraction: number, nowMs: number, active: boolean): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(BAR_WIDTH * clamped);
  const shimmerIndex = active && filled > 0 ? Math.floor(nowMs / 90) % filled : -1;
  let body = '';
  for (let i = 0; i < BAR_WIDTH; i++) {
    if (i < filled) {
      const ratio = BAR_WIDTH <= 1 ? 0 : i / (BAR_WIDTH - 1);
      let color = mixHexColor(darkColors.primary, darkColors.accent, ratio);
      if (i === shimmerIndex) color = mixHexColor(color, darkColors.textStrong, 0.7);
      body += chalk.hex(color)('█');
    } else {
      body += chalk.hex(darkColors.textMuted)('░');
    }
  }
  return `${chalk.hex(darkColors.textDim)('[')}${body}${chalk.hex(darkColors.textDim)(']')}`;
}

export function renderCliUpgradeProgressLines(
  frame: CliUpgradeProgressFrame,
): readonly string[] {
  const now = frame.nowMs ?? Date.now();
  const terminalStage = frame.stage === 'done' || frame.stage === 'failed';
  const fraction = frame.fractionOverride ?? stageFraction(frame.stage);
  const pct = `${String(Math.round(Math.min(1, Math.max(0, fraction)) * 100)).padStart(3, ' ')}%`;
  const bar = renderBar(fraction, now, !terminalStage);
  const elapsed = Math.max(0, (now - frame.startedAtMs) / 1000).toFixed(1);
  const checklist = formatStageChecklist(frame.source, frame.stage);
  const lines: string[] = [
    `${chalk.hex(darkColors.accent)('◆')} ${gradientText(`Upgrading SuperLiora → ${frame.targetVersion}`, darkColors.primary, darkColors.accent)}`,
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
            ? chalk.hex(darkColors.primary)(spinnerGlyph(now))
            : chalk.hex(darkColors.textMuted)('·');
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
    `${chalk.hex(darkColors.text).bold(stageLabel(frame.stage))}  ${bar} ${chalk.hex(darkColors.primary).bold(pct)}`,
  );
  lines.push(chalk.hex(darkColors.textMuted)(`elapsed ${elapsed}s`));
  if (frame.detail !== undefined && frame.detail.trim().length > 0) {
    const detail = frame.detail.trim().replaceAll(/\s+/g, ' ');
    lines.push(
      chalk.hex(darkColors.textDim)(detail.length > 120 ? `${detail.slice(0, 117)}…` : detail),
    );
  }
  return lines;
}

type CliUpgradeProgressUpdate = Omit<
  CliUpgradeProgressFrame,
  'startedAtMs' | 'nowMs' | 'fractionOverride'
>;

export class CliUpgradeProgressWriter {
  private readonly startedAtMs = Date.now();
  private readonly painter: TtyFramePainter;
  private lastFrame: CliUpgradeProgressUpdate | undefined;
  private displayedFraction = 0;
  private ticker: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly output: TtyFrameOutput) {
    this.painter = new TtyFramePainter(output);
  }

  start(): void {
    if (this.output.isTTY === true) this.output.write(HIDE_CURSOR);
  }

  update(frame: CliUpgradeProgressUpdate): void {
    this.lastFrame = frame;
    this.paint();
    if (this.output.isTTY === true && frame.stage !== 'done' && frame.stage !== 'failed') {
      this.ensureTicker();
    } else {
      this.stopTicker();
    }
  }

  finish(): void {
    this.stopTicker();
    this.painter.finish();
    if (this.output.isTTY === true) this.output.write(SHOW_CURSOR);
  }

  private paint(): void {
    const frame = this.lastFrame;
    if (frame === undefined) return;
    const target = stageFraction(frame.stage);
    if (frame.stage === 'done' || frame.stage === 'failed') {
      this.displayedFraction = target;
    } else {
      const next = this.displayedFraction + (target - this.displayedFraction) * 0.35;
      this.displayedFraction = Math.abs(target - next) < 0.005 ? target : next;
    }
    this.painter.paint(
      renderCliUpgradeProgressLines({
        ...frame,
        startedAtMs: this.startedAtMs,
        nowMs: Date.now(),
        fractionOverride: this.displayedFraction,
      }),
    );
  }

  private ensureTicker(): void {
    if (this.ticker !== undefined) return;
    this.ticker = setInterval(() => this.paint(), TICK_INTERVAL_MS);
    if (typeof this.ticker.unref === 'function') this.ticker.unref();
  }

  private stopTicker(): void {
    if (this.ticker === undefined) return;
    clearInterval(this.ticker);
    this.ticker = undefined;
  }
}

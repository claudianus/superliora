/**
 * Upgrade Studio install progress — stage checklist + kinetic bar.
 * Reuses session-loading bar primitives; pure theme-aware strings.
 */

import type { InstallSource } from '#/cli/update/types';
import type { UpgradeInstallStage } from '#/cli/update/install-stages';
import {
  appearanceAnimationNow,
  motionEffectsAllowed,
} from '#/tui/features/appearance/appearance-effects';
import { currentTheme } from '#/tui/theme';
import { renderSessionLoadingBar } from '#/tui/components/dialogs/session/session-loading-overlay';
import {
  formatStageChecklist,
  stageFraction,
  stageLabel,
  type UpgradeChecklistMarker,
} from '#/tui/utils/upgrade/upgrade-stage-ui';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const SPINNER_MS = 64;

export function renderUpgradeProgressBlock(options: {
  readonly width: number;
  readonly source: InstallSource;
  readonly stage: UpgradeInstallStage;
  readonly detail?: string;
  readonly progress?: number;
  readonly startedAtMs: number;
  readonly nowMs?: number;
}): readonly string[] {
  const now = options.nowMs ?? appearanceAnimationNow();
  const fraction =
    options.progress !== undefined && Number.isFinite(options.progress)
      ? clamp01(options.progress)
      : stageFraction(options.stage);
  const barWidth = Math.max(12, Math.min(36, options.width - 12));
  const bar = renderSessionLoadingBar(fraction, barWidth, now);
  const pct = `${String(Math.round(fraction * 100)).padStart(3, ' ')}%`;
  const elapsedSec = Math.max(0, (now - options.startedAtMs) / 1000);
  const spinner = renderActiveSpinner(now);
  const phaseLine =
    options.stage === 'failed'
      ? `${currentTheme.fg('error', '✗')} ${currentTheme.boldFg('error', stageLabel(options.stage))}`
      : options.stage === 'done'
        ? `${currentTheme.fg('success', '✓')} ${currentTheme.boldFg('success', stageLabel(options.stage))}`
        : `${spinner} ${currentTheme.fg('text', stageLabel(options.stage))}`;

  const lines: string[] = [
    ...renderUpgradeStageChecklist(options.source, options.stage, now),
    '',
    phaseLine,
    `${bar} ${currentTheme.boldFg('primary', pct)}`,
    currentTheme.dim(` elapsed ${elapsedSec.toFixed(1)}s`),
  ];

  if (options.detail !== undefined && options.detail.trim().length > 0) {
    lines.push(currentTheme.dim(truncate(options.detail.trim(), Math.max(12, options.width - 4))));
  }
  return lines;
}

export function renderUpgradeStageChecklist(
  source: InstallSource,
  active: UpgradeInstallStage,
  nowMs: number = appearanceAnimationNow(),
): readonly string[] {
  const rows = formatStageChecklist(source, active);
  return rows.map((row) => {
    const mark = markerGlyph(row.marker, nowMs);
    const label =
      row.marker === 'active'
        ? currentTheme.boldFg('primary', row.label)
        : row.marker === 'done'
          ? currentTheme.fg('success', row.label)
          : row.marker === 'failed'
            ? currentTheme.boldFg('error', row.label)
            : currentTheme.fg('textDim', row.label);
    return ` ${mark} ${label}`;
  });
}

function markerGlyph(marker: UpgradeChecklistMarker, nowMs: number): string {
  switch (marker) {
    case 'done':
      return currentTheme.fg('success', '✓');
    case 'failed':
      return currentTheme.fg('error', '✗');
    case 'active':
      return renderActiveSpinner(nowMs);
    case 'pending':
      return currentTheme.fg('textDim', '·');
  }
}

function renderActiveSpinner(nowMs: number): string {
  if (!motionEffectsAllowed()) {
    return currentTheme.fg('primary', '●');
  }
  const frame = SPINNER[Math.floor(nowMs / SPINNER_MS) % SPINNER.length] ?? '⠋';
  return currentTheme.fg('primary', frame);
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  return `${text.slice(0, max - 1)}…`;
}

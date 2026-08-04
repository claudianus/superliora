/**
 * Neat cards — render a `ToolResultDisplay` emitted by agent-core instead of
 * dumping the tool's raw text.
 *
 * One renderer, one `kind` → rows table. Adding a display kind means appending
 * a case here, not a new renderer file. Status tones come from the same
 * `ColorToken` vocabulary the Conductor Job Desk uses (`JOB_STATUS_META`), so a
 * failing check in the transcript reads like a failing card on the board.
 */

import type { ToolResultDisplay } from '@superliora/sdk';

import { Text, renderRendererRatioProgressBar, truncateToWidth } from '#/tui/renderer';
import {
  getActiveAppearancePreferences,
  renderDangerBreathe,
} from '#/tui/features/appearance/appearance-effects';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';

import { JOB_STATUS_META } from '../../job-board/job-board-helpers';

const INDENT = '  ';
const ROW_INDENT = '    ';
/** Findings painted inline; the rest collapse into a `+N more` tail. */
const MAX_ROWS = 3;
/** Ratio bar width — fixed so the card never reflows on narrow terminals. */
const BAR_WIDTH = 16;
/** Structured cards stay a glance, not a JSON pretty-printer. */
const MAX_STRUCTURED_ROWS = 5;
const MAX_VALUE_WIDTH = 60;

/**
 * Cards borrow the Job Desk's status vocabulary rather than inventing tones, so
 * a failing check reads identically in the transcript and on the board.
 */
function outcomeMeta(failed: boolean, warned: boolean): { glyph: string; token: ColorToken } {
  const meta = JOB_STATUS_META[failed ? 'failed' : warned ? 'needs_user' : 'done'];
  return { glyph: meta.glyph, token: meta.token };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${String(Math.round(seconds))}s`;
}

/**
 * Render a display payload, or return `undefined` when this payload has no
 * card form so the caller can keep its existing renderer.
 */
export function renderNeatCard(
  display: ToolResultDisplay,
  options: { readonly seed: string },
): Text[] | undefined {
  switch (display.kind) {
    case 'check_report':
      return checkReportRows(display, options.seed);
    case 'command_output':
      return commandOutputRows(display);
    case 'structured':
      return structuredRows(display.data);
    default:
      return undefined;
  }
}

type CheckReport = Extract<ToolResultDisplay, { kind: 'check_report' }>;

function checkReportRows(display: CheckReport, seed: string): Text[] {
  const failed = display.failed ?? 0;
  const passed = display.passed ?? 0;
  const warnings = display.warnings ?? 0;
  const hasFailure = failed > 0 || (display.exit_code !== 0 && passed === 0);
  const { glyph, token } = outcomeMeta(hasFailure, warnings > 0);

  // The failure count breathes in place — the same attention signal the Job
  // Desk `Needs you` lane uses — rather than earning a second row that would
  // just restate it.
  const segments: string[] = [];
  if (failed > 0) {
    segments.push(
      renderDangerBreathe(
        `${String(failed)} failed`,
        `${seed}:check`,
        getActiveAppearancePreferences(),
      ),
    );
  }
  if (passed > 0) segments.push(currentTheme.dimFg('textMuted', `${String(passed)} passed`));
  if ((display.skipped ?? 0) > 0) {
    segments.push(currentTheme.dimFg('textDim', `${String(display.skipped)} skipped`));
  }
  if (warnings > 0) {
    segments.push(
      currentTheme.fg('warning', `${String(warnings)} warning${warnings === 1 ? '' : 's'}`),
    );
  }
  if (segments.length === 0 && display.summary !== undefined) {
    segments.push(currentTheme.dimFg('textMuted', display.summary));
  }
  if (segments.length === 0) {
    segments.push(
      currentTheme.dimFg(
        'textMuted',
        display.exit_code === 0 ? 'ok' : `exit ${String(display.exit_code)}`,
      ),
    );
  }
  if (display.duration_ms !== undefined) {
    segments.push(currentTheme.dimFg('textDim', formatDuration(display.duration_ms)));
  }

  const bar = ratioBar(passed, failed);
  const head =
    `${currentTheme.boldFg(token, `${glyph} ${display.tool}`)}` +
    (bar.length === 0 ? '' : `  ${bar}`) +
    `  ${segments.join(currentTheme.dimFg('textDim', ' · '))}`;

  const rows: Text[] = [new Text(`${INDENT}${head}`, 0, 0)];
  const findings = display.findings ?? [];
  for (const finding of findings.slice(0, MAX_ROWS)) {
    const where =
      finding.line === undefined ? finding.file : `${finding.file}:${String(finding.line)}`;
    rows.push(
      new Text(
        `${ROW_INDENT}${currentTheme.fg('text', where)}  ${currentTheme.dimFg(
          'textMuted',
          truncateToWidth(finding.message, MAX_VALUE_WIDTH, '…'),
        )}`,
        0,
        0,
      ),
    );
  }
  const extra = findings.length - MAX_ROWS;
  if (extra > 0) {
    rows.push(
      new Text(`${ROW_INDENT}${currentTheme.dimFg('textDim', `+${String(extra)} more`)}`, 0, 0),
    );
  }
  return rows;
}

/** Empty string when there is nothing to weigh — the bar would only be noise. */
function ratioBar(passed: number, failed: number): string {
  const total = passed + failed;
  if (total === 0) return '';
  return renderRendererRatioProgressBar({
    ratio: passed / total,
    width: BAR_WIDTH,
    filledStyle: (text) => currentTheme.fg('success', text),
    emptyStyle: (text) => currentTheme.fg('error', text),
  });
}

type CommandOutput = Extract<ToolResultDisplay, { kind: 'command_output' }>;

function commandOutputRows(display: CommandOutput): Text[] {
  const failed = display.exit_code !== 0;
  const { glyph, token } = outcomeMeta(failed, false);
  const label = failed ? `exit ${String(display.exit_code)}` : 'ok';
  const rows: Text[] = [
    new Text(`${INDENT}${currentTheme.boldFg(token, `${glyph} ${label}`)}`, 0, 0),
  ];
  const body = `${display.stdout ?? ''}${display.stderr ?? ''}`;
  const lines = body.split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines.slice(-MAX_ROWS)) {
    rows.push(
      new Text(
        `${ROW_INDENT}${currentTheme.dimFg('textMuted', truncateToWidth(line.trim(), 120, '…'))}`,
        0,
        0,
      ),
    );
  }
  return rows;
}

function structuredRows(data: unknown): Text[] | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const entries = Array.isArray(data)
    ? data.slice(0, MAX_STRUCTURED_ROWS).map((item, i) => [String(i), item] as const)
    : Object.entries(data).slice(0, MAX_STRUCTURED_ROWS);
  const total = Array.isArray(data) ? data.length : Object.keys(data).length;
  if (total === 0) return undefined;

  const heading = Array.isArray(data)
    ? `[${String(total)} item${total === 1 ? '' : 's'}]`
    : `{${String(total)} field${total === 1 ? '' : 's'}}`;
  const rows: Text[] = [
    new Text(`${INDENT}${currentTheme.dimFg('textMuted', heading)}`, 0, 0),
  ];

  const keyWidth = Math.min(
    20,
    entries.reduce((max, [key]) => Math.max(max, key.length), 0),
  );
  for (const [key, value] of entries) {
    const label = truncateToWidth(key, keyWidth, '…').padEnd(keyWidth, ' ');
    rows.push(
      new Text(
        `${ROW_INDENT}${currentTheme.fg('textMuted', label)}  ${formatStructuredValue(value)}`,
        0,
        0,
      ),
    );
  }
  const extra = total - entries.length;
  if (extra > 0) {
    rows.push(
      new Text(`${ROW_INDENT}${currentTheme.dimFg('textDim', `+${String(extra)} more`)}`, 0, 0),
    );
  }
  return rows;
}

/** Scalars keep a type-specific tone; containers collapse to a shape hint. */
function formatStructuredValue(value: unknown): string {
  if (value === null) return currentTheme.dimFg('textDim', 'null');
  if (typeof value === 'boolean') {
    return currentTheme.fg(value ? 'success' : 'textDim', String(value));
  }
  if (typeof value === 'number') return currentTheme.fg('info', String(value));
  if (typeof value === 'string') {
    const flat = value.replaceAll(/\s+/g, ' ').trim();
    return currentTheme.fg('text', truncateToWidth(flat, MAX_VALUE_WIDTH, '…'));
  }
  if (Array.isArray(value)) {
    return currentTheme.dimFg('textMuted', `[${String(value.length)}]`);
  }
  if (typeof value === 'object') {
    return currentTheme.dimFg('textMuted', `{${String(Object.keys(value).length)}}`);
  }
  return currentTheme.dimFg('textDim', String(value));
}

/**
 * Neat cards — render a `ToolResultDisplay` emitted by agent-core instead of
 * dumping the tool's raw text.
 *
 * One renderer, one `kind` → rows table. Adding a display kind means appending
 * a case here, not a new renderer file. Status tones come from the same
 * `ColorToken` vocabulary the Job Desk uses (`JOB_STATUS_META`), so a
 * failed command in the transcript reads like a failed card on the board.
 */

import type { ToolResultDisplay } from '@superliora/sdk';

import { Text, truncateToWidth } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';

import { JOB_STATUS_META } from '../../job-board/job-board-helpers';

const INDENT = '  ';
const ROW_INDENT = '    ';
/** Output lines painted inline. */
const MAX_ROWS = 3;
/** Structured cards stay a glance, not a JSON pretty-printer. */
const MAX_STRUCTURED_ROWS = 5;
const MAX_VALUE_WIDTH = 60;


/**
 * Render a display payload, or return `undefined` when this payload has no
 * card form so the caller can keep its existing renderer.
 */
export function renderNeatCard(
  display: ToolResultDisplay,
): Text[] | undefined {
  switch (display.kind) {
    case 'command_output':
      return commandOutputRows(display);
    case 'structured':
      return structuredRows(display.data);
    default:
      return undefined;
  }
}


type CommandOutput = Extract<ToolResultDisplay, { kind: 'command_output' }>;

function commandOutputRows(display: CommandOutput): Text[] {
  const failed = display.exit_code !== 0;
  const { glyph, token } = JOB_STATUS_META[failed ? 'failed' : 'done'];
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

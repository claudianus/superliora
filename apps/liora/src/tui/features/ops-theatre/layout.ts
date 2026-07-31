/**
 * Pure 2×2 ASCII grid for Ops Theatre — deterministic, testable, no theme deps.
 */

export const DEFAULT_OPS_THEATRE_WIDTH = 80;
export const MIN_OPS_THEATRE_WIDTH = 40;

export interface OpsTheatreGridPanes {
  readonly fleet: readonly string[];
  readonly goal: readonly string[];
  readonly git: readonly string[];
  readonly health: readonly string[];
}

const PANE_TITLES = {
  fleet: 'Fleet / Agents',
  goal: 'Mission / Goal',
  git: 'Git / Workspace',
  health: 'Runtime Health',
} as const;

export function renderOpsTheatreGrid(
  panes: OpsTheatreGridPanes,
  width = DEFAULT_OPS_THEATRE_WIDTH,
): string[] {
  const totalWidth = clampWidth(width);
  const innerLeft = Math.floor((totalWidth - 3) / 2);
  const innerRight = totalWidth - 3 - innerLeft;

  const topRowCount = Math.max(1, panes.fleet.length, panes.goal.length);
  const bottomRowCount = Math.max(1, panes.git.length, panes.health.length);

  const topBorder =
    '┌' +
    titledFill(PANE_TITLES.fleet, innerLeft) +
    '┬' +
    titledFill(PANE_TITLES.goal, innerRight) +
    '┐';
  const midBorder =
    '├' +
    titledFill(PANE_TITLES.git, innerLeft) +
    '┼' +
    titledFill(PANE_TITLES.health, innerRight) +
    '┤';
  const bottomBorder = '└' + plainFill(innerLeft) + '┴' + plainFill(innerRight) + '┘';

  const topRows = Array.from({ length: topRowCount }, (_, index) =>
    contentRow(
      panes.fleet[index] ?? '',
      panes.goal[index] ?? '',
      innerLeft,
      innerRight,
    ),
  );
  const bottomRows = Array.from({ length: bottomRowCount }, (_, index) =>
    contentRow(
      panes.git[index] ?? '',
      panes.health[index] ?? '',
      innerLeft,
      innerRight,
    ),
  );

  return [topBorder, ...topRows, midBorder, ...bottomRows, bottomBorder];
}

function clampWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_OPS_THEATRE_WIDTH;
  }
  return Math.max(MIN_OPS_THEATRE_WIDTH, Math.floor(width));
}

function truncatePlain(text: string, max: number): string {
  if (max <= 0) return '';
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  if (max === 1) return '…';
  return `${normalized.slice(0, max - 1)}…`;
}

function padPlain(text: string, width: number): string {
  const truncated = truncatePlain(text, width);
  return truncated + ' '.repeat(Math.max(0, width - truncated.length));
}

function titledFill(title: string, width: number): string {
  const label = `─ ${title} `;
  if (label.length > width) {
    return truncatePlain(label, width);
  }
  if (label.length === width) {
    return label;
  }
  return label + '─'.repeat(width - label.length);
}

function plainFill(width: number): string {
  return '─'.repeat(Math.max(0, width));
}

function contentRow(left: string, right: string, innerLeft: number, innerRight: number): string {
  return (
    '│' +
    padPlain(left, innerLeft) +
    '│' +
    padPlain(right, innerRight) +
    '│'
  );
}

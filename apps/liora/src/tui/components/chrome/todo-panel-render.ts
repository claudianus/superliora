/**
 * Themed rendering helpers for the TodoPanel: the board / lane layout,
 * per-card styling, and the small text-only summaries used by other
 * components (swarm member rows). The coordinator (`todo-panel.ts`) owns all
 * state; every function here is a pure `(state) => string[]` / `(state) =>
 * string` transform.
 */
import {
  renderRendererDividerRow,
  renderRendererRatioProgressBar,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '#/tui/renderer';
import {
  GOAL_DOT,
  PENDING_GLYPH,
  PULSE_ACTIVE_FRAMES,
  TODO_ADDED,
  TODO_COMPLETED,
  TODO_MOVED,
  TODO_REOPENED,
} from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import type { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  isToneSettleFlashActive,
  renderPulseGlyph,
  renderSettleFlash,
  renderShimmerPrefix,
  renderToneSettleFlash,
  resolveQualityAdjustedAmbientEffectMode,
  SETTLE_FLASH_MS,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

import {
  countTodos,
  formatChangeSummary,
  formatHiddenCounts,
  selectVisibleTodos,
} from './todo-panel-model';
import type { TodoChangeKind, TodoPanelChangeSummary } from './todo-panel-model';
import type { TodoItem, TodoStatus } from './todo-panel-types';

export const BOARD_MIN_WIDTH = 72;
const BOARD_COLUMN_MIN_WIDTH = 16;
export const BOARD_INDENT = '  ';
const BOARD_SEPARATOR = ' │ ';
const STALE_TOOL_CALLS = 2;

/**
 * Card-motion transition budget. A true vertical FLIP offset is not viable
 * in this grid: every board row joins all three lane cells, so a card
 * sliding through a neighbour's row would either overwrite that card or
 * flash a `No cards` gap, and it would fight the shrink-hold padding. The
 * rearrangement instead reads as motion through cues that stay inside the
 * card's own cell — a decaying slide-in indent (absorbed by the cell's
 * right padding), a directional brand glyph, and a brand title fade.
 */
const BOARD_MOVE_CUE_MS = 320;
const MOVE_SLIDE_MAX_INDENT = 2;
const MOVE_GLYPH_UP = '▴';
const MOVE_GLYPH_DOWN = '▾';

const TODO_LANES: readonly { status: TodoStatus; label: string }[] = [
  { status: 'in_progress', label: 'Doing' },
  { status: 'pending', label: 'Next' },
  { status: 'done', label: 'Done' },
];

export function changeFlashMs(): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(getActiveAppearancePreferences());
  return mode === 'subtle' ? SETTLE_FLASH_MS * 1.4 : SETTLE_FLASH_MS;
}

function moveCueMs(): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(getActiveAppearancePreferences());
  return mode === 'subtle' ? BOARD_MOVE_CUE_MS * 1.4 : BOARD_MOVE_CUE_MS;
}

/** Clock-driven 0→1 decay; shared by the slide, glyph, and title-fade stages. */
function cueProgress(startedAtMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (appearanceAnimationNow() - startedAtMs) / durationMs));
}

export interface CardMotionCue {
  readonly kind: 'move' | 'enter';
  /** Row travel direction for moves; undefined for lane hops on the same row. */
  readonly direction?: 'up' | 'down';
  readonly startedAtMs: number;
}

export const EMPTY_MOTIONS: ReadonlyMap<string, CardMotionCue> = new Map();
export const EMPTY_LANE_FLASHES: Readonly<Partial<Record<TodoStatus, number>>> = {};

export function renderTodos(
  todos: readonly TodoItem[],
  width: number,
  highlights: ReadonlyMap<string, TodoChangeKind>,
  changedAtMs: number | undefined,
  profile: ReturnType<typeof resolveResponsiveLayout> = 'standard',
  stabilizeRows?: (rows: number) => number,
  motions: ReadonlyMap<string, CardMotionCue> = EMPTY_MOTIONS,
  laneFlashes: Readonly<Partial<Record<TodoStatus, number>>> = EMPTY_LANE_FLASHES,
): string[] {
  if (profile === 'tiny') {
    return renderLanes(todos, width, highlights, changedAtMs, motions);
  }
  return width >= BOARD_MIN_WIDTH
    ? renderBoard(todos, width, highlights, changedAtMs, stabilizeRows, motions, laneFlashes)
    : renderLanes(todos, width, highlights, changedAtMs, motions);
}

function renderBoard(
  todos: readonly TodoItem[],
  width: number,
  highlights: ReadonlyMap<string, TodoChangeKind>,
  changedAtMs: number | undefined,
  stabilizeRows?: (rows: number) => number,
  motions: ReadonlyMap<string, CardMotionCue> = EMPTY_MOTIONS,
  laneFlashes: Readonly<Partial<Record<TodoStatus, number>>> = EMPTY_LANE_FLASHES,
): string[] {
  const availableWidth = Math.max(1, width - visibleWidth(BOARD_INDENT));
  const columnWidth = Math.floor(
    (availableWidth - visibleWidth(BOARD_SEPARATOR) * (TODO_LANES.length - 1)) /
      TODO_LANES.length,
  );
  if (columnWidth < BOARD_COLUMN_MIN_WIDTH) {
    return renderLanes(todos, width, highlights, changedAtMs, motions);
  }

  const lanes = TODO_LANES.map((lane) => ({
    ...lane,
    todos: todos.filter((todo) => todo.status === lane.status),
  }));
  const rawMaxRows = Math.max(1, ...lanes.map((lane) => lane.todos.length));
  // Hysteresis: grow instantly but delay shrinks so lane hops do not bounce the height.
  const maxRows = stabilizeRows === undefined ? rawMaxRows : stabilizeRows(rawMaxRows);
  const separator = currentTheme.fg('border', BOARD_SEPARATOR);
  const columnRule = renderRendererDividerRow({
    width: columnWidth,
    style: (text) => currentTheme.fg('border', text),
  });
  const lines = [
    BOARD_INDENT + lanes
      .map((lane) =>
        padCell(
          renderLaneHeader(lane.label, lane.todos.length, lane.status, laneFlashes[lane.status]),
          columnWidth,
        ),
      )
      .join(separator),
    BOARD_INDENT + lanes
      .map(() => columnRule)
      .join(separator),
  ];

  for (let row = 0; row < maxRows; row++) {
    lines.push(
      BOARD_INDENT + lanes
        .map((lane) => {
          const todo = lane.todos[row];
          if (todo === undefined) {
            return padCell(currentTheme.fg('textMuted', 'No cards'), columnWidth);
          }
          const cue = motions.get(todo.title);
          const indent = motionSlideIndent(cue);
          const cell = renderCell(todo, highlights.get(todo.title), changedAtMs, cue);
          // The slide indent borrows from the cell's own right padding, so
          // neighbouring columns never shift.
          return indent === 0
            ? padCell(cell, columnWidth)
            : ' '.repeat(indent) + padCell(cell, columnWidth - indent);
        })
        .join(separator),
    );
  }
  return lines;
}

function renderLanes(
  todos: readonly TodoItem[],
  width: number,
  highlights: ReadonlyMap<string, TodoChangeKind>,
  changedAtMs: number | undefined,
  motions: ReadonlyMap<string, CardMotionCue> = EMPTY_MOTIONS,
): string[] {
  const lines: string[] = [];
  for (const lane of TODO_LANES) {
    const laneTodos = todos.filter((todo) => todo.status === lane.status);
    if (laneTodos.length === 0) continue;
    lines.push(currentTheme.fg('textDim', `  ${lane.label}`));
    for (const todo of laneTodos) {
      lines.push(
        ...renderWrappedCell(todo, highlights.get(todo.title), changedAtMs, width, motions.get(todo.title)),
      );
    }
  }
  return lines;
}

export function renderBoardMeta(
  todos: readonly TodoItem[],
  summary: TodoPanelChangeSummary | undefined,
  callsSinceUpdate: number,
): string {
  const counts = countTodos(todos);
  const total = todos.length;
  const ratio = total > 0 ? counts.done / total : 0;
  const wipText = `wip ${String(counts.in_progress)}/1`;
  const wip =
    counts.in_progress > 1
      ? currentTheme.boldFg('warning', wipText)
      : currentTheme.fg('textDim', wipText);
  const progress =
    total > 0
      ? `${renderRendererRatioProgressBar({
          ratio,
          width: 8,
          filledStyle: (text) => currentTheme.fg('success', text),
          emptyStyle: (text) => currentTheme.fg('textMuted', text),
        })}${currentTheme.fg('textDim', ` ${String(Math.round(ratio * 100))}%`)}`
      : undefined;
  const parts = [
    ...(progress !== undefined ? [progress] : []),
    wip,
    currentTheme.fg('textDim', `next ${String(counts.pending)}`),
    currentTheme.fg('textDim', `done ${String(counts.done)}`),
  ];
  const flow = summary === undefined ? undefined : formatChangeSummary(summary);
  if (flow !== undefined) {
    parts.unshift(currentTheme.fg('primary', `${renderShimmerPrefix()}flow ${flow}`));
  }
  if (callsSinceUpdate >= STALE_TOOL_CALLS) {
    parts.push(
      currentTheme.boldFg('warning', `stale · ${String(callsSinceUpdate)} calls since update`),
    );
  }
  return `  ${parts.join(currentTheme.fg('textMuted', ' · '))}`;
}

function renderLaneHeader(
  label: string,
  count: number,
  status: TodoStatus,
  countFlashStartedAtMs: number | undefined,
): string {
  const token = laneHeaderToken(status);
  const text = `${label} (${String(count)})`;
  const appearance = getActiveAppearancePreferences();
  // Count micro-feedback: a changed lane count briefly re-settles in its own
  // header tone. Resting bytes stay a single bold run when nothing flashes.
  if (
    countFlashStartedAtMs !== undefined &&
    shouldRenderAmbientEffects(appearance) &&
    isToneSettleFlashActive(countFlashStartedAtMs, appearance)
  ) {
    const countText = `(${String(count)})`;
    return `${currentTheme.boldFg(token, label)} ${renderToneSettleFlash(
      countText,
      `todo:lane-count:${status}`,
      countFlashStartedAtMs,
      token,
      appearance,
    )}`;
  }
  return currentTheme.boldFg(token, text);
}

function laneHeaderToken(status: TodoStatus): 'primary' | 'success' | 'textStrong' {
  switch (status) {
    case 'in_progress':
      return 'primary';
    case 'done':
      return 'success';
    case 'pending':
      return 'textStrong';
  }
}

function renderCell(
  todo: TodoItem,
  change: TodoChangeKind | undefined,
  changedAtMs: number | undefined,
  cue: CardMotionCue | undefined,
): string {
  const badge = changeBadge(change, cue);
  const marker = statusMarker(todo.status);
  const titleStyled = styleTitle(todo.title, todo.status, change, changedAtMs, cue);
  return `${badge}${marker} ${titleStyled}`;
}

function renderWrappedCell(
  todo: TodoItem,
  change: TodoChangeKind | undefined,
  changedAtMs: number | undefined,
  width: number,
  cue: CardMotionCue | undefined,
): string[] {
  const badge = changeBadge(change, cue);
  const marker = statusMarker(todo.status);
  const titleStyled = styleTitle(todo.title, todo.status, change, changedAtMs, cue);
  const firstPrefix = `${badge}${marker} `;
  const prefixWidth = visibleWidth(firstPrefix);
  const indent = motionSlideIndent(cue);
  const availableWidth = Math.max(
    1,
    width - visibleWidth(BOARD_INDENT) - prefixWidth - indent,
  );
  const titleLines =
    visibleWidth(titleStyled) <= availableWidth
      ? [titleStyled]
      : wrapTextWithAnsi(titleStyled, availableWidth);
  const slide = indent === 0 ? '' : ' '.repeat(indent);
  return titleLines.map((line, index) => {
    const prefix = index === 0 ? firstPrefix : ' '.repeat(prefixWidth);
    return `${BOARD_INDENT}${slide}${prefix}${line}`;
  });
}

function padCell(content: string, width: number): string {
  const truncated = truncateToWidth(content, width, '…');
  return truncated + ' '.repeat(Math.max(0, width - visibleWidth(truncated)));
}

function statusMarker(status: TodoStatus): string {
  switch (status) {
    case 'in_progress':
      return renderPulseGlyph(PULSE_ACTIVE_FRAMES, 'todo:in-progress', GOAL_DOT, 'primary');
    case 'done':
      return currentTheme.fg('success', '✓');
    case 'pending':
      return currentTheme.fg('textDim', PENDING_GLYPH);
  }
}

function styleTitle(
  title: string,
  status: TodoStatus,
  change: TodoChangeKind | undefined,
  changedAtMs: number | undefined,
  cue: CardMotionCue | undefined,
): string {
  const appearance = getActiveAppearancePreferences();
  const animatable = shouldRenderAmbientEffects(appearance);
  if (
    change !== undefined &&
    changedAtMs !== undefined &&
    animatable &&
    appearanceAnimationNow() - changedAtMs < changeFlashMs()
  ) {
    return renderSettleFlash(title, `todo:${change}:${title}`, changedAtMs, appearance);
  }
  if (cue !== undefined && animatable) {
    // Entrance settle for cards that surfaced without a change kind (e.g. an
    // overflow window shift); the change flash above already covers 'added'.
    if (cue.kind === 'enter' && isToneSettleFlashActive(cue.startedAtMs, appearance)) {
      return renderSettleFlash(title, `todo:enter:${title}`, cue.startedAtMs, appearance);
    }
    // Move transition: brand-color fade that decays into the resting style.
    if (cue.kind === 'move') {
      const p = cueProgress(cue.startedAtMs, moveCueMs());
      if (p < 0.35) return currentTheme.boldFg('primary', title);
      if (p < 0.7) return currentTheme.fg('primary', title);
    }
  }
  switch (status) {
    case 'in_progress':
      return currentTheme.boldFg('text', title);
    case 'done':
      return currentTheme.strikethroughFg('textDim', title);
    case 'pending':
      return currentTheme.fg('text', title);
  }
}

function changeBadge(change: TodoChangeKind | undefined, cue: CardMotionCue | undefined): string {
  const motion = motionBadge(cue);
  // A live directional badge subsumes the static moved arrow and is the only
  // badge for pure reorders (no change kind); semantic badges keep priority.
  if (motion !== '' && (change === undefined || change === 'moved')) return motion;
  if (change === undefined) return '';
  switch (change) {
    case 'added':
      return `${renderPulseGlyph([TODO_ADDED, '+'], 'todo:added', '+', 'accent')} `;
    case 'completed':
      return `${currentTheme.fg('success', TODO_COMPLETED)} `;
    case 'moved':
      return `${currentTheme.fg('primary', TODO_MOVED)} `;
    case 'reopened':
      return `${currentTheme.fg('warning', TODO_REOPENED)} `;
  }
}

/** Decaying directional glyph for moved cards; '' once settled or gated off. */
function motionBadge(cue: CardMotionCue | undefined): string {
  if (cue === undefined || cue.kind !== 'move') return '';
  const appearance = getActiveAppearancePreferences();
  if (!shouldRenderAmbientEffects(appearance)) return '';
  const p = cueProgress(cue.startedAtMs, moveCueMs());
  if (p >= 1) return '';
  const glyph =
    cue.direction === 'down'
      ? MOVE_GLYPH_DOWN
      : cue.direction === 'up'
        ? MOVE_GLYPH_UP
        : TODO_MOVED;
  return p < 0.5
    ? `${currentTheme.boldFg('primary', glyph)} `
    : `${currentTheme.fg('primary', glyph)} `;
}

/** Decaying slide-in indent (columns); 0 once settled or gated off. */
function motionSlideIndent(cue: CardMotionCue | undefined): number {
  if (cue === undefined) return 0;
  const appearance = getActiveAppearancePreferences();
  if (!shouldRenderAmbientEffects(appearance)) return 0;
  const p = cueProgress(cue.startedAtMs, moveCueMs());
  if (p < 0.35) return MOVE_SLIDE_MAX_INDENT;
  if (p < 0.7) return MOVE_SLIDE_MAX_INDENT - 1;
  return 0;
}

/**
 * One calm footer line under a windowed board: directional hidden counts —
 * `↑ 3 more · ↓ 5 more (2 done · 3 pending)` — in the legacy overflow
 * footer's dim tone, keeping the ctrl+t escape hatch advertised. Present
 * exactly while the board is windowed, so the panel height never varies
 * mid-scroll; at the very end only the `↑` half remains.
 */
export function renderBoardScrollIndicator(
  todos: readonly TodoItem[],
  offset: number,
  viewport: number,
): string {
  const laneSeen: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  const hiddenBelow: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  let above = 0;
  let below = 0;
  for (const todo of todos) {
    const index = laneSeen[todo.status];
    laneSeen[todo.status] = index + 1;
    if (index < offset) {
      above += 1;
    } else if (index >= offset + viewport) {
      below += 1;
      hiddenBelow[todo.status] += 1;
    }
  }
  const parts: string[] = [];
  if (above > 0) parts.push(`↑ ${String(above)} more`);
  if (below > 0) {
    const distribution = formatHiddenCounts(hiddenBelow);
    const suffix = distribution.length > 0 ? ` (${distribution})` : '';
    parts.push(`↓ ${String(below)} more${suffix}`);
  }
  return currentTheme.fg('textDim', `  ${parts.join(' · ')} · ctrl+t to expand`);
}

export function formatSwarmMemberTodoLines(
  todos: readonly TodoItem[],
  width: number,
  // Palette now comes from currentTheme; the parameter stays for cross-component callers.
  _colors: ColorPalette,
  _memberLabel?: string,
): string[] {
  if (todos.length === 0) return [];
  const visible = selectVisibleTodos(todos);
  const doing = visible.rows.find((todo) => todo.status === 'in_progress');
  const next = visible.rows.find((todo) => todo.status === 'pending');
  const doneCount = todos.filter((todo) => todo.status === 'done').length;
  const lines: string[] = [];
  if (doing !== undefined) {
    lines.push(
      ` ${currentTheme.fg('primary', '▸')} doing: ${truncateToWidth(doing.title, Math.max(8, width - 11), '…')}`,
    );
  }
  if (next !== undefined) {
    lines.push(
      ` ${currentTheme.fg('textDim', PENDING_GLYPH)} next: ${truncateToWidth(next.title, Math.max(8, width - 9), '…')}`,
    );
  }
  if (doneCount > 0) {
    lines.push(` ${currentTheme.fg('success', '✓')} done: ${String(doneCount)}`);
  }
  return lines.slice(0, 3);
}

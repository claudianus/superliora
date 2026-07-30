/**
 * Live subagent progress strip below the todo board lanes (Phase 5-B).
 * Tracks bounded rows keyed by subagent id and renders the compact
 * header + per-child ratio bar inside the panel frame.
 */
import {
  renderRendererRatioProgressBar,
  truncateToWidth,
  visibleWidth,
} from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import { currentTheme } from '#/tui/theme/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  isToneSettleFlashActive,
  renderSettleFlash,
  renderToneSettleFlash,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

import { BOARD_INDENT } from './todo-panel-render';
import type { SubagentStripEntry, SubagentTodosInput } from './todo-panel-types';

/**
 * Cap on tracked subagent rows. Finished subagents leave via lifecycle
 * events; the cap bounds the strip when completions are missed or many
 * children run at once — the earliest-entered rows are evicted first.
 */
const MAX_SUBAGENT_ROWS = 6;
const SUBAGENT_BAR_WIDTH = 6;

/** Mutable strip row; rebuilt in place on each `subagent.todo.updated`. */
interface SubagentStripRow {
  readonly subagentId: string;
  name: string;
  done: number;
  total: number;
  readonly enteredAtMs: number;
  /** Last count change; drives the count settle flash. */
  updatedAtMs: number;
}

export class TodoPanelSubagentStrip {
  private rows = new Map<string, SubagentStripRow>();
  /** Bumped on every strip mutation; joins the render memo key. */
  private version = 0;
  /** Removal feedback: the strip header re-settles when a row leaves. */
  private stripFlashAtMs: number | undefined;

  getVersion(): number {
    return this.version;
  }

  /**
   * Track one subagent's live todo progress on the strip below the lanes
   * (Phase 5-B). Idempotent per subagent id: new ids enter with the board's
   * entrance settle, count changes flash the count cell. Rows are bounded by
   * MAX_SUBAGENT_ROWS; lifecycle completion removes them explicitly.
   */
  setTodos(input: SubagentTodosInput): void {
    const done = input.todos.filter((todo) => todo.status === 'done').length;
    const total = input.todos.length;
    const now = appearanceAnimationNow();
    const existing = this.rows.get(input.subagentId);
    if (existing !== undefined) {
      existing.name = input.name;
      if (existing.done !== done || existing.total !== total) {
        existing.done = done;
        existing.total = total;
        existing.updatedAtMs = now;
      }
    } else {
      this.rows.set(input.subagentId, {
        subagentId: input.subagentId,
        name: input.name,
        done,
        total,
        enteredAtMs: now,
        updatedAtMs: now,
      });
      this.evictExcessRows();
    }
    this.version += 1;
  }

  /**
   * Drop a finished subagent's strip row. Returns true when a row left, so
   * callers can request a frame; the removal flashes the strip header with
   * the board's settle-flash feedback.
   */
  remove(subagentId: string): boolean {
    if (!this.rows.delete(subagentId)) return false;
    this.stripFlashAtMs = appearanceAnimationNow();
    this.version += 1;
    return true;
  }

  clear(): void {
    if (this.rows.size === 0 && this.stripFlashAtMs === undefined) return;
    this.rows = new Map();
    this.stripFlashAtMs = undefined;
    this.version += 1;
  }

  reset(): void {
    this.rows = new Map();
    this.stripFlashAtMs = undefined;
  }

  /** Strip snapshot in display order (insertion order), for tests/inspection. */
  getStrip(): readonly SubagentStripEntry[] {
    return [...this.rows.values()].map(({ subagentId, name, done, total }) => ({
      subagentId,
      name,
      done,
      total,
    }));
  }

  /**
   * True while any strip settle flash is live. Gated on ambient effects so
   * off / SSH / NO_COLOR / CI sessions never emit time-driven frames — the
   * strip stays information-only there.
   */
  isAnimating(): boolean {
    if (this.rows.size === 0 && this.stripFlashAtMs === undefined) return false;
    const appearance = getActiveAppearancePreferences();
    if (!shouldRenderAmbientEffects(appearance)) return false;
    if (
      this.stripFlashAtMs !== undefined &&
      isToneSettleFlashActive(this.stripFlashAtMs, appearance)
    ) {
      return true;
    }
    for (const row of this.rows.values()) {
      if (isToneSettleFlashActive(row.enteredAtMs, appearance)) return true;
      if (isToneSettleFlashActive(row.updatedAtMs, appearance)) return true;
    }
    return false;
  }

  /**
   * Compact strip under the three lanes: header plus one row per tracked
   * subagent (short name, mini ratio bar, done/total). Reuses the board's
   * settle flash for entrance, count changes, and removal feedback; with
   * ambient effects gated off every byte is static.
   */
  render(contentWidth: number): string[] {
    if (this.rows.size === 0) return [];
    const appearance = getActiveAppearancePreferences();
    const animatable = shouldRenderAmbientEffects(appearance);
    const headerText = `subagents (${String(this.rows.size)})`;
    const header =
      animatable &&
      this.stripFlashAtMs !== undefined &&
      isToneSettleFlashActive(this.stripFlashAtMs, appearance)
        ? renderToneSettleFlash(
            headerText,
            'todo:subagent-strip',
            this.stripFlashAtMs,
            'primary',
            appearance,
          )
        : currentTheme.boldFg('textStrong', headerText);
    const lines = [`${BOARD_INDENT}${header}`];
    for (const row of this.rows.values()) {
      lines.push(this.renderRow(row, contentWidth, animatable, appearance));
    }
    return lines;
  }

  /** Keep the strip bounded: drop earliest-entered rows past the cap. */
  private evictExcessRows(): void {
    while (this.rows.size > MAX_SUBAGENT_ROWS) {
      // Map iterates in insertion order; updates never reorder, so the first
      // key is the earliest-entered row.
      const oldest = this.rows.keys().next();
      if (oldest.done === true) break;
      this.rows.delete(oldest.value);
    }
  }

  private renderRow(
    row: SubagentStripRow,
    contentWidth: number,
    animatable: boolean,
    appearance: AppearancePreferences,
  ): string {
    const ratio = row.total > 0 ? row.done / row.total : 0;
    const bar = renderRendererRatioProgressBar({
      ratio,
      width: SUBAGENT_BAR_WIDTH,
      filledStyle: (text) => currentTheme.fg('success', text),
      emptyStyle: (text) => currentTheme.fg('textMuted', text),
    });
    const countText = `${String(row.done)}/${String(row.total)}`;
    const count =
      animatable && isToneSettleFlashActive(row.updatedAtMs, appearance)
        ? renderToneSettleFlash(
            countText,
            `todo:subagent-count:${row.subagentId}`,
            row.updatedAtMs,
            'primary',
            appearance,
          )
        : row.total > 0 && row.done === row.total
          ? currentTheme.fg('success', countText)
          : currentTheme.fg('textDim', countText);
    // ` ▸ ` before the name, then ` <bar> <count>` after it.
    const suffixWidth = 1 + SUBAGENT_BAR_WIDTH + 1 + countText.length;
    const nameWidth = Math.max(
      8,
      contentWidth - visibleWidth(BOARD_INDENT) - 2 - suffixWidth,
    );
    const displayName = truncateToWidth(row.name, nameWidth, '…');
    const name =
      animatable && isToneSettleFlashActive(row.enteredAtMs, appearance)
        ? renderSettleFlash(
            displayName,
            `todo:subagent:${row.subagentId}`,
            row.enteredAtMs,
            appearance,
          )
        : currentTheme.fg('text', displayName);
    return `${BOARD_INDENT}${currentTheme.fg('primary', '▸')} ${name} ${bar} ${count}`;
  }
}

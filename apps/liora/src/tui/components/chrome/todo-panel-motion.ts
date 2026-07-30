/**
 * Card-motion and lane-count flash tracking for the todo board. Rebuilt from
 * the currently rendered cards on each list update so titles that leave the
 * board drop out automatically.
 */
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

import { cardPositions, countTodos, type CardPosition, type TodoChangeKind } from './todo-panel-model';
import { EMPTY_LANE_FLASHES, EMPTY_MOTIONS, type CardMotionCue } from './todo-panel-render';
import type { TodoItem, TodoStatus } from './todo-panel-types';

const TODO_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'done'];

export class TodoPanelMotionTracker {
  private lastPositions = new Map<string, CardPosition>();
  private motionCues = new Map<string, CardMotionCue>();
  /** State the motion cues were captured for; identity-checked per render. */
  private positionBase:
    | { readonly todos: readonly TodoItem[]; readonly expanded: boolean }
    | undefined;
  private lastLaneCounts: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  private laneCountFlashes: Partial<Record<TodoStatus, number>> = {};

  reset(): void {
    this.lastPositions = new Map();
    this.motionCues = new Map();
    this.positionBase = undefined;
    this.lastLaneCounts = { done: 0, in_progress: 0, pending: 0 };
    this.laneCountFlashes = {};
  }

  updateLaneCountFlashes(next: readonly TodoItem[]): void {
    const counts = countTodos(next);
    const now = appearanceAnimationNow();
    for (const status of TODO_STATUSES) {
      if (counts[status] !== this.lastLaneCounts[status]) {
        this.laneCountFlashes[status] = now;
      }
    }
    this.lastLaneCounts = counts;
  }

  currentMotionCues(): ReadonlyMap<string, CardMotionCue> {
    if (this.motionCues.size === 0) return EMPTY_MOTIONS;
    return shouldRenderAmbientEffects(getActiveAppearancePreferences())
      ? this.motionCues
      : EMPTY_MOTIONS;
  }

  currentLaneFlashes(): Readonly<Partial<Record<TodoStatus, number>>> {
    return shouldRenderAmbientEffects(getActiveAppearancePreferences())
      ? this.laneCountFlashes
      : EMPTY_LANE_FLASHES;
  }

  /**
   * Diff rendered card positions once per (list, expanded) state and derive
   * motion cues: `enter` for cards newly visible (first appearance or
   * overflow window shift), `move` with a row direction for lane/index
   * travel. Expand/collapse recaptures positions silently — a viewport
   * change is not a card move.
   */
  refreshMotionCues(
    todos: readonly TodoItem[],
    expanded: boolean,
    rendered: readonly TodoItem[],
    changedAtMs: number | undefined,
  ): void {
    const base = this.positionBase;
    if (base !== undefined && base.todos === todos && base.expanded === expanded) {
      return;
    }
    const nextPositions = cardPositions(rendered);
    const stateChanged = base !== undefined && base.todos !== todos;
    if (stateChanged && changedAtMs !== undefined) {
      const cues = new Map<string, CardMotionCue>();
      for (const [title, position] of nextPositions) {
        const previous = this.lastPositions.get(title);
        if (previous === undefined) {
          cues.set(title, { kind: 'enter', startedAtMs: changedAtMs });
          continue;
        }
        if (previous.lane !== position.lane || previous.row !== position.row) {
          cues.set(title, {
            kind: 'move',
            direction:
              position.row > previous.row
                ? 'down'
                : position.row < previous.row
                  ? 'up'
                  : undefined,
            startedAtMs: changedAtMs,
          });
        }
      }
      this.motionCues = cues;
    } else {
      this.motionCues = new Map();
    }
    this.lastPositions = nextPositions;
    this.positionBase = { todos, expanded };
  }
}

/** Empty highlight map when the change flash has expired. */
export const EMPTY_HIGHLIGHTS: ReadonlyMap<string, TodoChangeKind> = new Map();

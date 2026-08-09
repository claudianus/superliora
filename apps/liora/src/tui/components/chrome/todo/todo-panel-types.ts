/** Shared todo-panel data shapes used by the coordinator, model, and render modules. */

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  readonly title: string;
  readonly status: TodoStatus;
}

/**
 * Virtual-scroll input for the collapsed board. Line actions move one board
 * row (wheel ticks, alt+arrows); page actions move a viewport minus one so
 * consecutive pages overlap by a row; top / bottom jump to the edges.
 */
export type TodoBoardScrollAction =
  | 'line-up'
  | 'line-down'
  | 'page-up'
  | 'page-down'
  | 'top'
  | 'bottom';

/** Scroll position of the windowed board, for tests / inspection. */
export interface TodoBoardScrollSnapshot {
  readonly offset: number;
  readonly viewport: number;
  readonly total: number;
}

/** Optional Worker Dock link for the FOCUS strip. */
export interface TodoFocusLink {
  readonly worker: string;
  readonly tool?: string;
  readonly target?: string;
}

/**
 * Host environment for the board's virtual scroll. `terminalRows` lends the
 * panel a height budget; without it (tests, headless callers) the collapsed
 * board keeps the legacy MAX_VISIBLE selection byte-for-byte.
 * `resolveFocusLink` injects the live worker/tool for the FOCUS row.
 */
export interface TodoPanelOptions {
  readonly terminalRows?: () => number;
  readonly resolveFocusLink?: () => TodoFocusLink | undefined;
}

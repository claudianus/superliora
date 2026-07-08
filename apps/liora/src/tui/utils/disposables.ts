/**
 * Central dispose registry for the TUI.
 *
 * The `LioraTUI` orchestrator and its controllers own many timers, intervals,
 * listeners, and watchers. Without a single registry, `stop()` had to know
 * about each one individually — and several were missed (the footer goal timer,
 * the tasks-browser poll timer, the queued-goal-promotion timer, the detach-hint
 * timer), causing leaks into a stopped renderer.
 *
 * Every owner registers its cleanup callback here; `stop()` then calls
 * `disposeAll()` once. Registration returns an `unregister` callback so a
 * caller that clears its own resource early (e.g. a timer that fired normally)
 * can drop the stale disposer without leaving a dead entry.
 *
 * Disposers run in reverse registration order (LIFO), mirroring stack unwind.
 */

export type Disposer = () => void;

export class DisposableRegistry {
  private readonly items: Disposer[] = [];
  private disposed = false;

  /** Register a cleanup callback. Returns an `unregister` function. */
  register(dispose: Disposer): Disposer {
    if (this.disposed) {
      // Already torn down — run immediately so the resource does not leak.
      dispose();
      return () => {};
    }
    this.items.push(dispose);
    return () => {
      const index = this.items.indexOf(dispose);
      if (index >= 0) this.items.splice(index, 1);
    };
  }

  /** Run every registered disposer in reverse order, exactly once. */
  disposeAll(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.items.splice(0).reverse()) {
      try {
        dispose();
      } catch {
        // A failing disposer must not prevent the rest from running.
      }
    }
  }

  /** True once {@link disposeAll} has been called. */
  get isDisposed(): boolean {
    return this.disposed;
  }
}

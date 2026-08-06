/**
 * Base class for promise-based reverse RPC dialog controllers.
 *
 * Approval and question flows wait for a UI action before returning a response.
 * Subclasses only need to define the default cancellation response.
 *
 * When concurrent requests arrive (e.g. multiple parallel subagents each
 * needing approval), only one panel is shown at a time; additional requests
 * are queued in arrival order and advance after the current one resolves.
 */

export interface ReverseRpcUIHooks<TPayload> {
  showPanel(payload: TPayload): void;
  hidePanel(): void;
}

export interface ReverseRpcShowOptions {
  readonly signal?: AbortSignal | undefined;
}

interface Pending<TPayload, TResponse> {
  readonly payload: TPayload;
  readonly resolve: (data: TResponse) => void;
  abortCleanup?: (() => void) | undefined;
}

export abstract class ReverseRpcController<TPayload, TResponse> {
  private uiHooks: ReverseRpcUIHooks<TPayload> | null = null;
  private current: Pending<TPayload, TResponse> | null = null;
  private queue: Array<Pending<TPayload, TResponse>> = [];

  setUIHooks(hooks: ReverseRpcUIHooks<TPayload>): void {
    this.uiHooks = hooks;
  }

  /**
   * Called when a reverse RPC request arrives from core. The returned promise
   * resolves after the user responds or `cancelAll` forces cancellation.
   */
  show(payload: TPayload, options: ReverseRpcShowOptions = {}): Promise<TResponse> {
    return new Promise<TResponse>((resolve) => {
      const entry: Pending<TPayload, TResponse> = { payload, resolve };
      const signal = options.signal;
      if (signal?.aborted === true) {
        resolve(this.createCancelResponse(String(signal.reason ?? 'aborted')));
        return;
      }
      if (signal !== undefined) {
        const onAbort = (): void => {
          this.cancelEntry(entry, String(signal.reason ?? 'aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.abortCleanup = () => {
          signal.removeEventListener('abort', onAbort);
        };
      }
      if (this.current === null) {
        this.current = entry;
        this.uiHooks?.showPanel(payload);
      } else {
        this.queue.push(entry);
      }
    });
  }

  /** Called by the UI after the user makes a panel choice. */
  respond(data: TResponse): void {
    const pending = this.current;
    this.current = null;
    if (pending !== null) {
      pending.abortCleanup?.();
      pending.abortCleanup = undefined;
      pending.resolve(data);
      this.drainAutoResolved(pending.payload, data);
    }
    this.advanceOrHide();
  }

  /** Cancels all pending requests during shutdown or session switches. */
  cancelAll(reason: string): void {
    const all = [...(this.current === null ? [] : [this.current]), ...this.queue];
    this.current = null;
    this.queue = [];
    this.uiHooks?.hidePanel();
    for (const entry of all) {
      entry.abortCleanup?.();
      entry.abortCleanup = undefined;
      entry.resolve(this.createCancelResponse(reason));
    }
  }

  hasPending(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  private cancelEntry(entry: Pending<TPayload, TResponse>, reason: string): void {
    if (this.current === entry) {
      this.respond(this.createCancelResponse(reason));
      return;
    }
    const queuedIndex = this.queue.indexOf(entry);
    if (queuedIndex < 0) return;
    this.queue.splice(queuedIndex, 1);
    entry.abortCleanup?.();
    entry.abortCleanup = undefined;
    entry.resolve(this.createCancelResponse(reason));
  }

  private advanceOrHide(): void {
    const next = this.queue.shift();
    if (next === undefined) {
      this.uiHooks?.hidePanel();
      return;
    }
    this.current = next;
    this.uiHooks?.showPanel(next.payload);
  }

  private drainAutoResolved(resolvedPayload: TPayload, response: TResponse): void {
    const remaining: Array<Pending<TPayload, TResponse>> = [];
    for (const entry of this.queue) {
      const auto = this.autoResolveFor(resolvedPayload, response, entry.payload);
      if (auto === undefined) {
        remaining.push(entry);
      } else {
        entry.abortCleanup?.();
        entry.abortCleanup = undefined;
        entry.resolve(auto);
      }
    }
    this.queue = remaining;
  }

  /**
   * Subclasses override to short-circuit queued requests when an answer to the
   * just-resolved one (e.g. an approve-for-session) implies the same answer
   * for matching queued requests. Return `undefined` to leave the queued
   * request waiting for its own panel turn.
   */
  protected autoResolveFor(
    _resolvedPayload: TPayload,
    _response: TResponse,
    _queuedPayload: TPayload,
  ): TResponse | undefined {
    return undefined;
  }

  protected abstract createCancelResponse(reason: string): TResponse;
}

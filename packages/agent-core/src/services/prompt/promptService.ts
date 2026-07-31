/**
 * `PromptService` — implementation of `IPromptService`.
 */

import { Disposable, InstantiationType, registerSingleton } from '../../di';
import { Emitter } from '../../base/common/event';
import type {
  Event,
  PromptListResponse,
  PromptSubmission,
  PromptSteerResult,
  PromptSubmitResult,
} from '@superliora/protocol';
import { ulid } from 'ulid';

import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IAuthSummaryService } from '../authSummary/authSummary';
import { IEventService } from '../event/event';
import { ILogService } from '../logger/logger';
import { ISessionService, SessionNotFoundError } from '../session/session';
import {
  IPromptService,
  PromptNotFoundError,
  PromptAlreadyCompletedError,
  type AgentStatePatch,
  type AgentStateSnapshot,
  type AgentStateSource,
  type PromptAbortResult,
  type PromptDispatchLogEntry,
  type SyntheticPromptCompletedEvent,
  type SyntheticPromptAbortedEvent,
  type SyntheticPromptSteeredEvent,
  type SyntheticPromptSubmittedEvent,
} from './prompt';
import {
  applyAgentStateInternal,
  ensureAgentStateBootstrapped,
  type PromptAgentStateStore,
} from './promptAgentStateDispatch';
import { hasAnyAgentStateField, pickAgentStatePatch } from './promptAgentStatePatch';
import { contentToCoreParts, steerContentToCoreParts } from './promptContent';
import { handlePromptBusEvent } from './promptLifecycle';
import {
  MAIN_AGENT_ID,
  promptKey,
  toPromptItem,
  type PromptState,
} from './promptState';

export class PromptService
  extends Disposable
  implements IPromptService
{
  readonly _serviceBrand: undefined;

  /** Active prompt per session. Cleared on completion / abort emission. */
  private readonly _active = new Map<string, PromptState>();

  private readonly _queued = new Map<string, PromptState[]>();

  /**
   * Per-session shadow of `model` / `thinking` / `permissionMode` /
   * `planMode`. Absent until first `submit` bootstraps. See
   * `_bootstrapAgentState` + `_applyAgentState`.
   */
  private readonly _agentState = new Map<string, AgentStateSnapshot>();

  /**
   * Per-session ring buffer of stateless-control setter dispatches.
   * Each entry records `{ts, kind, payload, promptId}` immediately after
   * the underlying `core.rpc.*` setter resolves inside `_applyAgentState`.
   * The buffer is capped at `DISPATCH_LOG_CAP`; on overflow the oldest
   * entry is dropped. Cleared on `ISessionService.onDidClose` together
   * with the shadow. Exposed via `_dispatchLogForTest` for the daemon's
   * `/debug/prompts/{sid}/dispatch-log` route + unit tests — never read
   * on the hot path.
   */
  private readonly _dispatchLog = new Map<string, PromptDispatchLogEntry[]>();

  /**
   * VSCode-style Emitter for `prompt.completed` synthetic events. Listener
   * exceptions route to `onUnexpectedError` inside `Emitter.fire()`. Owned
   * via `_register(...)` so it disposes when PromptService is torn down.
   */
  private readonly _onDidComplete = this._register(
    new Emitter<SyntheticPromptCompletedEvent>(),
  );
  readonly onDidComplete = this._onDidComplete.event;
  /**
   * VSCode-style Emitter for `prompt.aborted` synthetic events. Same
   * ownership + exception-routing semantics as `_onDidComplete`.
   */
  private readonly _onDidAbort = this._register(
    new Emitter<SyntheticPromptAbortedEvent>(),
  );
  readonly onDidAbort = this._onDidAbort.event;

  constructor(
    @ICoreProcessService private readonly core: ICoreProcessService,
    @IEventService private readonly eventService: IEventService,
    @IAuthSummaryService private readonly auth: IAuthSummaryService,
    @ISessionService private readonly sessionService: ISessionService,
    @ILogService private readonly _logger: ILogService,
  ) {
    super();
    // Self-subscribe to the event stream for lifecycle synthesis.
    // `onDidPublish` is the VSCode-style accessor — calling it registers
    // `_handleBusEvent` and returns an `IDisposable` that detaches when
    // disposed. We register it through `this._register(...)` so the
    // listener tears down when PromptService disposes (which happens BEFORE
    // the event service disposes per start.ts wiring order). Re-entrance
    // is safe: synthesised `prompt.*` events don't match the `turn.*`
    // predicates below.
    this._register(
      this.eventService.onDidPublish(this._handleBusEvent.bind(this)),
    );
    // Drop the per-session shadow when a session closes so the next
    // submit for a freshly-recreated session re-bootstraps cleanly.
    this._register(
      this.sessionService.onDidClose(({ sessionId }) => {
        this._agentState.delete(sessionId);
        this._dispatchLog.delete(sessionId);
        for (const key of this._queued.keys()) {
          if (key.startsWith(`${sessionId}\u0000`)) this._queued.delete(key);
        }
      }),
    );
  }

  // --- IPromptService --------------------------------------------------------

  async list(sid: string): Promise<PromptListResponse> {
    await this._requireSession(sid);
    const key = promptKey(sid, MAIN_AGENT_ID);
    const active = this._active.get(key);
    return {
      active:
        active !== undefined && !active.completed && !active.aborted
          ? toPromptItem(active, 'running')
          : null,
      queued: (this._queued.get(key) ?? []).map((state) =>
        toPromptItem(state, 'queued'),
      ),
    };
  }

  async submit(sid: string, body: PromptSubmission): Promise<PromptSubmitResult> {
    await this._requireSession(sid);
    await this.core.rpc.resumeSession({ sessionId: sid });

    // Readiness gate. Throws AuthProvisioningRequired /
    // AuthTokenMissing / AuthModelNotResolved before we mint a prompt_id and
    // hand off to agent-core. Daemon route layer maps to 40110/40111/40113.
    await this.auth.ensureReady();

    const promptId = `prompt_${ulid()}`;
    const state = this._createPromptState(sid, promptId, body);
    const key = promptKey(sid, state.agentId);

    const existing = this._active.get(key);
    if (existing !== undefined && !existing.completed && !existing.aborted) {
      this._enqueue(sid, state);
      const item = toPromptItem(state, 'queued');
      this._publishSubmitted(sid, state, item);
      return item;
    }

    const item = toPromptItem(state, 'running');
    await this._startPrompt(sid, state, () => {
      this._publishSubmitted(sid, state, item);
    });
    return item;
  }

  async startBtw(sid: string): Promise<string> {
    await this._requireSession(sid);
    await this.core.rpc.resumeSession({ sessionId: sid });
    await this.auth.ensureReady();
    return this.core.rpc.startBtw({ sessionId: sid, agentId: MAIN_AGENT_ID });
  }

  async steer(sid: string, promptIds: readonly string[]): Promise<PromptSteerResult> {
    await this._requireSession(sid);
    if (promptIds.length === 0) {
      throw new PromptNotFoundError(sid, '');
    }
    const key = promptKey(sid, MAIN_AGENT_ID);
    const active = this._active.get(key);
    if (active === undefined || active.completed || active.aborted) {
      throw new PromptNotFoundError(sid, promptIds[0]!);
    }

    const queue = this._queued.get(key) ?? [];
    const selected: PromptState[] = [];
    for (const promptId of promptIds) {
      const state = queue.find((item) => item.promptId === promptId);
      if (state === undefined) {
        throw new PromptNotFoundError(sid, promptId);
      }
      selected.push(state);
    }

    const selectedIds = new Set(promptIds);
    const remaining = queue.filter((item) => !selectedIds.has(item.promptId));
    this._replaceQueue(sid, MAIN_AGENT_ID, remaining);

    try {
      await this.core.rpc.steer({
        sessionId: sid,
        agentId: MAIN_AGENT_ID,
        input: steerContentToCoreParts(selected),
      });
    } catch (error) {
      this._restoreSteeredQueueItems(sid, selected);
      throw error;
    }

    const event: SyntheticPromptSteeredEvent = {
      type: 'prompt.steered',
      agentId: MAIN_AGENT_ID,
      sessionId: sid,
      activePromptId: active.promptId,
      promptIds: [...promptIds],
      content: selected.flatMap((state) => state.body.content),
      steeredAt: new Date().toISOString(),
    };
    this.eventService.publish(event as unknown as Event);
    return { steered: true, prompt_ids: [...promptIds] };
  }

  private async _startPrompt(
    sid: string,
    state: PromptState,
    onStarted?: () => void,
  ): Promise<void> {
    const overridePatch = state.agentId === MAIN_AGENT_ID ? pickAgentStatePatch(state.body) : undefined;
    if (overridePatch !== undefined) {
      await this._ensureAgentStateBootstrapped(sid);
      await this._applyAgentStateInternal(sid, overridePatch, 'prompt', state.promptId);
    }

    const key = promptKey(sid, state.agentId);
    this._active.set(key, state);
    const input = contentToCoreParts(state.body.content);
    onStarted?.();

    // Fire-and-forget. agent-core streams events via the SDK side of the
    // RPC pair which lands on `BridgeClientAPI.emitEvent → IEventService.publish`.
    // The submit RPC returns synchronously (PromptPayload → void); errors
    // would manifest as later `error` events, not as a rejection here.
    try {
      this._logger.debug(
        { sid, promptId: state.promptId, agentId: state.agentId, partCount: input.length },
        '[DBG prompt-service.submit] -> core.rpc.prompt(...)',
      );
      await this.core.rpc.prompt({
        sessionId: sid,
        agentId: state.agentId,
        input,
      });
      this._logger.debug(
        { sid, promptId: state.promptId },
        '[DBG prompt-service.submit] core.rpc.prompt(...) resolved',
      );
    } catch (error) {
      // Clear our active-prompt state so the next submit succeeds; surface
      // the error to the route layer.
      if (this._active.get(key)?.promptId === state.promptId) {
        this._active.delete(key);
      }
      this._logger.debug(
        { sid, promptId: state.promptId, err: (error as Error)?.message ?? error },
        '[DBG prompt-service.submit] core.rpc.prompt(...) threw',
      );
      throw error;
    }
  }

  private _publishSubmitted(sid: string, state: PromptState, item: PromptSubmitResult): void {
    const event: SyntheticPromptSubmittedEvent = {
      type: 'prompt.submitted',
      agentId: state.agentId,
      sessionId: sid,
      promptId: item.prompt_id,
      userMessageId: item.user_message_id,
      status: item.status,
      content: item.content,
      createdAt: item.created_at,
    };
    this.eventService.publish(event);
  }

  private _publishAborted(sid: string, agentId: string, pid: string): void {
    const ev: SyntheticPromptAbortedEvent = {
      type: 'prompt.aborted',
      agentId,
      sessionId: sid,
      promptId: pid,
      abortedAt: new Date().toISOString(),
    };
    // Fire typed listeners BEFORE publishing the synth event: PromptService
    // must still trigger the typed event THEN call publish() for the synthetic
    // event.
    this._onDidAbort.fire(ev);
    this.eventService.publish(ev as unknown as Event);
  }

  async abort(sid: string, pid: string): Promise<PromptAbortResult> {
    await this._requireSession(sid);
    const key = promptKey(sid, MAIN_AGENT_ID);
    const state = this._active.get(key);
    if (state !== undefined && state.promptId === pid) {
      if (state.completed || state.aborted) {
        throw new PromptAlreadyCompletedError(sid, pid);
      }
      // Mark aborted optimistically — _handleBusEvent will not re-synthesize.
      state.aborted = true;
      try {
        const cancelArgs: { sessionId: string; agentId: string; turnId?: number } = {
          sessionId: sid,
          agentId: state.agentId,
        };
        if (state.turnId !== null) cancelArgs.turnId = state.turnId;
        await this.core.rpc.cancel(cancelArgs);
      } catch (error) {
        // Roll back the optimistic flag so the route surfaces a real error;
        // the caller will see a 50001 (internal) via the global error handler.
        state.aborted = false;
        throw error;
      }
      this._publishAborted(sid, state.agentId, pid);
      return { aborted: true };
    }

    // Queued prompt: remove it from the queue and synthesize prompt.aborted.
    // No core RPC is needed because the prompt was never dispatched.
    const queue = this._queued.get(key) ?? [];
    const index = queue.findIndex((item) => item.promptId === pid);
    if (index === -1) {
      throw new PromptNotFoundError(sid, pid);
    }
    queue.splice(index, 1);
    if (queue.length === 0) {
      this._queued.delete(key);
    }
    this._publishAborted(sid, MAIN_AGENT_ID, pid);
    return { aborted: true };
  }

  async abortBySession(sid: string): Promise<PromptAbortResult> {
    await this._requireSession(sid);
    const state = this._active.get(promptKey(sid, MAIN_AGENT_ID));
    if (state !== undefined && !state.completed && !state.aborted) {
      // Normal prompt path: let abort() handle turnId mapping and event synthesis.
      return this.abort(sid, state.promptId);
    }
    // No daemon-managed active prompt. Cancel whatever agent-core turn is
    // running (e.g. a skill activation) without requiring a turnId.
    // TurnFlow.cancel(undefined) is a safe no-op when idle.
    await this.core.rpc.cancel({ sessionId: sid, agentId: MAIN_AGENT_ID });
    return { aborted: true };
  }

  getCurrentPromptId(sid: string): string | undefined {
    const state = this._active.get(promptKey(sid, MAIN_AGENT_ID));
    if (state === undefined || state.completed || state.aborted) {
      return undefined;
    }
    return state.promptId;
  }

  /**
   * `IPromptService.applyAgentState` — entry point shared by
   * `submit` (per-turn override) and `SessionService.update`
   * (`POST /sessions/{sid}/profile`). Validates the session exists,
   * bootstraps the shadow lazily, then diff-dispatches each non-shadow
   * field through the matching `core.rpc.*` setter. Dispatch-log
   * entries are tagged with the `source` so downstream observers can
   * tell prompt-driven and profile-driven setters apart.
   *
   * No-op when every field matches the shadow; throws on setter failure
   * (the caller / route layer surfaces the error). Empty `patch` is
   * accepted and bootstraps nothing — useful for SessionService.update
   * paths that need to no-op cleanly when the body carries no runtime
   * controls.
   */
  async applyAgentState(
    sid: string,
    patch: AgentStatePatch,
    source: AgentStateSource,
    promptId?: string,
  ): Promise<void> {
    if (!hasAnyAgentStateField(patch)) return;
    await this._requireSession(sid);
    await this._ensureAgentStateBootstrapped(sid);
    await this._applyAgentStateInternal(sid, patch, source, promptId ?? '');
  }

  // --- IPromptService typed event accessors ---------------------------------
  //
  // `onDidComplete` / `onDidAbort` are declared above as `Emitter<T>.event`
  // getters; consumers subscribe via `svc.onDidComplete(handler)` (returns
  // IDisposable) and own the detach lifetime through
  // `Disposable._register(...)`.

  // --- Stateless session controls (per-request diff dispatch) ---------------

  private _agentStateStore(): PromptAgentStateStore {
    return { agentState: this._agentState, dispatchLog: this._dispatchLog };
  }

  private async _ensureAgentStateBootstrapped(sid: string): Promise<void> {
    await ensureAgentStateBootstrapped(this.core, this._agentStateStore(), sid);
  }

  private async _applyAgentStateInternal(
    sid: string,
    patch: AgentStatePatch,
    source: AgentStateSource,
    promptId: string,
  ): Promise<void> {
    await applyAgentStateInternal(
      this.core,
      this._agentStateStore(),
      sid,
      patch,
      source,
      promptId,
    );
  }

  // --- Private event handler (replaces IPromptLifecycleObserver) ----------

  private _handleBusEvent(event: Event): void {
    handlePromptBusEvent(
      {
        active: this._active,
        agentState: this._agentState,
        eventService: this.eventService,
        onDidCompleteFire: (ev) =>{  this._onDidComplete.fire(ev); },
        onDidAbortFire: (ev) =>{  this._onDidAbort.fire(ev); },
        startNextQueued: (sid, agentId) => {
          void this._startNextQueued(sid, agentId);
        },
      },
      event,
    );
  }

  /**
   * Test helper — peek at active prompt state.
   */
  _activeForTest(sid: string): Readonly<PromptState> | undefined {
    const state = this._active.get(promptKey(sid, MAIN_AGENT_ID));
    return state === undefined ? undefined : { ...state };
  }

  /**
   * Read the current runtime-controls shadow for a session, if it has been
   * bootstrapped. Returns a copy so callers cannot mutate internal state.
   */
  getAgentStateSnapshot(sid: string): AgentStateSnapshot | undefined {
    const snap = this._agentState.get(sid);
    return snap === undefined ? undefined : { ...snap };
  }

  /**
   * Test helper — peek at the per-session stateless-controls shadow.
   * Undefined before first submit on a session.
   */
  _agentStateForTest(sid: string): Readonly<AgentStateSnapshot> | undefined {
    return this.getAgentStateSnapshot(sid);
  }

  /**
   * Test / debug helper — return the per-session dispatch-log ring buffer
   * (newest-last). Returns `undefined` when the session has never
   * triggered a setter; an empty array means "saw submits but every
   * field matched the shadow". The daemon's `/debug/prompts/{sid}/dispatch-log`
   * route consumes this; unit tests assert against it directly.
   */
  _dispatchLogForTest(sid: string): readonly PromptDispatchLogEntry[] | undefined {
    const buf = this._dispatchLog.get(sid);
    if (buf === undefined) return undefined;
    // Defensive copy — callers may iterate while a parallel submit
    // pushes new entries.
    return buf.slice();
  }

  /**
   * Test helper — inject an active prompt record. Used by daemon e2e tests
   * that need to exercise the lifecycle-synthesis path WITHOUT driving a
   * real `core.rpc.prompt(...)` call (which would require an in-memory
   * LioraCore loaded with provider credentials). Not part of the public
   * contract; the underscore prefix is a "do not use in prod" signal.
   */
  _injectActiveForTest(sid: string, promptId: string, turnId: number | null): void {
    this._active.set(promptKey(sid, MAIN_AGENT_ID), {
      agentId: MAIN_AGENT_ID,
      promptId,
      userMessageId: `msg_${sid}_pending_${promptId}`,
      body: { content: [{ type: 'text', text: 'test' }] },
      createdAt: new Date().toISOString(),
      turnId,
      completed: false,
      aborted: false,
    });
  }

  // --- internals -----------------------------------------------------------

  private _createPromptState(
    sid: string,
    promptId: string,
    body: PromptSubmission,
  ): PromptState {
    return {
      agentId: body.agent_id ?? MAIN_AGENT_ID,
      promptId,
      userMessageId: `msg_${sid}_pending_${promptId}`,
      body,
      createdAt: new Date().toISOString(),
      turnId: null,
      completed: false,
      aborted: false,
    };
  }

  private _enqueue(sid: string, state: PromptState): void {
    const key = promptKey(sid, state.agentId);
    let queue = this._queued.get(key);
    if (queue === undefined) {
      queue = [];
      this._queued.set(key, queue);
    }
    queue.push(state);
  }

  private _replaceQueue(sid: string, agentId: string, queue: PromptState[]): void {
    const key = promptKey(sid, agentId);
    if (queue.length === 0) {
      this._queued.delete(key);
      return;
    }
    this._queued.set(key, queue);
  }

  private _restoreSteeredQueueItems(sid: string, selected: readonly PromptState[]): void {
    const queue = this._queued.get(promptKey(sid, MAIN_AGENT_ID)) ?? [];
    const queueIds = new Set(queue.map((state) => state.promptId));
    const missing = selected.filter((state) => !queueIds.has(state.promptId));
    this._replaceQueue(sid, MAIN_AGENT_ID, [...missing, ...queue]);
  }

  private async _startNextQueued(sid: string, agentId = MAIN_AGENT_ID): Promise<void> {
    const key = promptKey(sid, agentId);
    const active = this._active.get(key);
    if (active !== undefined && !active.completed && !active.aborted) return;
    const queue = this._queued.get(key);
    const next = queue?.shift();
    if (queue !== undefined && queue.length === 0) {
      this._queued.delete(key);
    }
    if (next === undefined) return;
    await this._startPrompt(sid, next).catch(() => {
      void this._startNextQueued(sid, agentId);
    });
  }

  private async _requireSession(sid: string): Promise<void> {
    const matches = await this.core.rpc.listSessions({ sessionId: sid });
    if (matches.length === 0) {
      throw new SessionNotFoundError(sid);
    }
  }

  override dispose(): void {
    if (this._store.isDisposed) return;
    this._active.clear();
    this._queued.clear();
    this._agentState.clear();
    this._dispatchLog.clear();
    // `_onDidComplete` and `_onDidAbort` are registered via `this._register(...)`,
    // so `super.dispose()` flushes their listeners.
    super.dispose();
  }
}

// Self-register under the global singleton registry. All ctor deps are
// `@I…`-injected (@ICoreProcessService / @IEventService / @IAuthSummaryService);
// `staticArguments = []`. `supportsDelayedInstantiation = false` preserves
// current reverse-dispose semantics.
registerSingleton(IPromptService, PromptService, InstantiationType.Delayed);

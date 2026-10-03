import {
  RequestError,
  type AgentSideConnection,
  type ClientCapabilities,
  type AvailableCommand,
  type ContentBlock,
  type ModelId,
  type PromptResponse,
  type SessionModeId,
} from '@agentclientprotocol/sdk';
import {
  log,
  type ApprovalRequest,
  type ApprovalResponse,
  type LioraHarness,
  type QuestionAnswers,
  type QuestionRequest,
  type Session,
} from '@superliora/sdk';

import { type AcpBuiltinSlashCommandName } from '#/builtin-commands';
import { acpBlocksToPromptParts } from '#/convert/index';
import { DEFAULT_MODE_ID, isAcpModeId, type AcpModeId } from '#/modes';
import { replayMessage } from '#/replay';
import { runBuiltInSlashCommand, runUnknownSlashCommand } from './session-commands';
import { MAIN_AGENT_ID } from './session-constants';
import {
  emitSessionTelemetry,
  handleSessionApproval,
  handleSessionQuestion,
} from './session-reverse-rpc';
import {
  applySetModel,
  applySetMode,
  applySetThinking,
  emitConfigOptionUpdateNotification,
} from './session-lifecycle';
import { runPromptTurn } from './session-prompt';
import { detectLeadingSlashIntent } from './session-slash';

/**
 * Telemetry sink threaded into {@link AcpSession} so reverse-RPC bridges
 * (`handleApproval`, `handleQuestion`) can emit PII-free breadcrumbs
 * without reaching back through the harness. Optional — when absent,
 * the session is a silent passthrough (matches the Phase 11.2 stub-
 * tolerant pattern in `server.ts:trackSessionStarted`).
 */
export type TelemetryTrackFn = (
  event: string,
  properties?: Record<string, unknown>,
) => void;

/**
 * Adapter-side wrapper around a {@link Session} from the Kimi node SDK.
 *
 * Stored in `AcpServer.sessions` so subsequent `session/prompt` and
 * `session/cancel` calls can locate the underlying SDK session by its
 * ACP `sessionId`. The `conn` field holds the {@link AgentSideConnection}
 * so `prompt()` can emit `session/update` chunks back to the client
 * without re-plumbing the connection through the call stack.
 */
export class AcpSession {
  /**
   * The most recently observed turnId from the underlying SDK event
   * stream. Used by {@link handleApproval} to compose the prefixed ACP
   * `toolCallId` (`${turnId}:${rawId}`) so the client can correlate the
   * permission prompt with the tool card it has already rendered.
   *
   * Updated inside the existing `onEvent` listener in {@link prompt}
   * (any event carrying a numeric `turnId` advances the value), and
   * reset to `undefined` on `turn.ended`. Approval flows are gated by
   * the SDK on the active turn so a stale value is effectively
   * unreachable in practice; the `undefined` fallback in
   * `buildPermissionToolCallUpdate` exists for defence-in-depth.
   */
  private currentTurnId: number | undefined = undefined;
  private promptPending = false;
  private compactionPending = false;

  /** Native configured model alias selected by the editor. */
  private currentModelIdInternal: string;

  /** Native thinking selection exposed as a separate on/off editor option. */
  private currentThinkingEnabledInternal = false;

  /** Current native permission policy. */
  private currentModeIdInternal: AcpModeId = DEFAULT_MODE_ID;

  /**
   * The most recent command palette advertised to the ACP client, used by `/help`.
   */
  private availableCommands: readonly AvailableCommand[] = [];

  constructor(
    readonly conn: AgentSideConnection,
    readonly session: Session,
    /**
     * Capabilities the client declared during `initialize`. Passed in
     * by `AcpServer.newSession` so `prompt()` can decide whether to
     * route file I/O through ACP reverse-RPC (`fs.readTextFile` /
     * `fs.writeTextFile`) or fall back to local FS. Optional because
     * adapter-level unit tests still construct `AcpSession` with the
     * two-arg form; absence means "no FS reverse-RPC".
     */
    private readonly clientCapabilities?: ClientCapabilities,
    /**
     * Optional telemetry sink. `AcpServer` threads in
     * `harness.track?.bind(harness)` (Phase 11.2 PII-free pattern); unit
     * tests that construct `AcpSession` with a stub session leave this
     * undefined and the bridges become silent. Internal emits use the
     * {@link safeTrack} guard so a missing or throwing sink can never
     * crash a reverse-RPC handler.
     */
    private readonly track?: TelemetryTrackFn,
    /**
     * Initial value of the adapter-side current BASE model id, supplied by
     * the server when creating / loading the session so the first
     * `config_option_update` snapshot matches the response's
     * `configOptions.model.currentValue`. Defaults to empty string when
     * absent (adapter-level unit tests). Phase 15: must be the bare model
     * key (no `,thinking` suffix); thinking is carried separately by
     * {@link initialThinkingEnabled}.
     */
    initialModelId?: string,
    /**
     * Harness reference used by {@link emitConfigOptionUpdate} to
     * re-list available models when emitting the post-change snapshot.
     * Optional because adapter-level unit tests build `AcpSession`
     * without a harness; when absent, `emitConfigOptionUpdate` is a
     * silent no-op (matches the {@link safeTrack} pattern). Phase 14.3
     * introduces this so the model + mode picker funnel can refresh
     * the full SessionConfigOption[] snapshot on every change.
     */
    private readonly harness?: LioraHarness,
    /**
     * Initial value of the adapter-side thinking-toggle state, supplied
     * by the server when creating / loading the session. Phase 15
     * introduces this so resumed sessions whose persisted
     * `thinkingLevel` was non-`'off'` start with the toggle on.
     * Defaults to `false` when absent.
     */
    initialThinkingEnabled?: boolean,
    initialModeId: AcpModeId = DEFAULT_MODE_ID,
  ) {
    this.currentModelIdInternal = initialModelId ?? '';
    this.currentThinkingEnabledInternal = initialThinkingEnabled ?? false;
    this.currentModeIdInternal = initialModeId;
    // Register the approval bridge once, at session-construction time —
    // NOT per-prompt — because `setApprovalHandler` is scoped to the
    // SDK session, not the individual turn. The handler captures `this`
    // lexically; the arrow form avoids re-binding on every event.
    //
    // Defensive: the real `Session` class always provides this method,
    // but partial-stub `Session` instances used in adapter-level unit
    // tests may omit it. Treat absence as "no approval channel" rather
    // than crashing the constructor — the SDK still works end-to-end,
    // just without reverse-RPC approvals.
    if (typeof this.session.setApprovalHandler === 'function') {
      this.session.setApprovalHandler((req) => this.handleApproval(req));
    }
    // Native operator questions use the same reverse-RPC permission bridge.
    if (typeof this.session.setQuestionHandler === 'function') {
      this.session.setQuestionHandler(async (req) => this.handleQuestion(req));
    }
  }

  /** ACP-level session identifier — matches the underlying SDK session id. */
  get id(): string {
    return this.session.id;
  }

  /**
   * True while a `session/prompt` turn is in flight on this session. The
   * server's LRU eviction skips busy sessions so a live turn is never closed
   * out from under its prompt.
   */
  get hasActiveTurn(): boolean {
    return this.promptPending || this.compactionPending || this.currentTurnId !== undefined;
  }

  /**
   * Adapter-side authoritative current BASE model id (no `,thinking`
   * suffix), used by {@link AcpServer.setSessionConfigOption} to build
   * the response's `configOptions` snapshot after a model / mode /
   * thinking change.
   */
  get currentModelId(): string {
    return this.currentModelIdInternal;
  }

  /**
   * Adapter-side authoritative thinking-toggle state, used by
   * {@link AcpServer.setSessionConfigOption} to build the response's
   * `configOptions` snapshot.
   */
  get currentThinkingEnabled(): boolean {
    return this.currentThinkingEnabledInternal;
  }

  /**
   * Adapter-side authoritative current mode id, used by
   * {@link AcpServer.setSessionConfigOption} to build the response's
   * `configOptions` snapshot after a model / mode change.
   */
  get currentModeId(): AcpModeId {
    return this.currentModeIdInternal;
  }

  /**
   * Forward an ACP `session/cancel` notification to the underlying SDK
   * session. The SDK's `cancel()` is idempotent at the RPC layer, so
   * repeated cancels (or a cancel on an already-finished turn) are
   * acceptable.
   */
  async cancel(): Promise<void> {
    await Promise.all([
      this.session.cancel(),
      ...(this.compactionPending ? [this.session.cancelCompaction()] : []),
    ]);
  }

  /** Seed the advertised native command palette used by `/help`. */
  setAvailableCommands(commands: readonly AvailableCommand[]): void {
    this.availableCommands = commands.slice();
  }

  /**
   * Forward an ACP `session/set_model` (`unstable_setSessionModel`)
   * request to the underlying SDK session. See {@link applySetModel} for
   * the full wire semantics and legacy `,thinking` suffix handling.
   */
  async setModel(modelId: ModelId): Promise<void> {
    const result = await applySetModel(this.session, modelId);
    this.currentModelIdInternal = result.modelId;
    await this.emitConfigOptionUpdate();
  }

  /**
   * Forward an ACP thinking-toggle change to the underlying SDK.
   * See {@link applySetThinking} for the boolean → effort-level mapping.
   */
  async setThinking(enabled: boolean): Promise<void> {
    const result = await applySetThinking(
      this.session,
      this.harness,
      this.currentModelIdInternal,
      enabled,
    );
    this.currentThinkingEnabledInternal = result.thinkingEnabled;
    await this.emitConfigOptionUpdate();
  }

  /**
   * Forward an ACP `session/set_mode` request to the underlying SDK
   * session. Modes are native permission policies.
   *
   * Error policy:
   *  - Unknown `modeId` → JSON-RPC `invalid_params` (-32602) BEFORE any
   *    SDK call, so the client sees a structured rejection rather than
   *    a partial state change.
   *  - SDK errors from `setPermission` propagate
   *    as-is up to {@link AcpServer.setSessionMode}. When it throws,
   *    the `config_option_update` notification is suppressed (the client
   *    will see the rejection and can re-query state).
   */
  async setMode(modeId: SessionModeId): Promise<void> {
    if (!isAcpModeId(modeId)) {
      throw RequestError.invalidParams({ modeId }, `Unknown sessionModeId: ${modeId}`);
    }
    await applySetMode(this.session, modeId);
    this.currentModeIdInternal = modeId;
    await this.emitConfigOptionUpdate();
  }

  /**
   * Push a `config_option_update` session notification carrying the
   * full {@link SessionConfigOption}[] snapshot computed from the
   * adapter-side `currentModelId` + `currentModeId` authoritative state.
   */
  private async emitConfigOptionUpdate(): Promise<void> {
    await emitConfigOptionUpdateNotification({
      harness: this.harness,
      conn: this.conn,
      sessionId: this.id,
      currentModelId: this.currentModelIdInternal,
      currentThinkingEnabled: this.currentThinkingEnabledInternal,
      currentModeId: this.currentModeIdInternal,
    });
  }

  /**
   * Replay the underlying SDK session's persisted history as a stream
   * of ACP `session/update` notifications.
   *
   * Used by `session/load` (`AcpServer.loadSession`) to bring a freshly
   * reattached client up to the same on-screen state it would have if
   * it had observed every prior `session/prompt` live. Replay is pure
   * event emission: no `onEvent` subscription, no `session.prompt()`
   * call, no Kaos. The method walks {@link Session.getResumeState}
   * (which the node SDK populates from the on-disk session snapshot
   * during `harness.resumeSession`) and synthesizes per-message
   * notifications via {@link replayMessage}.
   */
  async replayHistory(agentId: string = MAIN_AGENT_ID): Promise<void> {
    const sessionId = this.id;
    const conn = this.conn;
    const resumeState = this.session.getResumeState?.();
    if (!resumeState) {
      log.warn('acp: replayHistory called on session without resume state', { sessionId });
      return;
    }
    const agent = resumeState.agents?.[agentId];
    if (!agent) {
      log.warn('acp: replayHistory found no agent state for replay', {
        sessionId,
        agentId,
        knownAgents: resumeState.agents ? Object.keys(resumeState.agents) : [],
      });
      return;
    }

    let turnId = 0;
    // Map from SDK toolCallId → owning synthetic turnId, populated when
    // the assistant message that issued the call is replayed and read
    // when the tool result lands. Lives for the duration of one replay.
    const toolCallTurnIds = new Map<string, number>();

    for (const message of agent.context.history) {
      try {
        await replayMessage(message, sessionId, conn, {
          getTurnId: () => turnId,
          beginAssistantTurn: () => {
            turnId += 1;
          },
          recordToolCall: (toolCallId) => {
            toolCallTurnIds.set(toolCallId, turnId);
          },
          lookupToolCallTurnId: (toolCallId) => toolCallTurnIds.get(toolCallId),
        });
      } catch (error) {
        log.warn('acp: replayHistory failed to emit a message; continuing', {
          sessionId,
          role: message.role,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Run an ACP `session/prompt` against the underlying SDK session.
   *
   * Error mapping (Phase 11.1):
   *  - Auth-coded errors (`AUTH_LOGIN_REQUIRED`, `PROVIDER_AUTH_ERROR`)
   *    surface as `RequestError.authRequired()` so the ACP client can
   *    drive its own re-auth UX rather than a generic internal error.
   *  - Everything else becomes `RequestError.internalError(...)` with
   *    the stack/message logged to the agent log file but NOT exposed
   *    to the client (the JSON-RPC layer would otherwise leak details).
   *  - Auth-coded failures may arrive on TWO paths: a `turn.ended`
   *    event with `reason: 'failed'` and an `event.error` payload, OR
   *    a synchronous `session.prompt(...)` rejection. Both are
   *    routed through {@link runPromptTurn}'s error mapper for parity.
   *
   * Subscribes to the session event stream; for every `assistant.delta`,
   * pushes an `agent_message_chunk` `session/update` notification to the
   * client. Resolves with the ACP `PromptResponse` (containing
   * `stopReason`) when a `turn.ended` event arrives.
   */
  async prompt(blocks: readonly ContentBlock[]): Promise<PromptResponse> {
    const parts = acpBlocksToPromptParts(blocks);
    const sessionId = this.id;
    const conn = this.conn;

    // Only native ACP-owned commands are intercepted before the model.
    const intent = detectLeadingSlashIntent(blocks);
    if (intent.kind === 'builtin') {
      if (intent.name !== 'compact') return this.runBuiltInCommand(intent.name, intent.args);
      if (this.compactionPending) {
        throw RequestError.invalidRequest(undefined, 'A session compaction is already active.');
      }
      this.compactionPending = true;
      try {
        return await this.runBuiltInCommand(intent.name, intent.args);
      } finally {
        this.compactionPending = false;
      }
    }
    if (intent.kind === 'unknown') {
      return this.runUnknownSlashCommand(intent.name);
    }

    if (this.hasActiveTurn) {
      throw RequestError.invalidRequest(undefined, 'A session prompt is already active.');
    }
    this.promptPending = true;
    try {
      return await this.runTurnBody(sessionId, conn, () => this.session.prompt(parts));
    } finally {
      this.promptPending = false;
    }
  }

  private runBuiltInCommand(
    name: AcpBuiltinSlashCommandName,
    args: string,
  ): Promise<PromptResponse> {
    return runBuiltInSlashCommand(this.commandDeps(), name, args);
  }

  private runUnknownSlashCommand(name: string): Promise<PromptResponse> {
    return runUnknownSlashCommand(this.commandDeps(), name);
  }

  private commandDeps() {
    return {
      session: this.session,
      conn: this.conn,
      sessionId: this.id,
      availableCommands: this.availableCommands,
    };
  }

  /** Subscribe to native turn events before dispatching the model request. */
  private runTurnBody(
    sessionId: string,
    conn: AgentSideConnection,
    kick: () => Promise<unknown>,
  ): Promise<PromptResponse> {
    return runPromptTurn({
      session: this.session,
      conn,
      sessionId,
      kick,
      getCurrentTurnId: () => this.currentTurnId,
      setCurrentTurnId: (turnId) => {
        this.currentTurnId = turnId;
      },
    });
  }

  /**
   * Bridge an SDK {@link ApprovalRequest} through the ACP reverse-RPC
   * `session/request_permission`.
   *
   * Flow:
   *  1. Build the wire-level {@link ToolCallUpdate} so the client can
   *     correlate the prompt with the tool card it already rendered
   *     (uses the prefixed `${turnId}:${rawId}` form when available).
   *  2. Forward to the client via `conn.requestPermission` with the
   *     three canonical options (`allow_once`, `allow_always`, `reject`).
   *  3. Map the response back to {@link ApprovalResponse} for the SDK.
   *
   * Error policy: any RPC failure (transport drop, client error,
   * timeout) resolves with `decision: 'rejected'` and a structured log
   * line. Rejecting on failure is strictly safer than approving when
   * the client cannot confirm intent, and matches the Python
   * reference's behaviour for the same edge case.
   *
   * The handler is registered exactly once in the constructor; this
   * method is invoked by the SDK reverse-RPC layer whenever the loop
   * needs human authorization to proceed with a tool call.
   */
  private async handleApproval(req: ApprovalRequest): Promise<ApprovalResponse> {
    return handleSessionApproval(this.reverseRpcContext(), req);
  }

  private async handleQuestion(req: QuestionRequest): Promise<QuestionAnswers | null> {
    return handleSessionQuestion(this.reverseRpcContext(), req);
  }

  private reverseRpcContext() {
    return {
      sessionId: this.id,
      conn: this.conn,
      getCurrentTurnId: () => this.currentTurnId,
      emitTelemetry: (event: string, properties?: Record<string, unknown>) =>{ 
        this.emitTelemetry(event, properties); },
    };
  }

  private emitTelemetry(event: string, properties?: Record<string, unknown>): void {
    emitSessionTelemetry(this.id, this.track, event, properties);
  }
}

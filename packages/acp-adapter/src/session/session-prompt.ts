import {
  RequestError,
  type AgentSideConnection,
  type PromptResponse,
} from '@agentclientprotocol/sdk';
import {
  ErrorCodes,
  log,
  type LioraErrorPayload,
  type Session,
} from '@superliora/sdk';

import {
  acpSubagentToolCallId,
  acpToolCallId,
  assistantDeltaToSessionUpdate,
  stringifyArgs,
  subagentToolCallToSessionUpdate,
  subagentToolProgressToSessionUpdate,
  subagentToolResultToSessionUpdate,
  thinkingDeltaToSessionUpdate,
  toolCallDeltaToSessionUpdate,
  toolCallLazyCreateToSessionUpdate,
  toolCallStartedUpgradeToSessionUpdate,
  toolCallStartToSessionUpdate,
  toolProgressToSessionUpdate,
  toolResultToSessionUpdate,
  turnEndReasonToStopReason,
} from '#/convert/events-map';
import { MAIN_AGENT_ID } from './session-constants';

/** Native turn subscription and actual tool activity forwarded to the editor. */
export interface PromptTurnDeps {
  readonly session: Pick<Session, 'onEvent'>;
  readonly conn: AgentSideConnection;
  readonly sessionId: string;
  readonly kick: () => Promise<unknown>;
  readonly getCurrentTurnId: () => number | undefined;
  readonly setCurrentTurnId: (turnId: number | undefined) => void;
}

/**
 * Run an ACP `session/prompt` turn against the underlying SDK session.
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
 *    routed through {@link mapPromptError} for parity.
 *
 * Subscribes to the session event stream; for every `assistant.delta`,
 * pushes an `agent_message_chunk` `session/update` notification to the
 * client. Resolves with the ACP `PromptResponse` (containing
 * `stopReason`) when a `turn.ended` event arrives.
 *
 * Cleanup invariants:
 *  - The event subscription is unsubscribed on EVERY exit path
 *    (success, cancel, failed turn, and `session.prompt()` rejection).
 *  - If `session.prompt()` rejects synchronously or asynchronously, the
 *    rejection is propagated as a `prompt` request error so the client
 *    sees a JSON-RPC error rather than a hung request.
 */
export function runPromptTurn(deps: PromptTurnDeps): Promise<PromptResponse> {
  const { session, conn, sessionId, kick, getCurrentTurnId, setCurrentTurnId } = deps;
  const { promise, resolve, reject } = Promise.withResolvers<PromptResponse>();
    let settled = false;
    let kickSettled = false;
    let terminalResponse: PromptResponse | undefined;
    let terminalError: RequestError | undefined;
    const isFromMainAgent = (event: { agentId?: string }): boolean =>
      event.agentId === undefined || event.agentId === MAIN_AGENT_ID;
    // Per-tool-call streaming args accumulator. Lives in the Promise
    // executor closure so each `prompt()` invocation gets its own
    // map and no state leaks across concurrent or sequential turns.
    // Keyed on the **SDK** `toolCallId` (not the ACP-prefixed one)
    // because the SDK delta events only carry the raw id.
    const argsByToolCall = new Map<string, { args: string }>();
    // Set of **wire-level** (turn-prefixed) tool-call ids for which
    // we have already sent the `tool_call` CREATE notification. The
    // agent-core actually emits `tool.call.delta` events BEFORE
    // `tool.call.started` (deltas come from the model's args stream;
    // the started event comes from the loop dispatching the call
    // afterwards). Without this set, the naive "started → tool_call,
    // delta → tool_call_update" mapping puts updates on the wire
    // ahead of the create, and clients such as Zed surface "Tool
    // call not found" until the create eventually lands. We instead
    // lazy-create the wire `tool_call` on the first delta and
    // downgrade the eventual started event into a `tool_call_update`
    // carrying the canonical title/kind/rawInput and native display summary.
    //
    // Keyed on the wire id (`${turnId}:${rawToolCallId}`) — not the
    // raw SDK `toolCallId` — because providers may legitimately
    // reuse the same raw id across turns within one prompt, and
    // each turn produces a distinct wire-level tool call that needs
    // its own CREATE.
    const startedToolCalls = new Set<string>();
    const outputByToolCall = new Map<string, { output: string; terminalId?: string }>();
    const startedSubagentToolCalls = new Set<string>();
    const subagentOutputByToolCall = new Map<string, { output: string; terminalId?: string }>();
    const initialActiveTurnId = getCurrentTurnId();
    let hasReceivedOwnTurnStarted = false;
    const finish = (): void => {
      if (!settled || !kickSettled) return;
      argsByToolCall.clear();
      startedToolCalls.clear();
      outputByToolCall.clear();
      startedSubagentToolCalls.clear();
      subagentOutputByToolCall.clear();
      setCurrentTurnId(undefined);
      unsub();
      if (terminalError !== undefined) reject(terminalError);
      else if (terminalResponse !== undefined) resolve(terminalResponse);
    };
    const unsub = session.onEvent((event) => {
      if (
        event.type === 'turn.started' &&
        isFromMainAgent(event) &&
        (initialActiveTurnId === undefined || event.turnId !== initialActiveTurnId)
      ) {
        hasReceivedOwnTurnStarted = true;
      }
      // Track the active turn so `handleApproval` (registered once at
      // construction, called via `setApprovalHandler`) can compose the
      // prefixed `${turnId}:${toolCallId}` wire id that matches the
      // tool card the client already rendered. This branch is purely
      // additive: it runs before the existing dispatch and never
      // returns, so the if-chain below behaves exactly as in Phase 4.
      // Subagent turn events carry their own `turnId`; filtering on
      // `agentId` keeps `currentTurnId` aligned with the parent turn
      // that the approval prompt actually belongs to.
      if (
        'turnId' in event &&
        typeof event.turnId === 'number' &&
        isFromMainAgent(event)
      ) {
        setCurrentTurnId(event.turnId);
      }
      if (event.type === 'error') {
        if (settled) return;
        if (!isFromMainAgent(event)) return;
        if (event.code !== ErrorCodes.TURN_AGENT_BUSY) return;
        if (hasReceivedOwnTurnStarted) return;
        settled = true;
        log.warn('acp: prompt rejected because another turn is active', {
          sessionId,
          details: event.details,
        });
        terminalError = RequestError.invalidRequest(
          { code: event.code, details: event.details }, event.message,
        );
        finish();
        return;
      }
      if (event.type === 'assistant.delta') {
        if (!isFromMainAgent(event)) return;
        // `sessionUpdate` is itself async (it serializes onto the
        // ndjson stream). The text deltas form a strictly ordered
        // single-producer/single-consumer pipeline, so each await
        // would force the next delta to wait for the previous flush.
        // Fire-and-forget keeps the stream pumping; we log push
        // failures rather than dropping them silently.
        conn
          .sessionUpdate(assistantDeltaToSessionUpdate(sessionId, event))
          .catch((error) => {
            log.warn('acp: failed to push agent_message_chunk', {
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }
      if (event.type === 'thinking.delta') {
        if (!isFromMainAgent(event)) return;
        conn
          .sessionUpdate(thinkingDeltaToSessionUpdate(sessionId, event))
          .catch((error) => {
            log.warn('acp: failed to push agent_thought_chunk', {
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }
      if (event.type === 'tool.call.started') {
        if (!isFromMainAgent(event)) return;
        if (event.name !== 'Bash' && event.name !== 'SessionControl') return;
        // Seed the accumulator with the **stringified initial args**.
        // The wire-level `tool_call_update` is REPLACE-content (not
        // append) so each subsequent delta emits the cumulative args
        // string; if we seeded with an empty string the first delta
        // would silently drop the initial args from the rendered card.
        argsByToolCall.set(event.toolCallId, { args: stringifyArgs(event.args) });
        // Branch on whether a streaming delta already lazy-created
        // the wire `tool_call` for this id:
        //  - YES → we cannot send a second `tool_call` CREATE; emit a
        //    `tool_call_update` (the "upgrade") so `title`/`kind`/
        //    `rawInput`/native display summary land on the existing
        //    card and `status` flips to `'in_progress'`.
        //  - NO  → no prior deltas (e.g. provider doesn't stream args);
        //    take the original path and emit the `tool_call` CREATE.
        const startedWireId = acpToolCallId(event.turnId, event.toolCallId);
        if (startedToolCalls.has(startedWireId)) {
          conn
            .sessionUpdate(toolCallStartedUpgradeToSessionUpdate(sessionId, event))
            .catch((error) => {
              log.warn('acp: failed to push tool_call_update (start upgrade)', {
                sessionId,
                toolCallId: event.toolCallId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
        } else {
          startedToolCalls.add(startedWireId);
          conn
            .sessionUpdate(toolCallStartToSessionUpdate(sessionId, event))
            .catch((error) => {
              log.warn('acp: failed to push tool_call', {
                sessionId,
                toolCallId: event.toolCallId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
        }
        return;
      }
      if (event.type === 'tool.call.delta') {
        if (!isFromMainAgent(event)) return;
        const knownWireId = acpToolCallId(event.turnId, event.toolCallId);
        if (event.name !== 'Bash' && event.name !== 'SessionControl' &&
            !(event.name === undefined && startedToolCalls.has(knownWireId))) return;
        // The agent-core emits these args-stream deltas BEFORE the
        // `tool.call.started` event (deltas come from the provider's
        // streaming phase; started is dispatched afterwards). If we
        // haven't yet sent a `tool_call` CREATE for this id, do so now
        // from the delta — Zed otherwise sees a `tool_call_update`
        // for an unknown id and surfaces "Tool call not found" until
        // the start eventually lands.
        const deltaWireId = acpToolCallId(event.turnId, event.toolCallId);
        if (!startedToolCalls.has(deltaWireId)) {
          const initial = event.argumentsPart ?? '';
          argsByToolCall.set(event.toolCallId, { args: initial });
          startedToolCalls.add(deltaWireId);
          conn
            .sessionUpdate(toolCallLazyCreateToSessionUpdate(sessionId, event))
            .catch((error) => {
              log.warn('acp: failed to push tool_call (lazy create from delta)', {
                sessionId,
                toolCallId: event.toolCallId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          return;
        }
        // Subsequent delta — accumulate then emit an update with the
        // cumulative args text (REPLACE-content semantics).
        let acc = argsByToolCall.get(event.toolCallId);
        if (!acc) {
          acc = { args: '' };
          argsByToolCall.set(event.toolCallId, acc);
        }
        conn
          .sessionUpdate(toolCallDeltaToSessionUpdate(sessionId, event, acc))
          .catch((error) => {
            log.warn('acp: failed to push tool_call_update (delta)', {
              sessionId,
              toolCallId: event.toolCallId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }
      if (event.type === 'tool.progress') {
        if (!isFromMainAgent(event)) return;
        if (!startedToolCalls.has(acpToolCallId(event.turnId, event.toolCallId))) return;
        let acc = outputByToolCall.get(event.toolCallId);
        if (!acc) {
          acc = { output: '' };
          outputByToolCall.set(event.toolCallId, acc);
        }
        const note = toolProgressToSessionUpdate(sessionId, event, acc);
        if (note === null) return;
        conn.sessionUpdate(note).catch((error) => {
          log.warn('acp: failed to push tool_call_update (progress)', {
            sessionId,
            toolCallId: event.toolCallId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }
      if (event.type === 'tool.result') {
        if (!isFromMainAgent(event)) return;
        if (!startedToolCalls.has(acpToolCallId(event.turnId, event.toolCallId))) return;
        const terminalId = outputByToolCall.get(event.toolCallId)?.terminalId;
        outputByToolCall.delete(event.toolCallId);
        conn
          .sessionUpdate(toolResultToSessionUpdate(sessionId, event, terminalId))
          .catch((error) => {
            log.warn('acp: failed to push tool_call_update (result)', {
              sessionId,
              toolCallId: event.toolCallId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return;
      }
      if (event.type === 'subagent.tool_call') {
        if (!isFromMainAgent(event)) return;
        if (event.name !== 'Bash' && event.name !== 'SessionControl') return;
        const wireId = acpSubagentToolCallId(event.subagentId, event.toolCallId);
        startedSubagentToolCalls.add(wireId);
        conn.sessionUpdate(subagentToolCallToSessionUpdate(sessionId, event)).catch((error) => {
          log.warn('acp: failed to push tool_call (subagent)', {
            sessionId,
            toolCallId: event.toolCallId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }
      if (event.type === 'subagent.tool_progress') {
        if (!isFromMainAgent(event)) return;
        const wireId = acpSubagentToolCallId(event.subagentId, event.toolCallId);
        if (!startedSubagentToolCalls.has(wireId)) return;
        let acc = subagentOutputByToolCall.get(wireId);
        if (!acc) {
          acc = { output: '' };
          subagentOutputByToolCall.set(wireId, acc);
        }
        const note = subagentToolProgressToSessionUpdate(sessionId, event, acc);
        if (note === null) return;
        conn.sessionUpdate(note).catch((error) => {
          log.warn('acp: failed to push tool_call_update (subagent progress)', {
            sessionId,
            toolCallId: event.toolCallId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }
      if (event.type === 'subagent.tool_result') {
        if (!isFromMainAgent(event)) return;
        const wireId = acpSubagentToolCallId(event.subagentId, event.toolCallId);
        const terminalId = subagentOutputByToolCall.get(wireId)?.terminalId;
        subagentOutputByToolCall.delete(wireId);
        if (!startedSubagentToolCalls.has(wireId)) return;
        conn.sessionUpdate(subagentToolResultToSessionUpdate(sessionId, event, terminalId)).catch((error) => {
          log.warn('acp: failed to push tool_call_update (subagent result)', {
            sessionId,
            toolCallId: event.toolCallId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }
      if (event.type === 'turn.ended') {
        if (settled) return;
        if (!isFromMainAgent(event)) return;
        settled = true;
        if (event.reason === 'failed') {
          log.warn('acp: turn ended with failed reason', { sessionId, error: event.error });
          terminalError = authRequiredFromPayload(event.error) ??
            RequestError.internalError(undefined, 'session prompt failed');
        } else {
          terminalResponse = { stopReason: turnEndReasonToStopReason(event.reason) };
        }
        finish();
      }
    });

    // Some SDK transports acknowledge dispatch early; others resolve after cleanup.
    // Neither may release this adapter subscription before both boundaries settle.
    void Promise.resolve().then(kick).then(() => {
      kickSettled = true;
      finish();
    }, (error: unknown) => {
      kickSettled = true;
      settled = true;
      terminalError = mapPromptError(error, sessionId);
      finish();
    });
  return promise;
}

/**
 * Map a Kimi SDK error (raw `Error`, `LioraError`, or `LioraErrorPayload`)
 * into the ACP {@link RequestError} shape used by the JSON-RPC layer.
 *
 * Auth-coded inputs (`auth.login_required`, `provider.auth_error`)
 * become `RequestError.authRequired()` so the client can drive its own
 * re-auth UX. Everything else becomes `RequestError.internalError(...)`
 * with the raw error logged to the agent log file but NOT exposed in
 * the JSON-RPC response — the client only sees the canonical
 * "session prompt failed" message, preventing accidental leakage of
 * stack frames or PII through the wire.
 *
 * The kimi-cli Python reference performs the same mapping at
 * `kimi-cli/src/kimi_cli/acp/session.py:218-247`; this is the TS port.
 */
function mapPromptError(err: unknown, sessionId: string): RequestError {
  const authErr = authRequiredFromUnknown(err);
  if (authErr) {
    log.warn('acp: prompt rejected with auth error; mapping to authRequired', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return authErr;
  }
  log.error('acp: prompt failed', {
    sessionId,
    error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
  });
  return RequestError.internalError(undefined, 'session prompt failed');
}

/**
 * Inspect a {@link LioraErrorPayload} (as carried on `turn.ended`
 * failed events) and return a `RequestError.authRequired()` if its
 * `code` is one of the auth-required codes; otherwise `undefined`.
 *
 * Kept separate from {@link authRequiredFromUnknown} because the
 * `turn.ended` event hands us a serialized payload (no class identity
 * to branch on) — we only need the `code` discriminator here.
 */
function authRequiredFromPayload(payload: LioraErrorPayload | undefined): RequestError | undefined {
  if (!payload) return undefined;
  if (isAuthErrorCode(payload.code)) {
    return RequestError.authRequired();
  }
  return undefined;
}

/**
 * Type-narrowing predicate for the codes the adapter treats as
 * "the client must re-authenticate before retrying". Currently:
 *  - `auth.login_required` — Kimi Platform / OAuth login flow needed.
 *  - `provider.auth_error` — the downstream provider rejected the
 *    request with a 401 (the node SDK lifts these into `LioraError`
 *    at `kimi-code-model-provider.ts:99-103`).
 */
function isAuthErrorCode(code: unknown): boolean {
  return code === ErrorCodes.AUTH_LOGIN_REQUIRED || code === ErrorCodes.PROVIDER_AUTH_ERROR;
}

/**
 * Best-effort detection of "auth required" for the `session.prompt(...)`
 * rejection path. The thrown value MAY be:
 *  - A `LioraError` instance with a recognized `code` field.
 *  - A plain object that happens to expose a `code` (covers RPC-layer
 *    deserialized payloads that lost class identity).
 *  - Anything else — returns `undefined`.
 */
function authRequiredFromUnknown(err: unknown): RequestError | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (isAuthErrorCode(code)) {
      return RequestError.authRequired();
    }
  }
  return undefined;
}

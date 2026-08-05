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
  acpToolCallId,
  assistantDeltaToSessionUpdate,
  planFromDisplayBlock,
  stringifyArgs,
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

/**
 * Body of `AcpSession.prompt`'s turn-driving event stream, extracted
 * so the event-listener invariants — single `onEvent` subscription,
 * `settled` flag semantics, `currentTurnId` tracking — live in one
 * place and can be driven by either `Session.prompt(parts)` or
 * `Session.activateSkill(name, args)`. Both entry points trigger the
 * same downstream turn (skill activation internally calls
 * `agent.turn.prompt(...)` after injecting the `<liora-skill-loaded>`
 * block — see `packages/agent-core/src/agent/skill/index.ts`), so the
 * event subscription's `turn.started` / `turn.ended` semantics apply
 * uniformly.
 *
 * `getCurrentTurnId` / `setCurrentTurnId` thread the adapter's
 * `currentTurnId` field through without this module depending on
 * `AcpSession` — `handleApproval` (still owned by `AcpSession`) reads
 * the same field to compose the prefixed `${turnId}:${rawId}` wire id.
 */
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
  return new Promise<PromptResponse>((resolve, reject) => {
    let settled = false;
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
    // carrying the canonical title/kind/rawInput (and any
    // `display`-derived diff).
    //
    // Keyed on the wire id (`${turnId}:${rawToolCallId}`) — not the
    // raw SDK `toolCallId` — because providers may legitimately
    // reuse the same raw id across turns within one prompt, and
    // each turn produces a distinct wire-level tool call that needs
    // its own CREATE.
    const startedToolCalls = new Set<string>();
    const initialActiveTurnId = getCurrentTurnId();
    let hasReceivedOwnTurnStarted = false;
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
        argsByToolCall.clear();
        startedToolCalls.clear();
        setCurrentTurnId(undefined);
        unsub();
        log.warn('acp: prompt rejected because another turn is active', {
          sessionId,
          details: event.details,
        });
        reject(
          RequestError.invalidRequest(
            { code: event.code, details: event.details },
            event.message,
          ),
        );
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
        //    `rawInput`/`display`-derived diff land on the existing
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
        // Phase 9.3: when the tool exposed a structured TodoList
        // display, additionally fire a `plan` session_update so ACP
        // clients can render the agent's evolving TODO list. Other
        // display kinds (diff/file_io/command/…) are already folded
        // into the tool_call card; only `todo_list` becomes a plan.
        // The emission is fire-and-forget under the same idle-stream
        // discipline as the assistant deltas above.
        if (event.display) {
          const planNote = planFromDisplayBlock(sessionId, event.turnId, event.display);
          if (planNote !== null) {
            conn.sessionUpdate(planNote).catch((error) => {
              log.warn('acp: failed to push plan', {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
        }
        return;
      }
      if (event.type === 'tool.call.delta') {
        if (!isFromMainAgent(event)) return;
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
        const note = toolProgressToSessionUpdate(sessionId, event);
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
        conn
          .sessionUpdate(toolResultToSessionUpdate(sessionId, event))
          .catch((error) => {
            log.warn('acp: failed to push tool_call_update (result)', {
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
          // Failures bubble up via the SDK `error` payload. Phase 11.1
          // upgrades the prior "log + resolve end_turn" behaviour to
          // route auth-coded failures through `RequestError.authRequired()`
          // so the client can trigger its re-auth UX. Other failure
          // codes still resolve with `end_turn` (the spec discourages
          // signaling errors through `stopReason`; the failure is
          // observable in the log).
          log.warn('acp: turn ended with failed reason', {
            sessionId,
            error: event.error,
          });
          argsByToolCall.clear();
          startedToolCalls.clear();
          setCurrentTurnId(undefined);
          unsub();
          const authErr = authRequiredFromPayload(event.error);
          if (authErr) {
            reject(authErr);
            return;
          }
        } else {
          if (event.reason === 'filtered') {
            // The provider's safety policy blocked the response. It is
            // mapped to ACP `refusal` (see turnEndReasonToStopReason); log
            // it here too so the block stays observable in the agent logs,
            // mirroring the `failed` branch above.
            log.warn('acp: turn ended with filtered reason', { sessionId });
          }
          argsByToolCall.clear();
          startedToolCalls.clear();
          // Drop the turnId so a late-arriving approval (e.g. an SDK
          // reverse-RPC racing the turn boundary) falls back to the raw
          // SDK id rather than re-prefixing with a stale value.
          setCurrentTurnId(undefined);
          unsub();
        }
        resolve({ stopReason: turnEndReasonToStopReason(event.reason) });
      }
    });

    kick().catch((error) => {
      if (settled) return;
      settled = true;
      unsub();
      reject(mapPromptError(error, sessionId));
    });
  });
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

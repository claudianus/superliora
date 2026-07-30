import type { AgentSideConnection, ModelId } from '@agentclientprotocol/sdk';
import { log, type LioraHarness, type Session } from '@superliora/sdk';

import { buildSessionConfigOptions } from '#/config-options';
import { configOptionUpdateNotification } from '#/convert/events-map';
import { listModelsFromHarness } from '#/model-catalog';
import { acpModeToToggles, type AcpModeId } from '#/modes';
import { THINKING_ON_LEVEL, THINKING_OFF_LEVEL } from './session-constants';

/**
 * Session-lifecycle funnel extracted from `AcpSession` — the model /
 * thinking / mode config axes and the `config_option_update` snapshot
 * push that follows every change. Each `apply*` function performs the
 * underlying SDK call(s) and returns the new adapter-side state; the
 * caller (`AcpSession`) is responsible for persisting the returned
 * state onto its own fields and re-emitting the snapshot — this keeps
 * the functions here pure with respect to `AcpSession`'s internals.
 */

/**
 * Forward an ACP `session/set_model` (`unstable_setSessionModel`)
 * request to the underlying SDK session.
 *
 * ACP allows model identifiers like `"kimi-k2,thinking"` where the
 * `,thinking` suffix signals "always-thinking" mode (mirrors the
 * Python ref's `_ModelIDConv.from_acp_model_id` at
 * `kimi-cli/src/kimi_cli/acp/server.py:425-433`). Phase 15 decoupled
 * thinking from the model id at the ACP surface — it's now its own
 * `thought_level` config option (Phase 16 wire form: 2-entry `select`
 * `off` / `on`) — but this legacy compat path is
 * kept: when the caller sends a merged form, we split it into the
 * bare model key (forwarded to `Session.setModel`) plus a thinking
 * flag (forwarded to `Session.setThinking`).
 *
 * Wire semantics:
 *  - `'kimi-v2'`           → setModel('kimi-v2'); thinking state unchanged.
 *  - `'kimi-v2,thinking'`  → setModel('kimi-v2') + setThinking('high');
 *    thinking state flips on.
 *
 * Note the asymmetry: a bare model id does NOT turn thinking OFF.
 * That keeps the model / thinking axes orthogonal — model changes
 * preserve thinking state. To explicitly disable thinking, the
 * client must call `setSessionConfigOption({ configId: 'thinking',
 * value: false })` (or send `setThinking('off')` directly through
 * the SDK channel, but the ACP surface only exposes the boolean).
 *
 * Unknown model errors bubble up from the SDK as-is; the caller in
 * `AcpServer.unstable_setSessionModel` decides how to translate them.
 */
export async function applySetModel(
  session: Pick<Session, 'setModel' | 'setThinking'>,
  modelId: ModelId,
): Promise<{ readonly modelId: string; readonly thinkingEnabled?: true }> {
  const suffix = ',thinking';
  const hasSuffix = modelId.endsWith(suffix);
  const baseKey = hasSuffix ? modelId.slice(0, -suffix.length) : modelId;
  await session.setModel(baseKey);
  if (hasSuffix && typeof session.setThinking === 'function') {
    await session.setThinking(THINKING_ON_LEVEL);
    return { modelId: baseKey, thinkingEnabled: true };
  }
  return { modelId: baseKey };
}

/**
 * Whether the currently-selected model declares 'always_thinking'.
 * Harness-less adapter unit tests resolve to false — the agent-core
 * runtime clamp still protects the actual request in that case.
 */
export async function isCurrentModelAlwaysThinking(
  harness: LioraHarness | undefined,
  currentModelId: string,
): Promise<boolean> {
  if (!harness) return false;
  const models = await listModelsFromHarness(harness);
  return models.find((m) => m.id === currentModelId)?.alwaysThinking === true;
}

/**
 * Forward an ACP thinking-toggle change to the underlying SDK.
 *
 * Boolean → effort-level mapping:
 *  - `true`  → `Session.setThinking('high')` (kimi-code's typical
 *    default; the agent-core `resolveThinkingEffort` would also
 *    coerce a missing config to `'high'`).
 *  - `false` → `Session.setThinking('off')`.
 *
 * When the current model cannot disable thinking (declared
 * `'always_thinking'`), the `enabled: false` request is silently
 * ignored — agent-core clamps the runtime the same way — and the
 * returned state stays `true` so the caller re-emits a snapshot that
 * snaps a stale client toggle back to on.
 *
 * Tolerant to partial-stub `Session` instances (adapter-level unit
 * tests construct minimal fakes that may omit `setThinking`): when
 * the method is missing the returned state still reflects the
 * requested value, so the ACP wire stays consistent — the test simply
 * doesn't observe an SDK call.
 */
export async function applySetThinking(
  session: Pick<Session, 'setThinking'>,
  harness: LioraHarness | undefined,
  currentModelId: string,
  enabled: boolean,
): Promise<{ readonly thinkingEnabled: boolean }> {
  if (!enabled && (await isCurrentModelAlwaysThinking(harness, currentModelId))) {
    return { thinkingEnabled: true };
  }
  if (typeof session.setThinking === 'function') {
    await session.setThinking(enabled ? THINKING_ON_LEVEL : THINKING_OFF_LEVEL);
  }
  return { thinkingEnabled: enabled };
}

/**
 * Forward an ACP `session/set_mode` request to the underlying SDK
 * session.
 *
 * Phase 12.2 supports the full 4-mode taxonomy (PLAN D9 at
 * `PLAN.md:85-106`):
 *
 *  - `'default'` → `setPlanMode(false)` + `setPermission('yolo')`
 *  - `'plan'`    → `setPlanMode(true)`  + `setPermission('manual')`
 *  - `'auto'`    → `setPlanMode(false)` + `setPermission('auto')`
 *  - `'yolo'`    → `setPlanMode(false)` + `setPermission('yolo')`
 *
 * Order is `setPlanMode` → `setPermission`. The dispatch table lives
 * in {@link acpModeToToggles} so the registry of modes and the
 * toggles each mode maps to stay co-located.
 *
 * No idempotency optimisation (PLAN D9 line 105): even if the client
 * re-asserts the current mode, both SDK calls fire.
 */
export async function applySetMode(
  session: Pick<Session, 'setPlanMode' | 'setPermission'>,
  modeId: AcpModeId,
): Promise<void> {
  const { plan, permission } = acpModeToToggles(modeId);
  await session.setPlanMode(plan);
  await session.setPermission(permission);
}

/** Snapshot of adapter-side state needed to build a `config_option_update` push. */
export interface ConfigOptionSnapshotDeps {
  readonly harness: LioraHarness | undefined;
  readonly conn: Pick<AgentSideConnection, 'sessionUpdate'>;
  readonly sessionId: string;
  readonly currentModelId: string;
  readonly currentThinkingEnabled: boolean;
  readonly currentModeId: AcpModeId;
}

/**
 * Push a `config_option_update` session notification carrying the
 * full {@link SessionConfigOption}[] snapshot computed from the
 * adapter-side `currentModelId` + `currentModeId` authoritative state.
 *
 * Called after `applySetModel` / `applySetThinking` / `applySetMode`
 * succeed and the caller has persisted the new state onto its own
 * fields. Tolerant to a missing `harness` (adapter-level unit tests
 * construct `AcpSession` without one): when absent, the snapshot
 * cannot be assembled and the emit is silently skipped so the SDK
 * call path still completes. The failure mode is symmetric to
 * `emitTelemetry`'s guard.
 *
 * Errors during the underlying `listModelsFromHarness` call or
 * the `sessionUpdate` push are caught and logged at `warn` — same
 * policy as `AcpServer.emitAvailableCommandsUpdate`: pushing a session
 * update is a streaming concern, not load-bearing for the SDK call
 * that triggered it.
 */
export async function emitConfigOptionUpdateNotification(
  deps: ConfigOptionSnapshotDeps,
): Promise<void> {
  if (!deps.harness) return;
  try {
    const snapshot = await buildSessionConfigOptions(
      deps.harness,
      deps.currentModelId,
      deps.currentThinkingEnabled,
      deps.currentModeId,
    );
    await deps.conn.sessionUpdate(configOptionUpdateNotification(deps.sessionId, snapshot));
  } catch (err) {
    log.warn('acp: failed to emit config_option_update', {
      sessionId: deps.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

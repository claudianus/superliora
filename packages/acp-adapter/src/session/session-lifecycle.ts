import type { AgentSideConnection, ModelId } from '@agentclientprotocol/sdk';
import { log, type LioraHarness, type Session } from '@superliora/sdk';

import { buildSessionConfigOptions } from '#/config-options';
import { configOptionUpdateNotification } from '#/convert/events-map';
import { listModelsFromHarness } from '#/model-catalog';
import { type AcpModeId } from '#/modes';
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

/** Model identifiers are native configured aliases; thinking is a separate axis. */
export async function applySetModel(
  session: Pick<Session, 'setModel'>,
  modelId: ModelId,
): Promise<{ readonly modelId: string }> {
  await session.setModel(modelId);
  return { modelId };
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
  await session.setThinking(enabled ? THINKING_ON_LEVEL : THINKING_OFF_LEVEL);
  return { thinkingEnabled: enabled };
}

/** Apply the native permission policy selected by the editor. */
export async function applySetMode(
  session: Pick<Session, 'setPermission'>,
  modeId: AcpModeId,
): Promise<void> {
  await session.setPermission(modeId);
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
  } catch (error) {
    log.warn('acp: failed to emit config_option_update', {
      sessionId: deps.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

import type { PromptThinking } from '@superliora/protocol';

import type { PermissionMode } from '../../agent/permission';
import type { ICoreProcessService } from '../coreProcess/coreProcess';
import type {
  AgentStatePatch,
  AgentStateSnapshot,
  AgentStateSource,
  PromptDispatchLogEntry,
} from './prompt';
import { DISPATCH_LOG_CAP, MAIN_AGENT_ID } from './promptState';

export interface PromptAgentStateStore {
  agentState: Map<string, AgentStateSnapshot>;
  dispatchLog: Map<string, PromptDispatchLogEntry[]>;
}

/** Seed the native model, thinking, and permission shadow once per session. */
export async function ensureAgentStateBootstrapped(
  core: ICoreProcessService,
  store: PromptAgentStateStore,
  sid: string,
): Promise<void> {
  if (store.agentState.has(sid)) return;
  const [config, permission] = await Promise.all([
    core.rpc.getConfig({ sessionId: sid, agentId: MAIN_AGENT_ID }),
    core.rpc.getPermission({ sessionId: sid, agentId: MAIN_AGENT_ID }),
  ]);
  const snapshot: AgentStateSnapshot = {};
  if (config.modelAlias !== undefined) snapshot.model = config.modelAlias;
  // `AgentConfigData.thinkingLevel` is typed `string` but in practice
  // takes one of the `PromptThinking` literals (`off|low|...|max`); the
  // narrow cast lets diff comparisons stay typed without forcing
  // protocol to import from agent-core.
  snapshot.thinking = config.thinkingLevel as PromptThinking;
  snapshot.permissionMode = permission.mode;
  store.agentState.set(sid, snapshot);
}

/**
 * Diff-dispatch: for each native control present on `patch`,
 * call the matching `core.rpc.*` setter ONLY when the value differs
 * from the shadow. Each setter runs serially so any failure surfaces
 * to the caller. Each successful setter also appends to the per-session
 * dispatch-log ring buffer; absence of an entry between two prompts is
 * the proof that the shadow suppressed a redundant dispatch.
 *
 * Pre-condition: `ensureAgentStateBootstrapped(sid)` already ran (the
 * shadow Map carries `sid`). Callers must guard.
 */
export async function applyAgentStateInternal(
  core: ICoreProcessService,
  store: PromptAgentStateStore,
  sid: string,
  patch: AgentStatePatch,
  source: AgentStateSource,
  promptId: string,
): Promise<void> {
  const shadow = store.agentState.get(sid);
  if (shadow === undefined) {
    // Bootstrap is a precondition; a missing shadow here is a bug,
    // not a recoverable state.
    throw new Error(
      `PromptService._applyAgentStateInternal: shadow not bootstrapped for sid=${sid}`,
    );
  }
  const agentId = MAIN_AGENT_ID;

  if (patch.model !== undefined && patch.model !== shadow.model) {
    const payload = { sessionId: sid, agentId, model: patch.model };
    await core.rpc.setModel(payload);
    shadow.model = patch.model;
    recordDispatch(store, sid, 'setModel', payload, promptId, source);
  }
  if (patch.thinking !== undefined && patch.thinking !== shadow.thinking) {
    const payload = { sessionId: sid, agentId, level: patch.thinking as PromptThinking };
    await core.rpc.setThinking(payload);
    shadow.thinking = patch.thinking;
    recordDispatch(store, sid, 'setThinking', payload, promptId, source);
  }
  if (
    patch.permission_mode !== undefined &&
    patch.permission_mode !== shadow.permissionMode
  ) {
    const payload = {
      sessionId: sid,
      agentId,
      mode: patch.permission_mode as PermissionMode,
    };
    await core.rpc.setPermission(payload);
    shadow.permissionMode = patch.permission_mode as PermissionMode;
    recordDispatch(store, sid, 'setPermission', payload, promptId, source);
  }
}

function recordDispatch(
  store: PromptAgentStateStore,
  sid: string,
  kind: PromptDispatchLogEntry['kind'],
  payload: Record<string, unknown>,
  promptId: string,
  source: AgentStateSource,
): void {
  let buf = store.dispatchLog.get(sid);
  if (buf === undefined) {
    buf = [];
    store.dispatchLog.set(sid, buf);
  }
  buf.push({
    ts: new Date().toISOString(),
    kind,
    // Shallow copy so future shadow mutations / callers can't mutate
    // the recorded payload retroactively.
    payload: { ...payload },
    promptId,
    source,
  });
  if (buf.length > DISPATCH_LOG_CAP) {
    buf.splice(0, buf.length - DISPATCH_LOG_CAP);
  }
}

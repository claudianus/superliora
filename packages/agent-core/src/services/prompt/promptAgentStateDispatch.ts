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

/**
 * Seed the per-session shadow from `getConfig` / `getPermission` /
 * `getPlan` if not yet bootstrapped. Idempotent across submits within a
 * session lifetime; cleared on `ISessionService.onDidClose`.
 *
 * The three RPCs run in parallel — they share no preconditions.
 */
export async function ensureAgentStateBootstrapped(
  core: ICoreProcessService,
  store: PromptAgentStateStore,
  sid: string,
): Promise<void> {
  if (store.agentState.has(sid)) return;
  const [config, permission, plan, swarmMode] = await Promise.all([
    core.rpc.getConfig({ sessionId: sid, agentId: MAIN_AGENT_ID }),
    core.rpc.getPermission({ sessionId: sid, agentId: MAIN_AGENT_ID }),
    core.rpc.getPlan({ sessionId: sid, agentId: MAIN_AGENT_ID }),
    core.rpc.getSwarmMode({ sessionId: sid, agentId: MAIN_AGENT_ID }),
  ]);
  const snapshot: AgentStateSnapshot = {};
  if (config.modelAlias !== undefined) snapshot.model = config.modelAlias;
  // `AgentConfigData.thinkingLevel` is typed `string` but in practice
  // takes one of the `PromptThinking` literals (`off|low|...|max`); the
  // narrow cast lets diff comparisons stay typed without forcing
  // protocol to import from agent-core.
  snapshot.thinking = config.thinkingLevel as PromptThinking;
  snapshot.permissionMode = permission.mode;
  snapshot.planMode = plan !== null;
  snapshot.swarmMode = swarmMode;
  store.agentState.set(sid, snapshot);
}

/**
 * Diff-dispatch: for each of the four controls present on `patch`,
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
  if (patch.plan_mode !== undefined && patch.plan_mode !== shadow.planMode) {
    const payload = { sessionId: sid, agentId };
    if (patch.plan_mode) {
      await core.rpc.enterPlan(payload);
      recordDispatch(store, sid, 'enterPlan', payload, promptId, source);
    } else {
      // `cancelPlan({id?})` accepts an omitted id — `PlanMode.cancel`
      // clears whatever id is currently active. Shadow doesn't track
      // ids, so we always omit.
      await core.rpc.cancelPlan(payload);
      recordDispatch(store, sid, 'cancelPlan', payload, promptId, source);
    }
    shadow.planMode = patch.plan_mode;
  }

  // Swarm mode toggle. enterSwarm/exitSwarm are idempotent no-throw on
  // the agent side; we still guard with the shadow to avoid redundant
  // dispatch-log entries.
  if (patch.swarm_mode !== undefined && patch.swarm_mode !== shadow.swarmMode) {
    const payload = { sessionId: sid, agentId };
    if (patch.swarm_mode) {
      const enterPayload = { ...payload, trigger: 'manual' as const };
      await core.rpc.enterSwarm(enterPayload);
      recordDispatch(store, sid, 'enterSwarm', enterPayload, promptId, source);
    } else {
      await core.rpc.exitSwarm(payload);
      recordDispatch(store, sid, 'exitSwarm', payload, promptId, source);
    }
    shadow.swarmMode = patch.swarm_mode;
  }

  // Goal creation. createGoal throws LioraError on invalid input
  // (GOAL_OBJECTIVE_EMPTY, GOAL_OBJECTIVE_TOO_LONG) or when a goal is
  // already active without replace=true (GOAL_ALREADY_EXISTS). Let these
  // propagate so the REST route layer can map them to the right code.
  if (patch.goal_objective !== undefined) {
    const payload = {
      sessionId: sid,
      agentId,
      objective: patch.goal_objective,
      replace: false,
    };
    await core.rpc.createGoal(payload);
    recordDispatch(store, sid, 'createGoal', payload, promptId, source);
    // `goal_objective` is a one-shot creation trigger; do not keep it on
    // the shadow.
  }

  // Goal lifecycle control. Each action maps to its own RPC; errors
  // (GOAL_NOT_FOUND, GOAL_STATUS_INVALID, GOAL_NOT_RESUMABLE) propagate.
  if (patch.goal_control !== undefined) {
    const payload = { sessionId: sid, agentId };
    switch (patch.goal_control) {
      case 'pause':
        await core.rpc.pauseGoal(payload);
        recordDispatch(store, sid, 'pauseGoal', payload, promptId, source);
        break;
      case 'resume':
        await core.rpc.resumeGoal(payload);
        recordDispatch(store, sid, 'resumeGoal', payload, promptId, source);
        break;
      case 'cancel':
        await core.rpc.cancelGoal(payload);
        recordDispatch(store, sid, 'cancelGoal', payload, promptId, source);
        break;
    }
    // `goal_control` is a one-shot action trigger; do not keep it on the
    // shadow.
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

import type { Event } from '@superliora/protocol';

import type { IEventService } from '../event/event';
import type {
  AgentStateSnapshot,
  SyntheticPromptAbortedEvent,
  SyntheticPromptCompletedEvent,
} from './prompt';
import { isAgentStatusUpdated, isTurnEnded, isTurnStarted } from './promptEventGuards';
import { MAIN_AGENT_ID, promptKey, type PromptState } from './promptState';

export interface PromptLifecycleDeps {
  active: Map<string, PromptState>;
  agentState: Map<string, AgentStateSnapshot>;
  eventService: IEventService;
  onDidCompleteFire: (ev: SyntheticPromptCompletedEvent) => void;
  onDidAbortFire: (ev: SyntheticPromptAbortedEvent) => void;
  startNextQueued: (sid: string, agentId: string) => void;
}

export function handlePromptBusEvent(deps: PromptLifecycleDeps, event: Event): void {
  const sid = (event as { sessionId?: string }).sessionId;
  if (sid === undefined || sid === '') return;

  // Mirror live `agent.status.updated` into the per-session shadow. This
  // keeps the shadow honest when out-of-band callers (TUI / SDK / agent
  // itself) mutate `model` / `permission` / `planMode` between prompts.
  // Only fields present on the event update the shadow — `thinking` is
  // not carried here and stays whatever the last `setThinking` (or
  // bootstrap getConfig) put there.
  if (isAgentStatusUpdated(event)) {
    const shadow = deps.agentState.get(sid);
    if (shadow !== undefined) {
      if (event.model !== undefined) shadow.model = event.model;
      if (event.permission !== undefined) shadow.permissionMode = event.permission;
      if (event.planMode !== undefined) shadow.planMode = event.planMode;
    }
    // status events are also published normally; fall through to allow
    // other event-type handlers below — but there's no overlap today.
    return;
  }

  const agentId = (event as { agentId?: string }).agentId ?? MAIN_AGENT_ID;
  const key = promptKey(sid, agentId);
  const state = deps.active.get(key);
  if (state === undefined) return;

  if (isTurnStarted(event)) {
    // Capture the FIRST turn.started after submit as the "top-level" turn.
    // Subsequent nested turns (e.g. subagent) carry different turnId values
    // and are NOT promoted to the prompt's top-level.
    state.turnId ??= event.turnId;
    return;
  }

  if (isTurnEnded(event)) {
    // Only fire on the top-level turn end. Nested turn.ended events fly
    // through without prompt-level synthesis.
    if (state.turnId === null || event.turnId !== state.turnId) return;

    // If we already synthesized via abort RPC, don't double-emit. Mark
    // completed to prevent stale lookups, but emit nothing.
    if (state.aborted) {
      deps.active.delete(key);
      deps.startNextQueued(sid, state.agentId);
      return;
    }

    const reason = event.reason;
    if (reason === 'cancelled') {
      // The model produced a cancellation that we didn't initiate via
      // abort RPC (or it slipped past the optimistic flag). Synthesize
      // prompt.aborted.
      state.aborted = true;
      const synth: SyntheticPromptAbortedEvent = {
        type: 'prompt.aborted',
        agentId: state.agentId,
        sessionId: sid,
        promptId: state.promptId,
        abortedAt: new Date().toISOString(),
      };
      deps.active.delete(key);
      // Fire typed listeners BEFORE publishing the synth event.
      deps.onDidAbortFire(synth);
      deps.eventService.publish(synth as unknown as Event);
      deps.startNextQueued(sid, state.agentId);
      return;
    }

    state.completed = true;
    const synth: SyntheticPromptCompletedEvent = {
      type: 'prompt.completed',
      agentId: state.agentId,
      sessionId: sid,
      promptId: state.promptId,
      finishedAt: new Date().toISOString(),
      reason: reason === 'failed' || reason === 'filtered' ? 'failed' : 'completed',
    };
    deps.active.delete(key);
    // Fire typed listeners BEFORE publishing the synth event.
    deps.onDidCompleteFire(synth);
    deps.eventService.publish(synth as unknown as Event);
    deps.startNextQueued(sid, state.agentId);
  }
}

import type {
  AddAdditionalDirPayload,
  AddAdditionalDirResult,
  ConversationLoopStateData,
  CreateGoalPayload,
  EmptyPayload,
  GoalSnapshot,
  GoalToolResult,
  RewindFilesPayload,
  RewindFilesResult,
  StartConversationLoopPayload,
  StopConversationLoopPayload,
} from './core-api';

import type { SessionAgentMethodsContext } from './session-agent-methods';

type AgentScopedPayload<T> = T & { readonly agentId: string };
type SessionScopedPayload<T> = T & { readonly sessionId: string };
type SessionAgentPayload<T> = SessionScopedPayload<AgentScopedPayload<T>>;

export function addAdditionalDir(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<AddAdditionalDirPayload>): Promise<AddAdditionalDirResult> {
  return context.requireSession(sessionId).addAdditionalDir(payload.path, payload.persist);
}

export function rewindFiles(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<RewindFilesPayload>): Promise<RewindFilesResult> {
  return context.sessionApi(sessionId).rewindFiles(payload);
}

export function startConversationLoop(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<StartConversationLoopPayload>): Promise<ConversationLoopStateData> {
  return Promise.resolve(context.sessionApi(sessionId).startConversationLoop(payload));
}

export function stopConversationLoop(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<StopConversationLoopPayload>): Promise<ConversationLoopStateData | undefined> {
  return Promise.resolve(context.sessionApi(sessionId).stopConversationLoop(payload));
}

export function listConversationLoops(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionScopedPayload<EmptyPayload>): Promise<readonly ConversationLoopStateData[]> {
  return Promise.resolve(context.sessionApi(sessionId).listConversationLoops(payload));
}

export function startBtw(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
): Promise<string> {
  return context.sessionApi(sessionId).startBtw(payload);
}

export function createGoal(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<CreateGoalPayload>): Promise<GoalSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).createGoal(payload));
}

export function getGoal(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
): Promise<GoalToolResult> {
  return Promise.resolve(context.sessionApi(sessionId).getGoal(payload));
}

export function pauseGoal(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).pauseGoal(payload));
}

export function resumeGoal(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).resumeGoal(payload));
}

export function cancelGoal(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<GoalSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).cancelGoal(payload));
}








import type {
  AddAdditionalDirPayload,
  AddAdditionalDirResult,
  CancelUltraworkPayload,
  ClassifyUltraworkAutoActivationPayload,
  ClassifyUltraworkObjectiveProfilePayload,
  ConversationLoopStateData,
  CreateGoalPayload,
  CreateUltraworkRunPayload,
  EmptyPayload,
  GoalSnapshot,
  GoalToolResult,
  PauseUltraworkPayload,
  ResumeUltraworkPayloadResult,
  RewindFilesPayload,
  RewindFilesResult,
  StartConversationLoopPayload,
  StopConversationLoopPayload,
  SwarmRestaffPayload,
  UltraworkAutoActivationDecision,
  UltraworkObjectiveProfileDecision,
  UltraworkRunSnapshot,
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

export function createUltraworkRun(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<CreateUltraworkRunPayload>): Promise<UltraworkRunSnapshot> {
  return Promise.resolve(context.sessionApi(sessionId).createUltraworkRun(payload));
}

export function getUltraworkRun(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<UltraworkRunSnapshot | null> {
  return Promise.resolve(context.sessionApi(sessionId).getUltraworkRun(payload));
}

export function pauseUltrawork(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<PauseUltraworkPayload>): Promise<UltraworkRunSnapshot | null> {
  return Promise.resolve(context.sessionApi(sessionId).pauseUltrawork(payload));
}

export function swarmRestaff(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<SwarmRestaffPayload>): Promise<boolean> {
  return Promise.resolve(context.sessionApi(sessionId).swarmRestaff(payload));
}

export function resumeUltrawork(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<EmptyPayload>): Promise<ResumeUltraworkPayloadResult | null> {
  return Promise.resolve(context.sessionApi(sessionId).resumeUltrawork(payload));
}

export function cancelUltrawork(
  context: SessionAgentMethodsContext,
  {
  sessionId,
  ...payload
}: SessionAgentPayload<CancelUltraworkPayload>): Promise<UltraworkRunSnapshot | null> {
  return Promise.resolve(context.sessionApi(sessionId).cancelUltrawork(payload));
}
export async function classifyUltraworkAutoActivation(
  context: SessionAgentMethodsContext,
  {
    sessionId,
    ...payload
  }: SessionAgentPayload<ClassifyUltraworkAutoActivationPayload>,
): Promise<UltraworkAutoActivationDecision> {
  return context.sessionApi(sessionId).classifyUltraworkAutoActivation(payload);
}

export async function classifyUltraworkObjectiveProfile(
  context: SessionAgentMethodsContext,
  {
    sessionId,
    ...payload
  }: SessionAgentPayload<ClassifyUltraworkObjectiveProfilePayload>,
): Promise<UltraworkObjectiveProfileDecision> {
  return context.sessionApi(sessionId).classifyUltraworkObjectiveProfile(payload);
}

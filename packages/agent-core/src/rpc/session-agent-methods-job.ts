import type {
  EmptyPayload,
  JobActionResult,
  JobCancelPayload,
  JobCreateBatchPayload,
  JobCreatePayload,
  JobCreateResult,
  JobGcWorktreesPayload,
  JobGcWorktreesResult,
  JobInboxPayload,
  JobInboxResult,
  JobIdPayload,
  JobInspectResult,
  JobMergePayload,
  JobMergeResult,
  JobPushPayload,
  JobPushResult,
  JobPreviewSplitPayload,
  JobResumePayload,
  JobResumeResult,
  JobSetProjectModePayload,
  JobSetProjectModeResult,
  JobSnapshot,
  JobSteerPayload,
  SplitJobIntent,
} from './core-api';

import type { SessionAgentMethodsContext } from './session-agent-methods';

type AgentScopedPayload<T> = T & { readonly agentId: string };
type SessionScopedPayload<T> = T & { readonly sessionId: string };
type SessionAgentPayload<T> = SessionScopedPayload<AgentScopedPayload<T>>;

export function jobList(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<EmptyPayload>,
): Promise<readonly JobSnapshot[]> {
  return Promise.resolve(context.sessionApi(sessionId).jobList(payload));
}

export function jobInspect(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobIdPayload>,
): Promise<JobInspectResult | undefined> {
  return Promise.resolve(context.sessionApi(sessionId).jobInspect(payload));
}

export function jobInbox(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobInboxPayload>,
): Promise<JobInboxResult> {
  return Promise.resolve(context.sessionApi(sessionId).jobInbox(payload));
}

export function jobSteer(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobSteerPayload>,
): Promise<JobActionResult> {
  return context.sessionApi(sessionId).jobSteer(payload);
}

export function jobCancel(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobCancelPayload>,
): Promise<JobActionResult> {
  return context.sessionApi(sessionId).jobCancel(payload);
}

export function jobResume(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobResumePayload>,
): Promise<JobResumeResult> {
  return context.sessionApi(sessionId).jobResume(payload);
}

export function jobCreate(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobCreatePayload>,
): Promise<JobCreateResult> {
  return context.sessionApi(sessionId).jobCreate(payload);
}

export function jobCreateBatch(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobCreateBatchPayload>,
): Promise<JobCreateResult> {
  return context.sessionApi(sessionId).jobCreateBatch(payload);
}

export function jobMerge(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobMergePayload>,
): Promise<JobMergeResult> {
  return context.sessionApi(sessionId).jobMerge(payload);
}

export function jobPush(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobPushPayload>,
): Promise<JobPushResult> {
  return context.sessionApi(sessionId).jobPush(payload);
}

export function jobPreviewSplit(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobPreviewSplitPayload>,
): Promise<readonly SplitJobIntent[]> {
  return Promise.resolve(context.sessionApi(sessionId).jobPreviewSplit(payload));
}

export function jobGcWorktrees(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobGcWorktreesPayload>,
): Promise<JobGcWorktreesResult> {
  return context.sessionApi(sessionId).jobGcWorktrees(payload);
}

export function jobSetProjectMode(
  context: SessionAgentMethodsContext,
  { sessionId, ...payload }: SessionAgentPayload<JobSetProjectModePayload>,
): Promise<JobSetProjectModeResult> {
  return Promise.resolve(context.sessionApi(sessionId).jobSetProjectMode(payload));
}

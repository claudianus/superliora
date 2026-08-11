import type { BackgroundTaskInfo, ModelAlias } from '@superliora/sdk';

import type { BackgroundAgentMetadata, ToolCallBlockData, TranscriptEntry } from '../../types';
import { formatBackgroundAgentTranscript } from '../../utils/background/background-agent-status';
import {
  isSameEffectiveModel,
  modelRouteDisplayName,
  resolveModelRouteIdentity,
} from '../../utils/model/model-route-notice';
import { nextTranscriptId } from '../../features/transcript/transcript-id';
import type { SubagentLifecycleEventOf } from './helpers';

export function findAgentTaskId(
  subagentId: string,
  meta: BackgroundAgentMetadata,
  backgroundTasks: ReadonlyMap<string, BackgroundTaskInfo>,
): string | undefined {
  for (const info of backgroundTasks.values()) {
    if (info.kind !== 'agent') continue;
    if (info.agentId === subagentId) return info.taskId;
  }
  const description = meta.description ?? meta.agentName;
  if (description === undefined) return undefined;
  // Fallback by description when the agent id is not present (e.g. a
  // background task spawned without tracking the subagent id). Multiple
  // concurrent agents can share the same generic description; returning
  // undefined here would skip terminal-status dedup and produce duplicate
  // "completed"/"failed" transcript entries, so prefer the most recently
  // registered match instead of bailing out.
  let match: string | undefined;
  for (const info of backgroundTasks.values()) {
    if (info.kind !== 'agent') continue;
    if (info.description !== description) continue;
    match = info.taskId;
  }
  return match;
}

export function buildBackgroundAgentMetadata(
  event: SubagentLifecycleEventOf<'subagent.spawned'>,
  parentToolCall: ToolCallBlockData | undefined,
): BackgroundAgentMetadata {
  const description = parentToolCall?.args['description'] ?? event.description;
  return {
    agentId: event.subagentId,
    parentToolCallId: event.parentToolCallId,
    agentName: event.subagentName,
    description: typeof description === 'string' ? description : undefined,
    modelAlias: event.modelAlias,
  };
}

export function buildBackgroundAgentTranscriptEntry(
  phase: 'started' | 'completed' | 'failed',
  meta: BackgroundAgentMetadata,
  turnId: string | undefined,
  extras: { resultSummary?: string; error?: string } | undefined = undefined,
): TranscriptEntry {
  const status = formatBackgroundAgentTranscript(phase, meta, extras);
  return {
    id: nextTranscriptId(),
    kind: 'status',
    turnId,
    renderMode: 'plain',
    content: status.headline,
    detail: status.detail,
    backgroundAgentStatus: status,
  };
}

/** When a child (esp. explore) lands on a different model, say so once. */
export function shouldSurfaceSubagentModelNotice(input: {
  readonly modelAlias: string | undefined;
  readonly subagentName: string;
  readonly sessionModel: string;
  readonly availableModels: Readonly<Record<string, ModelAlias>>;
}): boolean {
  const { modelAlias, subagentName, sessionModel, availableModels } = input;
  if (modelAlias === undefined || modelAlias.length === 0) return false;
  if (sessionModel.length === 0 || sessionModel === modelAlias) return false;
  // Same underlying model under a different alias — keep quiet.
  if (
    isSameEffectiveModel(
      resolveModelRouteIdentity(sessionModel, availableModels),
      resolveModelRouteIdentity(modelAlias, availableModels),
    )
  ) {
    return false;
  }
  // Only surface explore/cheap diversions — avoid noise for same-as-parent clones.
  const profile = subagentName.toLowerCase();
  const isExplore =
    profile.includes('explore') ||
    profile.includes('search') ||
    profile.includes('research');
  return isExplore;
}

export function subagentModelRouteNoticeText(
  subagentName: string,
  sessionModel: string,
  modelAlias: string,
  availableModels: Readonly<Record<string, ModelAlias>>,
): string {
  return `${subagentName}: ${modelRouteDisplayName(sessionModel, availableModels)} → ${modelRouteDisplayName(modelAlias, availableModels)}`;
}

/** Non-terminal `subagent.failed` hop while the host retries on a fallback model. */
export function isSubagentModelFallbackRetry(event: {
  readonly retryAttempt?: number;
}): boolean {
  return event.retryAttempt !== undefined;
}

/** Concise transcript detail for a worker/subagent model failover hop. */
export function subagentModelFailoverNoticeDetail(input: {
  readonly subagentName: string | undefined;
  readonly fromAlias: string | undefined;
  readonly toAlias: string;
  readonly availableModels: Readonly<Record<string, ModelAlias>>;
}): string {
  const name =
    input.subagentName !== undefined && input.subagentName.length > 0
      ? input.subagentName
      : 'worker';
  const toLabel = modelRouteDisplayName(input.toAlias, input.availableModels);
  if (input.fromAlias === undefined || input.fromAlias.length === 0) {
    return `${name}: ${toLabel}`;
  }
  return subagentModelRouteNoticeText(
    name,
    input.fromAlias,
    input.toAlias,
    input.availableModels,
  );
}

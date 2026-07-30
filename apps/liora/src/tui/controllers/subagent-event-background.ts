import type { BackgroundTaskInfo, ModelAlias } from '@superliora/sdk';

import type { BackgroundAgentMetadata, ToolCallBlockData, TranscriptEntry } from '../types';
import { formatBackgroundAgentTranscript } from '../utils/background-agent-status';
import {
  isSameEffectiveModel,
  modelRouteDisplayName,
  resolveModelRouteIdentity,
} from '../utils/model-route-notice';
import { nextTranscriptId } from '../utils/transcript-id';
import type { SubagentLifecycleEventOf } from './subagent-event-helpers';

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

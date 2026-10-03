import type { BackgroundTaskInfo } from '@superliora/sdk';

import type { BackgroundAgentMetadata, ToolCallBlockData, TranscriptEntry } from '../../types';
import { formatBackgroundAgentTranscript } from '../../utils/background/background-agent-status';
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



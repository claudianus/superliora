import type {
  AgentReplayRecord,
  BackgroundTaskInfo,
  ContentPart,
  ContextMessage,
  PromptOrigin,
  ResumedAgentState,
  ToolCall,
} from '@superliora/sdk';

import type {
  AppState,
  BackgroundAgentMetadata,
  ToolCallBlockData,
  TranscriptEntry,
} from '#/tui/types';

import { mediaUrlPartToText } from '#/tui/utils/media/media-url';
import { nextTranscriptId } from '#/tui/features/transcript/transcript-id';

/** Recent user-turns to mount when hydrating a resumed session. */
export const REPLAY_TURN_LIMIT = 10;

/**
 * Soft cap for assistant tool-call mounts within a single replayed turn.
 * Long-running turns can contain hundreds of tools; mounting all of them
 * (even with turn-limit 10) still freezes the TUI. Excess calls stay in the
 * tool map for result bookkeeping but skip component mount — the trailing
 * window of tools is kept so the latest work is visible.
 */
export const REPLAY_MAX_TOOL_MOUNTS_PER_TURN = 40;

export interface ReplayRenderContext {
  turnIndex: number;
  stepIndex: number;
  currentTurnId: string | undefined;
  assistant: {
    thinking: string[];
    text: string[];
  };
  toolCalls: Map<string, ToolCallBlockData>;
  /** Tool call ids that received a component mount this turn. */
  mountedToolCallIds: Set<string>;
  /** Tool mounts created in the current turn (resets on user-turn advance). */
  mountedToolCountThisTurn: number;
  /** Tool calls skipped this turn because of {@link REPLAY_MAX_TOOL_MOUNTS_PER_TURN}. */
  suppressedToolCountThisTurn: number;
  completedToolCallIds: Set<string>;
}

export interface ReplayBackgroundProjection {
  readonly backgroundAgentMetadata: ReadonlyMap<string, BackgroundAgentMetadata>;
}

export function appStateFromResumeAgent(agent: ResumedAgentState): Partial<AppState> {
  const maxContextTokens = agent.config.modelCapabilities?.max_context_tokens ?? 0;
  const contextTokens = agent.context.tokenCount;
  const contextUsage = maxContextTokens > 0 ? contextTokens / maxContextTokens : 0;
  return {
    model: agent.config.modelAlias ?? agent.config.provider?.model ?? '',
    contextTokens,
    maxContextTokens,
    contextUsage,
    permissionMode: agent.permission.mode,
  };
}

export function isTerminalBackgroundTask(info: BackgroundTaskInfo): boolean {
  return (
    info.status === 'completed' ||
    info.status === 'failed' ||
    info.status === 'timed_out' ||
    info.status === 'killed' ||
    info.status === 'lost'
  );
}

export function countActiveBackgroundTasks(tasks: ReadonlyMap<string, BackgroundTaskInfo>): {
  bashTasks: number;
  agentTasks: number;
} {
  let bashTasks = 0;
  let agentTasks = 0;
  for (const info of tasks.values()) {
    if (isTerminalBackgroundTask(info)) continue;
    if (info.kind === 'agent') {
      agentTasks += 1;
    } else {
      bashTasks += 1;
    }
  }
  return { bashTasks, agentTasks };
}

export function replayBackgroundProjection(
  background: readonly BackgroundTaskInfo[],
): ReplayBackgroundProjection {
  const backgroundAgentMetadata = new Map<string, BackgroundAgentMetadata>();
  for (const info of background) {
    if (info.kind !== 'agent') continue;
    if (isTerminalBackgroundTask(info)) continue;
    const agentId = info.agentId ?? info.taskId;
    backgroundAgentMetadata.set(agentId, {
      agentId,
      parentToolCallId: info.taskId,
      description: info.description,
    });
  }
  return { backgroundAgentMetadata };
}

export function createReplayRenderContext(): ReplayRenderContext {
  return {
    turnIndex: 0,
    stepIndex: 0,
    currentTurnId: undefined,
    assistant: { thinking: [], text: [] },
    toolCalls: new Map(),
    mountedToolCallIds: new Set(),
    mountedToolCountThisTurn: 0,
    suppressedToolCountThisTurn: 0,
    completedToolCallIds: new Set(),
  };
}

/**
 * Bound a full agent replay log to the most recent `maxTurns` user turns.
 * Call this *before* projecting records into transcript components so hydrate
 * never walks or mounts the unbounded history on the UI thread.
 *
 * `maxTurns <= 0` returns an empty slice (callers should pass
 * {@link REPLAY_TURN_LIMIT}, which is always positive).
 */
export function limitReplayRecordsByTurn(
  records: readonly AgentReplayRecord[],
  maxTurns: number,
): readonly AgentReplayRecord[] {
  if (maxTurns <= 0) return [];
  const turnStarts = records.flatMap((record, index) =>
    isReplayUserTurnRecord(record) ? [index] : [],
  );
  if (turnStarts.length <= maxTurns) return records;
  return records.slice(turnStarts[turnStarts.length - maxTurns]!);
}

/**
 * Count user-turn anchors in a replay log (for tests / progress UI).
 * Does not allocate the limited slice.
 */
export function countReplayUserTurns(records: readonly AgentReplayRecord[]): number {
  let count = 0;
  for (const record of records) {
    if (isReplayUserTurnRecord(record)) count += 1;
  }
  return count;
}

export function replayEntry(
  context: ReplayRenderContext,
  kind: TranscriptEntry['kind'],
  content: string,
  renderMode: TranscriptEntry['renderMode'],
  extras: { detail?: string; bullet?: string } = {},
): TranscriptEntry {
  return {
    id: nextTranscriptId(),
    kind,
    turnId: context.currentTurnId,
    renderMode,
    content,
    detail: extras.detail,
    bullet: extras.bullet,
  };
}

export function collectReplayMessageContent(
  target: ReplayRenderContext['assistant'],
  content: readonly ContentPart[],
): void {
  for (const part of content) {
    switch (part.type) {
      case 'think':
        target.thinking.push(part.think);
        break;
      case 'text':
        target.text.push(part.text);
        break;
      case 'audio_url':
      case 'image_url':
      case 'video_url':
        break;
    }
  }
}

export function toolCallFromReplayMessage(
  rawToolCall: ToolCall,
  context: ReplayRenderContext,
): ToolCallBlockData | undefined {
  const id = rawToolCall.id;
  const name = rawToolCall.name;
  if (id.length === 0 || name.length === 0) return undefined;
  return {
    id,
    name,
    args: parseReplayToolArguments(rawToolCall.arguments),
    step: context.stepIndex,
    turnId: context.currentTurnId,
  };
}

export function toolResultOutput(content: readonly ContentPart[]): string {
  if (content.some((part) => part.type !== 'text')) {
    return JSON.stringify(content);
  }
  return contentPartsToText(content);
}

export function contentPartsToText(content: readonly ContentPart[]): string {
  return content.map(contentPartToText).join('');
}

export function backgroundOrigin(
  message: ContextMessage,
): Extract<PromptOrigin, { kind: 'background_task' }> | undefined {
  return message.origin?.kind === 'background_task' ? message.origin : undefined;
}



function isReplayUserTurnRecord(record: AgentReplayRecord): boolean {
  if (record.type !== 'message') return false;
  const { message } = record;
  if (message.role !== 'user') return false;
  switch (message.origin?.kind) {
    case undefined:
    case 'user':
      return true;
    case 'shell_command':
      // A `!` command's input is a user-turn anchor; its output is not.
      return message.origin.phase === 'input';
    case 'background_task':
    case 'compaction_summary':
    case 'retry':
    case 'system_trigger':
      return false;
  }
}

function parseReplayToolArguments(value: string | null): Record<string, unknown> {
  if (value === null || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function contentPartToText(part: ContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'think':
      return part.think;
    case 'image_url':
      return mediaUrlPartToText('image', part.imageUrl.url);
    case 'video_url':
      return mediaUrlPartToText('video', part.videoUrl.url);
    case 'audio_url':
      return mediaUrlPartToText('audio', part.audioUrl.url);
    case 'file_url':
      return mediaUrlPartToText('file', part.fileUrl.url);
  }
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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
  PluginCommandTrigger,
  SkillActivationTrigger,
  ToolCallBlockData,
  TranscriptEntry,
} from '#/tui/types';

import { mediaUrlPartToText } from './media-url';
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
  skillActivationIds: Set<string>;
  pluginCommandActivationIds: Set<string>;
  suppressNextPlanModeOffNotice: boolean;
}

export interface SkillActivationProjection {
  readonly activationId: string;
  readonly skillName: string;
  readonly skillArgs?: string;
  readonly trigger: SkillActivationTrigger;
}

export interface PluginCommandProjection {
  readonly activationId: string;
  readonly pluginId: string;
  readonly commandName: string;
  readonly commandArgs?: string;
  readonly trigger: PluginCommandTrigger;
}

export interface ReplayBackgroundProjection {
  readonly backgroundAgentMetadata: ReadonlyMap<string, BackgroundAgentMetadata>;
}

export function appStateFromResumeAgent(agent: ResumedAgentState): Partial<AppState> {
  const maxContextTokens = agent.config.modelCapabilities?.max_context_tokens ?? 0;
  const contextTokens = agent.context.tokenCount;
  const contextUsage = maxContextTokens > 0 ? contextTokens / maxContextTokens : 0;
  const ultraworkRun = agent.ultrawork?.run;
  const resumableUltrawork =
    ultraworkRun !== undefined &&
    ultraworkRun !== null &&
    ultraworkRun.status !== 'done' &&
    ultraworkRun.status !== 'failed';
  return {
    model: agent.config.modelAlias ?? agent.config.provider?.model ?? '',
    contextTokens,
    maxContextTokens,
    contextUsage,
    planMode: agent.plan !== null,
    swarmMode: agent.swarmMode ?? false,
    permissionMode: agent.permission.mode,
    ultraworkMode: resumableUltrawork && (agent.ultrawork?.modeEnabled ?? false),
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
    skillActivationIds: new Set(),
    pluginCommandActivationIds: new Set(),
    suppressNextPlanModeOffNotice: false,
  };
}

export function limitReplayRecordsByTurn(
  records: readonly AgentReplayRecord[],
  maxTurns: number,
): readonly AgentReplayRecord[] {
  if (maxTurns <= 0) return [];
  const turnStarts = records.flatMap((record, index) =>
    isReplayUserTurnRecord(record) ? [index] : [],
  );
  if (turnStarts.length <= maxTurns) return records;
  return records.slice(turnStarts[turnStarts.length - maxTurns]);
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

export function skillActivationFromOrigin(
  origin: PromptOrigin | undefined,
): SkillActivationProjection | undefined {
  if (origin?.kind !== 'skill_activation') return undefined;
  return {
    activationId: origin.activationId,
    skillName: origin.skillName,
    skillArgs: origin.skillArgs,
    trigger: origin.trigger,
  };
}

export function pluginCommandFromOrigin(
  origin: PromptOrigin | undefined,
): PluginCommandProjection | undefined {
  if (origin?.kind !== 'plugin_command') return undefined;
  return {
    activationId: origin.activationId,
    pluginId: origin.pluginId,
    commandName: origin.commandName,
    commandArgs: origin.commandArgs,
    trigger: origin.trigger,
  };
}

export function formatHookResultMessageForTranscript(
  text: string,
  fallbackEvent: string,
  blocked: boolean,
): string {
  const results: Array<{ event: string; body: string }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(HOOK_RESULT_RE)) {
    if (text.slice(lastIndex, match.index).trim().length > 0) {
      return formatHookResultBlock(fallbackEvent, text, blocked);
    }
    const event = match[1];
    const body = match[2];
    if (event === undefined || body === undefined) {
      return formatHookResultBlock(fallbackEvent, text, blocked);
    }
    results.push({ event, body });
    lastIndex = match.index + match[0].length;
  }

  if (results.length === 0 || text.slice(lastIndex).trim().length > 0) {
    return formatHookResultBlock(fallbackEvent, text, blocked);
  }

  return results.map(({ event, body }) => formatHookResultBlock(event, body, blocked)).join('\n\n');
}

function isReplayUserTurnRecord(record: AgentReplayRecord): boolean {
  if (record.type !== 'message') return false;
  const { message } = record;
  if (message.role !== 'user') return false;
  switch (message.origin?.kind) {
    case undefined:
    case 'user':
      return true;
    case 'skill_activation':
      return message.origin.trigger === 'user-slash';
    case 'plugin_command':
      return message.origin.trigger === 'user-slash';
    case 'shell_command':
      // A `!` command's input is a user-turn anchor; its output is not.
      return message.origin.phase === 'input';
    case 'background_task':
    case 'compaction_summary':
    case 'cron_job':
    case 'cron_missed':
    case 'hook_result':
    case 'injection':
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
  }
}

const HOOK_RESULT_RE =
  /<hook_result\s+hook_event="([^"]+)">\n?([\s\S]*?)\n?<\/hook_result>/g;

function formatHookResultBlock(event: string, body: string, blocked: boolean): string {
  return `*${event} hook${blocked ? ' blocked' : ''}*\n\n${body.trim() || '(empty)'}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

import type { ContentPart } from '@superliora/kosong';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ContextMessage } from '../../context';
import { isSwarmToolResult, maskStaleSwarmToolResult } from './boundary-compaction';
import { MICRO_TOOL_RESULT_FAMILY_KEEP } from './micro-constants';
export function contentPreview(parts: readonly ContentPart[]): string {
  return parts.map((part) => truncateForMarker(contentPartPreview(part), 80)).join('\n').trim();
}

export function contentPartPreview(part: ContentPart): string {
  if (part.type === 'text') return part.text;
  if (part.type === 'image_url') return mediaPartPreview('image_url', part.imageUrl);
  if (part.type === 'audio_url') return mediaPartPreview('audio_url', part.audioUrl);
  if (part.type === 'video_url') return mediaPartPreview('video_url', part.videoUrl);
  return `[${part.type}]`;
}

export function mediaPartPreview(
  type: string,
  media: { readonly id?: string; readonly url?: string },
): string {
  const details = [
    media.id === undefined ? undefined : `id=${media.id}`,
    media.url === undefined ? undefined : `url=${media.url}`,
  ].filter((item): item is string => item !== undefined);
  return `[${type}${details.length > 0 ? ` ${details.join(' ')}` : ''}]`;
}

export function truncateForMarker(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * Tools whose results are treated as stateful / control-plane and must not be
 * cleared by micro compaction (context-engineering exclude_tools policy).
 * Includes mutators and durable ledger/memory surfaces.
 */
const KNOWN_MUTATING_TOOLS = new Set([
  'Agent',
  'AgentSwarm',
  'AskUserQuestion',
  'Bash',
  'CreateGoal',
  'CronCreate',
  'CronDelete',
  'Edit',
  'EnterPlanMode',
  'ExitPlanMode',
  'Memory',
  'NextPhase',
  'RecordInterviewFinding',
  'SetGoalBudget',
  'Skill',
  'TaskStop',
  'TodoList',
  'UltraSwarm',
  'UltraworkGraph',
  'UpdateGoal',
  'Write',
]);


const HIGH_VALUE_REPLAY_TOOL_FAMILIES = new Set([
  'Context7Docs',
  'Context7Resolve',
  'FetchURL',
  'Glob',
  'Grep',
  'LioraRead',
  'Read',
  'SearchExpert',
  'SearchSkill',
  'SearchTools',
  'TaskOutput',
  'WebSearch',
]);

/**
 * Within the micro-clearable prefix [0, cutoff), keep the newest `keep` tool
 * results per tool name; older same-family toolCallIds are overflow (AC-B2).
 * Mutating tools are excluded (never family-cleared via this path alone).
 */
export function computeFamilyBudgetOverflowToolCallIds(
  messages: readonly ContextMessage[],
  cutoff: number,
  keep: number = MICRO_TOOL_RESULT_FAMILY_KEEP,
  highValueReplayKeep: number = keep,
): ReadonlySet<string> {
  const keepN = Math.max(0, Math.floor(keep));
  const highValueReplayKeepN = Math.max(keepN, Math.floor(highValueReplayKeep));
  // toolName -> toolCallIds in chronological order within the clearable window
  const byFamily = new Map<string, string[]>();
  const limit = Math.min(messages.length, Math.max(0, cutoff));
  for (let i = 0; i < limit; i++) {
    const msg = messages[i];
    if (msg?.role !== 'tool' || msg.toolCallId === undefined) continue;
    const toolName = toolNameForMessage(msg.toolCallId, messages);
    if (toolName === undefined) continue;
    if (isStatefulOrMutatingTool(toolName)) continue;
    const list = byFamily.get(toolName) ?? [];
    list.push(msg.toolCallId);
    byFamily.set(toolName, list);
  }
  const overflow = new Set<string>();
  for (const [toolName, ids] of byFamily) {
    const familyKeep = HIGH_VALUE_REPLAY_TOOL_FAMILIES.has(toolName)
      ? highValueReplayKeepN
      : keepN;
    if (ids.length <= familyKeep) continue;
    // Keep the newest family budget (tail); older prefix overflows.
    for (const id of ids.slice(0, ids.length - familyKeep)) {
      overflow.add(id);
    }
  }
  return overflow;
}

export function isStatefulOrMutatingTool(toolName: string): boolean {
  return KNOWN_MUTATING_TOOLS.has(toolName);
}

export function isKnownMutatingTool(toolName: string): boolean {
  return isStatefulOrMutatingTool(toolName);
}

export function findLatestSwarmToolCallId(messages: readonly ContextMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'tool' || message.toolCallId === undefined) continue;
    const toolName = toolNameForMessage(message.toolCallId, messages);
    if (toolName === 'UltraSwarm' || toolName === 'AgentSwarm') {
      return message.toolCallId;
    }
  }
  return undefined;
}

export function toolNameForMessage(
  toolCallId: string,
  messages: readonly ContextMessage[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const match = messages[i]?.toolCalls?.find((toolCall) => toolCall.id === toolCallId);
    if (match !== undefined) return match.name;
  }
  return undefined;
}

export function maskSwarmToolResultIfStale(
  message: ContextMessage,
  messages: readonly ContextMessage[],
  latestSwarmToolCallId: string | undefined,
): ContextMessage | null {
  if (message.toolCallId === latestSwarmToolCallId) return null;
  const toolName = toolNameForMessage(message.toolCallId ?? '', messages);
  if (toolName !== 'UltraSwarm' && toolName !== 'AgentSwarm') return null;
  const fullText = message.content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  if (!isSwarmToolResult(fullText)) return null;
  const masked = maskStaleSwarmToolResult(fullText);
  if (masked === fullText) return null;
  return {
    ...message,
    content: [{ type: 'text', text: masked } satisfies ContentPart],
  };
}


/** Max cleared-output receipts kept under `<homedir>/tool-results` (T1-4 LRU). */
const MAX_CLEARED_RECEIPTS = 64;

export function pruneClearedReceipts(dir: string): void {
  try {
    const entries = readdirSync(dir)
      .filter((name) => name.startsWith('cleared-'))
      .map((name) => {
        try {
          return { name, mtimeMs: statSync(join(dir, name)).mtimeMs };
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is { name: string; mtimeMs: number } => entry !== undefined)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of entries.slice(MAX_CLEARED_RECEIPTS)) {
      rmSync(join(dir, entry.name), { force: true });
    }
  } catch {
    // Pruning is best-effort; never let it break compaction.
  }
}

import type { ContentPart } from '@superliora/kosong';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ContextMessage } from '../../context';
import {
  isStatefulOrMutatingTool,
} from '../tool-policy';
import { isSwarmToolResult, maskStaleSwarmToolResult } from './boundary-compaction';
import { MICRO_TOOL_RESULT_FAMILY_KEEP } from './micro-constants';

export {
  ARCHIVE_RECOVER_LEGACY_TOOL,
  ARCHIVE_RECOVER_PREFERRED_TOOL,
  isKnownMutatingTool,
  isStatefulOrMutatingTool,
  resolveArchiveRecoverToolName,
} from '../tool-policy';

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

const HIGH_VALUE_REPLAY_TOOL_FAMILIES = new Set([
  'Context7Docs',
  'Context7Resolve',
  'FetchURL',
  'Glob',
  'Grep',
  'LioraRead',
  'Read',
  'RepoQuery',
  'SearchExpert',
  'SearchSkill',
  'SearchTools',
  'TaskOutput',
  'WebSearch',
]);

/**
 * Within the micro-clearable prefix [0, cutoff), keep the **oldest** `keep` tool
 * results per tool name; newer same-family toolCallIds are overflow.
 *
 * Prompt-cache rationale: provider caches match a stable *prefix*. Clearing the
 * oldest family members rewrites early tool results and collapses the next
 * request's cache_read (observed: ~95% → ~0% after one micro apply). Prefer
 * mutating near the cutoff boundary so the long cached prefix stays byte-identical.
 * Mutating tools are excluded (never family-cleared via this path alone).
 */
export function computeFamilyBudgetOverflowToolCallIds(
  messages: readonly ContextMessage[],
  cutoff: number,
  keep: number = MICRO_TOOL_RESULT_FAMILY_KEEP,
  highValueReplayKeep: number = keep,
  index?: ToolNameIndex,
): ReadonlySet<string> {
  const keepN = Math.max(0, Math.floor(keep));
  const highValueReplayKeepN = Math.max(keepN, Math.floor(highValueReplayKeep));
  // toolName -> toolCallIds in chronological order within the clearable window
  const byFamily = new Map<string, string[]>();
  const limit = Math.min(messages.length, Math.max(0, cutoff));
  for (let i = 0; i < limit; i++) {
    const msg = messages[i];
    if (msg?.role !== 'tool' || msg.toolCallId === undefined) continue;
    const toolName = toolNameForMessage(msg.toolCallId, messages, index);
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
    // Keep the oldest family budget (head); newer results near cutoff overflow.
    for (const id of ids.slice(familyKeep)) {
      overflow.add(id);
    }
  }
  return overflow;
}

export const SWARM_TOOL_NAMES: ReadonlySet<string> = new Set([
  'UltraSwarm',
  'AgentSwarm',
  'Fleet',
]);

export function isSwarmToolName(toolName: string | undefined): boolean {
  return toolName !== undefined && SWARM_TOOL_NAMES.has(toolName);
}

/**
 * toolCallId → toolName index over one message array. Built once per
 * projection source (memoized by reference in buildToolNameIndex) so the
 * per-tool-result lookups in micro compaction stay O(1) instead of
 * re-scanning the whole history each time (O(n²) on long sessions).
 */
export type ToolNameIndex = ReadonlyMap<string, string>;

/**
 * Forward pass keeps the last declaration of an id authoritative —
 * equivalent to the legacy latest-first reverse scan.
 */
export function buildToolNameIndex(messages: readonly ContextMessage[]): ToolNameIndex {
  const map = new Map<string, string>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      map.set(toolCall.id, toolCall.name);
    }
  }
  return map;
}

export function toolNameForMessage(
  toolCallId: string,
  messages: readonly ContextMessage[],
  index?: ToolNameIndex,
): string | undefined {
  if (index !== undefined) return index.get(toolCallId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const match = messages[i]?.toolCalls?.find((toolCall) => toolCall.id === toolCallId);
    if (match !== undefined) return match.name;
  }
  return undefined;
}

/**
 * Return a masked copy of one swarm tool result message, or `null` when the
 * message is not a swarm result or masking would not change its content.
 */
function maskSwarmToolMessage(message: ContextMessage): ContextMessage | null {
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

/**
 * Append-time swarm masking: when a swarm tool result lands, replace every
 * swarm result that is not the newest one with its masked form — exactly
 * once, in the stored segments (history + deferred tail). Masking at append
 * time (instead of lazily during each projection) keeps projected bytes a
 * pure function of the stored messages — the provider prefix cache is
 * invalidated by the append itself, never by a later mid-history rewrite.
 * Also covers a late-arriving older result: it masks itself when a newer
 * swarm result is already stored.
 */
export function maskStaleSwarmToolResults(segments: readonly ContextMessage[][]): number {
  const index = new Map<string, string>();
  for (const segment of segments) {
    for (const message of segment) {
      for (const toolCall of message.toolCalls ?? []) {
        index.set(toolCall.id, toolCall.name);
      }
    }
  }
  // Projection order is segment order, so scan the last segment backwards
  // first to find the newest swarm result.
  let latestSwarmToolCallId: string | undefined;
  for (let s = segments.length - 1; s >= 0 && latestSwarmToolCallId === undefined; s--) {
    const segment = segments[s];
    if (segment === undefined) continue;
    for (let i = segment.length - 1; i >= 0; i--) {
      const message = segment[i];
      if (message?.role !== 'tool' || message.toolCallId === undefined) continue;
      if (isSwarmToolName(index.get(message.toolCallId))) {
        latestSwarmToolCallId = message.toolCallId;
        break;
      }
    }
  }
  let maskedCount = 0;
  for (const segment of segments) {
    for (let i = 0; i < segment.length; i++) {
      const message = segment[i];
      if (message?.role !== 'tool' || message.toolCallId === undefined) continue;
      if (message.toolCallId === latestSwarmToolCallId) continue;
      if (!isSwarmToolName(index.get(message.toolCallId))) continue;
      const masked = maskSwarmToolMessage(message);
      if (masked === null) continue;
      segment[i] = masked;
      maskedCount += 1;
    }
  }
  return maskedCount;
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
      .toSorted((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of entries.slice(MAX_CLEARED_RECEIPTS)) {
      rmSync(join(dir, entry.name), { force: true });
    }
  } catch {
    // Pruning is best-effort; never let it break compaction.
  }
}

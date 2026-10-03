/**
 * Pure string / preview formatters for ToolCallComponent.
 * No component instance state — keep stateful entrance / snapshot logic in
 * tool-call-entrance.ts / tool-call.ts.
 */


import { utf8Prefix, type TokenUsage } from '@superliora/sdk';
import { STREAMING_ARGS_PREVIEW_MAX_BYTES } from '#/tui/constant/streaming';
import { decodePartialJsonString, parseStreamingArgs } from '#/tui/utils/event-payload';

const MAX_ARG_LENGTH = 60;

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function formatSubagentContextTokens(contextTokens: number | undefined): string | undefined {
  if (contextTokens === undefined || contextTokens <= 0) return undefined;
  const formatted = contextTokens >= 1000 ? `${(contextTokens / 1000).toFixed(1)}k` : String(contextTokens);
  return `${formatted} tok`;
}

function usageInputTotal(usage: TokenUsage): number {
  return (usage.inputOther ?? 0) + (usage.inputCacheRead ?? 0) + (usage.inputCacheCreation ?? 0);
}

export function usageTotal(usage: TokenUsage | undefined): number {
  if (usage === undefined) return 0;
  return usageInputTotal(usage) + usage.output;
}

export function formatSubagentTokens(usage: TokenUsage | undefined): string | undefined {
  const total = usageTotal(usage);
  if (total <= 0) return undefined;
  const formatted = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
  return `${formatted} tok`;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes)}m ${String(remainder)}s`;
}

/**
 * Pull the live value of a JSON string field out of partially-streamed
 * arguments, even if the closing quote hasn't arrived yet. Handles the
 * common JSON string escapes so `\n` in a streamed `content` becomes a
 * real newline we can highlight. Returns `undefined` if the field hasn't
 * started streaming yet.
 */
export function extractPartialStringField(text: string, key: string): string | undefined {
  text = utf8Prefix(text, STREAMING_ARGS_PREVIEW_MAX_BYTES);
  const opener = new RegExp(`"${key}"\\s*:\\s*"`);
  const match = opener.exec(text);
  if (match === null) return undefined;
  const start = match.index + match[0].length;
  let end = start;
  while (end < text.length) {
    if (text[end] === '"') break;
    if (text[end] === '\\') end++;
    end++;
  }
  return decodePartialJsonString(text.slice(start, end));
}

export function parseArgsPreview(value: string): Record<string, unknown> {
  return { ...parseStreamingArgs(value) };
}

const KEY_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  Bash: ['command'],
  SessionControl: ['operation', 'description', 'id', 'prompt'],
};

export function extractKeyArgument(
  toolName: string,
  args: Record<string, unknown>,
): string | null {
  const candidates = KEY_ARGUMENTS[toolName];
  let value: string | undefined;
  if (candidates !== undefined) {
    for (const key of candidates) {
      const candidate = args[key];
      if (typeof candidate === 'string' && candidate.length > 0) {
        value = candidate;
        break;
      }
    }
  } else {
    for (const key in args) {
      const candidate = args[key];
      if (typeof candidate === 'string' && candidate.length > 0) {
        value = candidate;
        break;
      }
    }
  }
  if (value === undefined) return null;
  const lineEnd = value.indexOf('\n');
  const firstLine = lineEnd < 0 ? value : value.slice(0, lineEnd);
  const displayValue = toolName === 'Bash' && lineEnd >= 0 ? `${firstLine}…` : firstLine;
  return displayValue.length <= MAX_ARG_LENGTH
    ? displayValue
    : displayValue.slice(0, MAX_ARG_LENGTH - 3) + '...';
}

export function formatSubagentLabel(agentName: string | undefined): string {
  const raw = agentName?.trim();
  if (raw === undefined || raw.length === 0) return 'SubAgent';
  const label = raw
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  if (/\bagent$/i.test(label)) return label;
  return `${label} Agent`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k tok`;
  return `${String(n)} tok`;
}

export function formatActivityLine(
  verb: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  const keyArg = extractKeyArgument(toolName, args);
  return keyArg ? `${verb} ${toolName} (${keyArg})` : `${verb} ${toolName}`;
}

/**
 * Pure string / preview formatters for ToolCallComponent.
 * No component instance state — keep stateful entrance / snapshot logic in
 * tool-call-entrance.ts / tool-call.ts.
 */

import { isAbsolute, relative, sep } from 'node:path';

import {
  STREAMING_ARGS_FIELD_RE,
  STREAMING_ARGS_PREVIEW_MAX_CHARS,
} from '#/tui/constant/streaming';
import type { TokenUsage } from '@superliora/sdk';

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

function unescapeJsonString(s: string): string {
  return s.replaceAll(/\\(["\\/bfnrt])/g, (_, ch: string) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '/':
        return '/';
      default:
        return ch;
    }
  });
}

/**
 * Pull the live value of a JSON string field out of partially-streamed
 * arguments, even if the closing quote hasn't arrived yet. Handles the
 * common JSON string escapes so `\n` in a streamed `content` becomes a
 * real newline we can highlight. Returns `undefined` if the field hasn't
 * started streaming yet.
 */
export function extractPartialStringField(text: string, key: string): string | undefined {
  const opener = new RegExp(`"${key}"\\s*:\\s*"`);
  const match = opener.exec(text);
  if (match === null) return undefined;
  const start = match.index + match[0].length;
  let out = '';
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) return out;
      switch (next) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        case 'u': {
          if (i + 5 >= text.length) return out;
          const hex = text.slice(i + 2, i + 6);
          const code = Number.parseInt(hex, 16);
          if (Number.isNaN(code)) return out;
          out += String.fromCodePoint(code);
          i += 6;
          continue;
        }
        default:
          out += next;
      }
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i++;
  }
  return out;
}

export function parseArgsPreview(value: string): Record<string, unknown> {
  const previewText = value.slice(0, STREAMING_ARGS_PREVIEW_MAX_CHARS);
  if (previewText.trim().length === 0) return {};
  if (
    value.length <= STREAMING_ARGS_PREVIEW_MAX_CHARS &&
    previewText.trimEnd().endsWith('}')
  ) {
    try {
      const parsed = JSON.parse(previewText) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to partial scan
    }
  }
  const result: Record<string, unknown> = {};
  for (const match of previewText.matchAll(STREAMING_ARGS_FIELD_RE)) {
    const key = match[1];
    const rawValue = match[2];
    if (key === undefined || rawValue === undefined) continue;
    if (!(key in result)) result[key] = unescapeJsonString(rawValue);
  }
  return result;
}

const PATH_KEYS = new Set(['path', 'file_path']);

function truncateArgValue(key: string, value: string): string {
  if (value.length <= MAX_ARG_LENGTH) return value;
  if (PATH_KEYS.has(key)) {
    // Preserve the tail (filename) — drop the prefix so the user can
    // still tell which file is being touched.
    return '…' + value.slice(value.length - (MAX_ARG_LENGTH - 1));
  }
  return value.slice(0, MAX_ARG_LENGTH - 3) + '...';
}

export function makeWorkspaceRelativePath(filePath: string, workspaceDir: string | undefined): string {
  if (workspaceDir === undefined || workspaceDir.length === 0 || !isAbsolute(filePath)) {
    return filePath;
  }
  const relativePath = relative(workspaceDir, filePath);
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return filePath;
  }
  return relativePath;
}

function formatKeyArgument(
  toolName: string,
  key: string,
  value: string,
  workspaceDir: string | undefined,
): string {
  const displayValue =
    toolName === 'Read' && PATH_KEYS.has(key)
      ? makeWorkspaceRelativePath(value, workspaceDir)
      : value;
  return truncateArgValue(key, displayValue);
}

export function extractKeyArgument(
  toolName: string,
  args: Record<string, unknown>,
  workspaceDir?: string,
): string | null {
  const keyMap: Record<string, string[]> = {
    Bash: ['command'],
    Read: ['path', 'file_path'],
    LioraRead: ['path', 'file_path'],
    LioraSymbol: ['name', 'path'],
    LioraTree: ['path'],
    Expand: ['id'],
    LioraCallgraph: ['symbol', 'path'],
    Write: ['path', 'file_path'],
    GenerateImage: ['path', 'prompt'],
    GenerateVideo: ['path', 'prompt'],
    Edit: ['path', 'file_path'],
    Grep: ['pattern'],
    Glob: ['pattern'],
    FetchURL: ['url'],
    WebSearch: ['query'],
    Context7Resolve: ['library_name', 'query'],
    Context7Docs: ['library_id', 'query'],
    SearchSkill: ['query', 'keywords'],
    SearchExpert: ['query', 'keywords'],
    Skill: ['skill', 'name', 'args'],
    Memory: ['search', 'write', 'read', 'list', 'forget'],
    NextPhase: ['phase'],
    RecordInterviewFinding: ['origin', 'question_answered'],
    EnterPlanMode: ['ultra'],
    ExitPlanMode: ['options'],
    AskUserQuestion: ['questions', 'header'],
    LioraReview: ['diff_source', 'from_ref', 'to_ref'],
    Review: ['diff_source', 'from_ref', 'to_ref'],
    TaskList: ['active_only', 'limit'],
    TaskOutput: ['task_id'],
    TaskStop: ['task_id'],
    CronList: [],
    CronCreate: ['cron', 'prompt'],
    CronDelete: ['id'],
    TaskGraph: ['run_id', 'graph_id'],
    UltraworkGraph: ['run_id', 'graph_id'],
    SwarmChannel: ['action', 'channel', 'body'],
    // Prefer short description for Agent so multi-line prompts never spill into chrome.
    Agent: ['description', 'subagent_type', 'resume', 'prompt'],
    AgentSwarm: ['description', 'tasks'],
    UltraSwarm: ['description', 'task'],
    BrowserStatus: ['url'],
    BrowserObserve: ['url'],
    BrowserScreenshot: ['url', 'full_page'],
    BrowserAct: ['actions'],
    BrowserConsole: ['url'],
    ComputerCapture: ['mode', 'app'],
    ComputerAct: ['actions'],
    ComputerStatus: ['app'],
    TodoList: ['todos'],
  };

  // Glob: concatenate multiple args into a single summary so the header
  // shows pattern, optional explicit path, and ignored-file inclusion.
  if (toolName === 'Glob') {
    const pattern = args['pattern'];
    if (typeof pattern !== 'string' || pattern.length === 0) return null;
    let summary = pattern;
    const path = args['path'];
    if (typeof path === 'string' && path.length > 0) {
      summary += ` · ${makeWorkspaceRelativePath(path, workspaceDir)}`;
    }
    if (args['include_ignored'] === true) {
      summary += ' · include ignored';
    }
    return truncateArgValue('pattern', summary);
  }

  const candidates = keyMap[toolName] ?? Object.keys(args);
  for (const key of candidates) {
    const val = args[key];
    if (typeof val === 'string' && val.length > 0) {
      const firstLine = val.split('\n')[0] ?? val;
      const displayValue =
        toolName === 'Bash' && val.includes('\n') ? `${firstLine}…` : firstLine;
      return formatKeyArgument(toolName, key, displayValue, workspaceDir);
    }
  }
  return null;
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
  workspaceDir?: string,
): string {
  const keyArg = extractKeyArgument(toolName, args, workspaceDir);
  return keyArg ? `${verb} ${toolName} (${keyArg})` : `${verb} ${toolName}`;
}

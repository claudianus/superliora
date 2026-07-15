/**
 * Header chip providers — produce a short "stat" suffix appended to the
 * tool call header once a result has arrived. Chips own the *numeric*
 * summary (line counts, exit codes, byte sizes), so summary renderers
 * below don't repeat them.
 *
 * A chip returning `''` is suppressed; tools without an entry in the
 * registry get no chip at all.
 */

import { computeDiffLines } from '#/tui/components/media/diff-preview';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import { goalStatusChip } from './goal';
import { readMediaChip } from './media';
import { strArg } from './types';

export type ChipProvider = (toolCall: ToolCallBlockData, result: ToolResultBlockData) => string;

export function countNonEmptyLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (const line of text.split('\n')) if (line.length > 0) n++;
  return n;
}

function pluralize(n: number, singular: string, plural?: string): string {
  return `${String(n)} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface EditStats {
  readonly added: number;
  readonly removed: number;
}

export interface WriteStats {
  readonly lines: number;
}

export function computeEditStats(args: Record<string, unknown>): EditStats {
  const oldStr = strArg(args, 'old_string');
  const newStr = strArg(args, 'new_string');
  if (oldStr.length === 0 && newStr.length === 0) return { added: 0, removed: 0 };
  const diff = computeDiffLines(oldStr, newStr);
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.kind === 'add') added++;
    else if (line.kind === 'delete') removed++;
  }
  return { added, removed };
}

export function computeWriteStats(args: Record<string, unknown>): WriteStats {
  const content = strArg(args, 'content');
  const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
  const lines = normalized.length > 0 ? normalized.split('\n').length : 0;
  return { lines };
}

export function formatEditChip(stats: EditStats): string {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`+${String(stats.added)}`);
  if (stats.removed > 0) parts.push(`-${String(stats.removed)}`);
  return parts.join(' ');
}

export function formatWriteChip(stats: WriteStats): string {
  return pluralize(stats.lines, 'line');
}

const editChip: ChipProvider = (toolCall) => {
  const stats = computeEditStats(toolCall.args);
  if (stats.added === 0 && stats.removed === 0) return '';
  return formatEditChip(stats);
};

const writeChip: ChipProvider = (toolCall) => formatWriteChip(computeWriteStats(toolCall.args));

/** Parse GenerateImage/GenerateVideo tool output: Path / Bytes / MIME lines. */
function generateMediaChip(result: ToolResultBlockData): string {
  if (result.is_error) return '';
  let path: string | undefined;
  let bytes: string | undefined;
  let mime: string | undefined;
  for (const line of result.output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Path:')) path = trimmed.slice('Path:'.length).trim();
    else if (trimmed.startsWith('Bytes:')) bytes = trimmed.slice('Bytes:'.length).trim();
    else if (trimmed.startsWith('MIME:')) mime = trimmed.slice('MIME:'.length).trim();
  }
  const parts: string[] = [];
  if (path !== undefined && path.length > 0) {
    const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
    parts.push(base);
  }
  if (bytes !== undefined && bytes.length > 0) {
    const n = Number(bytes);
    parts.push(Number.isFinite(n) ? formatBytes(n) : bytes);
  } else if (mime !== undefined && mime.length > 0) {
    parts.push(mime);
  }
  return parts.join(' · ');
}

const generateImageChip: ChipProvider = (_toolCall, result) => generateMediaChip(result);
const generateVideoChip: ChipProvider = (_toolCall, result) => generateMediaChip(result);

const readChip: ChipProvider = (_toolCall, result) =>
  pluralize(countNonEmptyLines(result.output), 'line');

const grepChip: ChipProvider = (_toolCall, result) => {
  const matches = countNonEmptyLines(result.output);
  if (matches === 0) return 'no matches';
  return pluralize(matches, 'match', 'matches');
};

const globChip: ChipProvider = (_toolCall, result) => {
  const files = countNonEmptyLines(result.output);
  if (files === 0) return 'no files';
  return pluralize(files, 'file');
};

const fetchChip: ChipProvider = (_toolCall, result) =>
  formatBytes(Buffer.byteLength(result.output, 'utf8'));

const webSearchChip: ChipProvider = (_toolCall, result) => {
  if (result.output.includes('No search results found.')) return 'no results';
  let count = 0;
  for (const line of result.output.split('\n')) {
    if (/^\s*Title:\s+/.test(line)) count++;
  }
  if (count === 0) {
    // Fallback for hosts that emit numbered/bullet lists instead of Title: lines.
    for (const line of result.output.split('\n')) {
      if (/^\s*(\d+\.|[-*])\s+/.test(line)) count++;
    }
  }
  if (count === 0) return result.output.trim().length === 0 ? 'no results' : 'web result';
  return pluralize(count, 'result');
};
const lioraReadChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  const mode = /mode="([^"]+)"/.exec(result.output)?.[1];
  const rendered = /rendered_lines:\s+(\d+)/.exec(result.output)?.[1];
  const total = /total_lines:\s+(\d+)/.exec(result.output)?.[1];
  if (rendered !== undefined && total !== undefined) {
    const base = `${rendered}/${total} lines`;
    return mode !== undefined ? `${mode} · ${base}` : base;
  }
  return pluralize(countNonEmptyLines(result.output), 'line');
};

const lioraSymbolChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  const defs = /definitions:\s+(\d+)/.exec(result.output)?.[1];
  const refs = /references:\s+(\d+)/.exec(result.output)?.[1];
  if (defs === undefined && refs === undefined) return '';
  const parts: string[] = [];
  if (defs !== undefined) parts.push(`${defs} def${defs === '1' ? '' : 's'}`);
  if (refs !== undefined) parts.push(`${refs} ref${refs === '1' ? '' : 's'}`);
  return parts.join(' · ');
};

const lioraTreeChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  // Count tree body lines between the wrapper tags (exclude open/close tags).
  let count = 0;
  for (const line of result.output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('<liora_tree') || trimmed.startsWith('</liora_tree')) continue;
    count++;
  }
  if (count === 0) return 'empty';
  return pluralize(count, 'entry', 'entries');
};

const lioraExpandChip: ChipProvider = (toolCall, result) => {
  if (result.is_error) return '';
  const window = /window:\s+(\d+)-(\d+)\s+of\s+(\d+)/.exec(result.output);
  if (window !== null) {
    return `${window[1]}-${window[2]}/${window[3]} lines`;
  }
  const id = typeof toolCall.args['id'] === 'string' ? toolCall.args['id'] : '';
  return id.length > 0 ? id : pluralize(countNonEmptyLines(result.output), 'line');
};

const lioraCallgraphChip: ChipProvider = (toolCall, result) => {
  if (result.is_error) return '';
  const symbol = typeof toolCall.args['symbol'] === 'string' ? toolCall.args['symbol'] : '';
  const edges = countNonEmptyLines(result.output);
  if (symbol.length > 0 && edges > 0) return `${symbol} · ${pluralize(edges, 'line')}`;
  if (symbol.length > 0) return symbol;
  return pluralize(edges, 'line');
};
const context7ResolveChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  if (result.output.includes('No libraries found')) return 'no libraries';
  let count = 0;
  for (const line of result.output.split('\n')) {
    // Prefer library IDs so Title+ID pairs are not double-counted.
    if (/library ID:\s*\/\S+/i.test(line)) count++;
  }
  if (count === 0) {
    for (const line of result.output.split('\n')) {
      if (/^\s*-?\s*Title:\s+/i.test(line)) count++;
    }
  }
  if (count === 0) {
    for (const line of result.output.split('\n')) {
      if (/^\s*[-*]\s+\S/.test(line)) count++;
    }
  }
  if (count === 0) return result.output.trim().length === 0 ? 'no libraries' : 'library match';
  return pluralize(count, 'library', 'libraries');
};

const context7DocsChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  if (result.output.includes('No documentation snippets matched')) return 'no snippets';
  let count = 0;
  for (const line of result.output.split('\n')) {
    if (/^\s*Title:\s+/i.test(line) || /^\s*#\s+\S/.test(line)) count++;
  }
  if (count === 0) {
    const lines = countNonEmptyLines(result.output);
    return lines === 0 ? 'no snippets' : pluralize(lines, 'line');
  }
  return pluralize(count, 'snippet');
};



const goalStatusOutputChip: ChipProvider = (_toolCall, result) =>
  result.is_error ? '' : goalStatusChip(result.output);

const REGISTRY: Record<string, ChipProvider> = {
  Edit: editChip,
  Write: writeChip,
  GenerateImage: generateImageChip,
  GenerateVideo: generateVideoChip,
  Read: readChip,
  LioraRead: lioraReadChip,
  LioraSymbol: lioraSymbolChip,
  LioraTree: lioraTreeChip,
  LioraExpand: lioraExpandChip,
  LioraCallgraph: lioraCallgraphChip,
  ReadMediaFile: readMediaChip,
  Grep: grepChip,
  Glob: globChip,
  FetchURL: fetchChip,
  WebSearch: webSearchChip,
  Context7Resolve: context7ResolveChip,
  Context7Docs: context7DocsChip,
  CreateGoal: goalStatusOutputChip,
  GetGoal: goalStatusOutputChip,
};

export function pickChip(toolName: string): ChipProvider | undefined {
  return REGISTRY[toolName];
}

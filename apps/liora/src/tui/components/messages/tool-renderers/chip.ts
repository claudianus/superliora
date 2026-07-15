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

const searchSkillChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  let count = 0;
  for (const line of result.output.split('\n')) {
    if (/<skill-candidate\b/.test(line)) count++;
  }
  if (count === 0) {
    return result.output.trim().length === 0
      ? 'no skills'
      : pluralize(countNonEmptyLines(result.output), 'line');
  }
  return pluralize(count, 'skill');
};

const searchExpertChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  let count = 0;
  for (const line of result.output.split('\n')) {
    if (/<expert-candidate\b/.test(line)) count++;
  }
  if (count === 0) {
    return result.output.trim().length === 0
      ? 'no experts'
      : pluralize(countNonEmptyLines(result.output), 'line');
  }
  return pluralize(count, 'expert');
};
const skillChip: ChipProvider = (toolCall, result) => {
  if (result.is_error) return '';
  if (/loaded inline/i.test(result.output)) return 'loaded';
  const skill =
    typeof toolCall.args['skill'] === 'string'
      ? toolCall.args['skill']
      : typeof toolCall.args['name'] === 'string'
        ? toolCall.args['name']
        : '';
  return skill.length > 0 ? skill : 'ok';
};

const memoryChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  if (/Memory saved:/i.test(result.output)) return 'saved';
  if (/Memory forgotten:/i.test(result.output)) return 'forgotten';
  if (/No memory found:/i.test(result.output)) return 'missing';
  if (/Liora Recall is disabled/i.test(result.output)) return 'disabled';
  // Numbered search/list rows: "1. score=..." or "1. [id]"
  let count = 0;
  for (const line of result.output.split('\n')) {
    if (/^\s*\d+\.\s+/.test(line)) count++;
  }
  if (count > 0) return pluralize(count, 'memory', 'memories');
  if (/Subject:/i.test(result.output)) return '1 memory';
  return result.output.trim().length === 0 ? 'empty' : 'ok';
};
const nextPhaseChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  const m = /Advanced from (\w+) phase to (\w+) phase/i.exec(result.output);
  if (m) return `${m[1]}→${m[2]}`;
  return 'ok';
};

const recordInterviewFindingChip: ChipProvider = (toolCall, result) => {
  if (result.is_error) return '';
  const origin =
    typeof toolCall.args['origin'] === 'string'
      ? toolCall.args['origin']
      : /Recorded (\w+) finding/i.exec(result.output)?.[1];
  return origin !== undefined && origin.length > 0 ? origin : 'recorded';
};

const getCurrentTimeChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  try {
    const parsed = JSON.parse(result.output) as { iso?: unknown; local?: unknown };
    if (typeof parsed.local === 'string' && parsed.local.length > 0) return parsed.local;
    if (typeof parsed.iso === 'string' && parsed.iso.length > 0) return parsed.iso.slice(0, 19);
  } catch {
    // fall through
  }
  const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.exec(result.output)?.[0];
  return iso ?? 'now';
};

const enterPlanModeChip: ChipProvider = (toolCall, result) => {
  if (result.is_error) return '';
  if (toolCall.args['ultra'] === true || /Ultra Plan/i.test(result.output)) return 'ultra';
  return 'entered';
};

const exitPlanModeChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) {
    if (/blocked/i.test(result.output)) return 'blocked';
    if (/missing/i.test(result.output)) return 'incomplete';
    return 'error';
  }
  return 'submitted';
};
const askUserQuestionChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  try {
    const parsed = JSON.parse(result.output) as { answers?: unknown };
    if (Array.isArray(parsed.answers)) {
      const n = parsed.answers.length;
      return n === 0 ? 'no answers' : pluralize(n, 'answer');
    }
    if (parsed.answers !== undefined && typeof parsed.answers === 'object' && parsed.answers !== null) {
      const n = Object.keys(parsed.answers as Record<string, unknown>).length;
      return n === 0 ? 'no answers' : pluralize(n, 'answer');
    }
  } catch {
    // fall through
  }
  return result.output.trim().length === 0 ? 'no answers' : 'answered';
};

const lioraReviewChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  if (/No changes to review/i.test(result.output) || /diff is empty/i.test(result.output)) {
    return 'empty diff';
  }
  if (/No issues found/i.test(result.output)) return 'clean';
  let findings = 0;
  for (const line of result.output.split('\n')) {
    if (/^\s*-\s+\*\*/.test(line) || /^\s*-\s+\*\*[A-Z]+/.test(line)) findings++;
    else if (/^\s*-\s+\*\*(?:WARNING|SUGGESTION|ERROR|INFO)\*\*/i.test(line)) findings++;
  }
  if (findings === 0) {
    // Count markdown finding bullets under ## Findings
    let inFindings = false;
    for (const line of result.output.split('\n')) {
      if (/^##\s+Findings/i.test(line.trim())) {
        inFindings = true;
        continue;
      }
      if (inFindings && /^##\s+/.test(line.trim())) break;
      if (inFindings && /^\s*-\s+/.test(line)) findings++;
    }
  }
  if (findings > 0) return pluralize(findings, 'finding');
  const files = /Files reviewed:\s+(\d+)/i.exec(result.output)?.[1];
  return files !== undefined ? `${files} files` : 'reviewed';
};
const taskListChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  const m = /(?:active_background_tasks|background_tasks):\s*(\d+)/i.exec(result.output);
  if (m) {
    const n = Number(m[1]);
    return n === 0 ? 'none' : pluralize(n, 'task');
  }
  if (/No background tasks found/i.test(result.output)) return 'none';
  return 'tasks';
};

const taskOutputChip: ChipProvider = (toolCall, result) => {
  if (result.is_error) return '';
  const status = /status:\s*([a-z_]+)/i.exec(result.output)?.[1];
  if (status !== undefined) return status;
  const id = typeof toolCall.args['task_id'] === 'string' ? toolCall.args['task_id'] : '';
  return id.length > 0 ? id : 'output';
};

const taskStopChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) {
    if (/not found/i.test(result.output)) return 'missing';
    return 'failed';
  }
  if (/stopped|killed|cancelled/i.test(result.output)) return 'stopped';
  return 'ok';
};
const cronListChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  const m = /cron_jobs:\s*(\d+)/i.exec(result.output);
  if (m) {
    const n = Number(m[1]);
    return n === 0 ? 'none' : pluralize(n, 'job');
  }
  if (/No cron jobs scheduled/i.test(result.output)) return 'none';
  return 'jobs';
};

const cronCreateChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  const id = /^id:\s*(\S+)/m.exec(result.output)?.[1];
  return id !== undefined ? id : 'scheduled';
};

const cronDeleteChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) {
    if (/No cron job/i.test(result.output) || /not found/i.test(result.output)) return 'missing';
    return 'failed';
  }
  return 'deleted';
};
const ultraworkGraphChip: ChipProvider = (_toolCall, result) => {
  if (result.is_error) return '';
  if (/Ultrawork graph is empty/i.test(result.output)) return 'empty';
  const updated = /Ultrawork graph updated:\s*(\d+)\s+nodes/i.exec(result.output);
  if (updated) return `${updated[1]} nodes`;
  let count = 0;
  for (const line of result.output.split('\n')) {
    if (/^\s*\[[^\]]+\]\s+\S+:/.test(line)) count++;
  }
  if (count > 0) return pluralize(count, 'node');
  return 'graph';
};

const swarmChannelChip: ChipProvider = (toolCall, result) => {
  if (result.is_error) return '';
  const action = typeof toolCall.args['action'] === 'string' ? toolCall.args['action'] : '';
  if (/Posted to Swarm bus/i.test(result.output)) return 'posted';
  if (/No Swarm bus messages/i.test(result.output)) return 'empty';
  if (action === 'list' || /^\s*\[/.test(result.output)) {
    let count = 0;
    for (const line of result.output.split('\n')) {
      if (/^\s*\[.+\]\s+/.test(line)) count++;
    }
    if (count > 0) return pluralize(count, 'msg');
  }
  if (action === 'artifact' || /artifact/i.test(result.output)) return 'artifact';
  if (action === 'reply') return 'reply';
  return action.length > 0 ? action : 'ok';
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
  SearchSkill: searchSkillChip,
  SearchExpert: searchExpertChip,
  Skill: skillChip,
  Memory: memoryChip,
  NextPhase: nextPhaseChip,
  RecordInterviewFinding: recordInterviewFindingChip,
  GetCurrentTime: getCurrentTimeChip,
  EnterPlanMode: enterPlanModeChip,
  ExitPlanMode: exitPlanModeChip,
  AskUserQuestion: askUserQuestionChip,
  LioraReview: lioraReviewChip,
  TaskList: taskListChip,
  TaskOutput: taskOutputChip,
  TaskStop: taskStopChip,
  CronList: cronListChip,
  CronCreate: cronCreateChip,
  CronDelete: cronDeleteChip,
  UltraworkGraph: ultraworkGraphChip,
  SwarmChannel: swarmChannelChip,
  CreateGoal: goalStatusOutputChip,
  GetGoal: goalStatusOutputChip,
};

export function pickChip(toolName: string): ChipProvider | undefined {
  return REGISTRY[toolName];
}

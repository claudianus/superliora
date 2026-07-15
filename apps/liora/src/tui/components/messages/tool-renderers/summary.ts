/**
 * Summary-style renderers — produce optional inline-glance content for
 * tools whose raw output is high-volume but low-information (Grep,
 * Glob). The numeric summary (line counts, exit codes, sizes) lives in
 * the header chip (see chip.ts), so most tools intentionally render an
 * empty body and only expose details when the global expand toggle is
 * on.
 *
 * Errors always fall through to the truncated renderer so the user
 * sees the actual error message, not a synthetic summary.
 */

import type { Component } from '#/tui/renderer';
import { Text } from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import { renderTruncated } from './truncated';
import type { ResultRenderer } from './types';

const GLANCE_SAMPLES = 3;

type GlanceFn = (
  toolCall: Parameters<ResultRenderer>[0],
  result: Parameters<ResultRenderer>[1],
) => string;

function withGlance(glance: GlanceFn | null): ResultRenderer {
  return (toolCall, result, ctx) => {
    if (result.is_error) return renderTruncated(toolCall, result, ctx);

    const out: Component[] = [];
    if (glance !== null) {
      const line = glance(toolCall, result);
      if (line.length > 0) {
        out.push(new Text(`  ${currentTheme.dim(line)}`, 0, 0));
      }
    }
    if (ctx.expanded && result.output.length > 0) {
      out.push(new Text(currentTheme.dim(result.output), 4, 0));
    }
    return out;
  };
}

function nonEmptyLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split('\n').filter((line) => line.length > 0);
}

// Strip a trailing `:line:col:text` so the glance shows the file path
// only, even when grep is in `content` mode (`src/foo.ts:42:    foo()`).
function pathFromGrepLine(line: string): string {
  const idx = line.indexOf(':');
  if (idx <= 0) return line;
  const second = line.indexOf(':', idx + 1);
  if (second <= 0) return line;
  return line.slice(0, second);
}

const grepGlance: GlanceFn = (_toolCall, result) => {
  const lines = nonEmptyLines(result.output);
  if (lines.length === 0) return '';
  const samples = lines.slice(0, GLANCE_SAMPLES).map(pathFromGrepLine);
  const remaining = lines.length - samples.length;
  const tail = remaining > 0 ? `, +${String(remaining)} more` : '';
  return `${samples.join(', ')}${tail}`;
};

const globGlance: GlanceFn = (_toolCall, result) => {
  const lines = nonEmptyLines(result.output);
  if (lines.length === 0) return '';
  const samples = lines.slice(0, GLANCE_SAMPLES);
  const remaining = lines.length - samples.length;
  const tail = remaining > 0 ? `, +${String(remaining)} more` : '';
  return `${samples.join(', ')}${tail}`;
};
const lioraReadGlance: GlanceFn = (_toolCall, result) => {
  const mode = /mode="([^"]+)"/.exec(result.output)?.[1];
  const summary = /summary:\s+(.+)$/m.exec(result.output)?.[1]?.trim();
  if (summary !== undefined && summary.length > 0) {
    return mode !== undefined ? `${mode} · ${summary}` : summary;
  }
  // Fallback: first non-meta content line.
  for (const line of result.output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('<tool_meta') || trimmed.startsWith('</tool_meta')) {
      continue;
    }
    if (trimmed.startsWith('truncated:') || trimmed.startsWith('partial:') || trimmed.startsWith('summary:')) {
      continue;
    }
    return trimmed.slice(0, 80);
  }
  return '';
};

const lioraSymbolGlance: GlanceFn = (_toolCall, result) => {
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('- ')) continue;
    samples.push(trimmed.slice(2).trim());
    if (samples.length >= GLANCE_SAMPLES) break;
  }
  if (samples.length === 0) return '';
  return samples.join(' · ');
};

const lioraTreeGlance: GlanceFn = (_toolCall, result) => {
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('<liora_tree') || trimmed.startsWith('</liora_tree')) continue;
    samples.push(trimmed);
    if (samples.length >= GLANCE_SAMPLES) break;
  }
  if (samples.length === 0) return '';
  const remaining = Math.max(0, countTreeEntries(result.output) - samples.length);
  const tail = remaining > 0 ? `, +${String(remaining)} more` : '';
  return `${samples.join(', ')}${tail}`;
};

function countTreeEntries(output: string): number {
  let count = 0;
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('<liora_tree') || trimmed.startsWith('</liora_tree')) continue;
    count++;
  }
  return count;
}

const lioraExpandGlance: GlanceFn = (toolCall, result) => {
  const id = typeof toolCall.args['id'] === 'string' ? toolCall.args['id'] : '';
  const window = /window:\s+(\d+)-(\d+)\s+of\s+(\d+)/.exec(result.output);
  if (window !== null) {
    const base = `lines ${window[1]}-${window[2]} of ${window[3]}`;
    return id.length > 0 ? `${id} · ${base}` : base;
  }
  const label = /label="([^"]+)"/.exec(result.output)?.[1];
  if (id.length > 0 && label !== undefined) return `${id} · ${label}`;
  return id;
};

const lioraCallgraphGlance: GlanceFn = (toolCall, result) => {
  const symbol = typeof toolCall.args['symbol'] === 'string' ? toolCall.args['symbol'] : '';
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('<') || trimmed.startsWith('direction:') || trimmed.startsWith('symbol:')) {
      continue;
    }
    samples.push(trimmed.slice(0, 60));
    if (samples.length >= GLANCE_SAMPLES) break;
  }
  if (samples.length === 0) return symbol;
  const head = symbol.length > 0 ? `${symbol} · ` : '';
  return `${head}${samples.join(' · ')}`;
};
const context7ResolveGlance: GlanceFn = (_toolCall, result) => {
  if (result.output.includes('No libraries found')) return 'no libraries';
  const samples: string[] = [];
  let pendingTitle: string | undefined;
  for (const line of result.output.split('\n')) {
    const title = /^\s*-?\s*Title:\s+(.+)$/i.exec(line)?.[1]?.trim();
    if (title !== undefined) {
      pendingTitle = title;
      continue;
    }
    const id = /library ID:\s*(\/\S+)/i.exec(line)?.[1];
    if (id !== undefined) {
      samples.push(pendingTitle !== undefined ? `${pendingTitle} (${id})` : id);
      pendingTitle = undefined;
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length === 0 && pendingTitle !== undefined) samples.push(pendingTitle);
  return samples.join(' · ');
};

const context7DocsGlance: GlanceFn = (toolCall, result) => {
  if (result.output.includes('No documentation snippets matched')) return 'no snippets';
  const libraryId = typeof toolCall.args['library_id'] === 'string' ? toolCall.args['library_id'] : '';
  const titles: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /^\s*Title:\s+(.+)$/i.exec(line) ?? /^\s*#\s+(.+)$/.exec(line);
    if (m && m[1] !== undefined) titles.push(m[1].trim());
    if (titles.length >= GLANCE_SAMPLES) break;
  }
  if (titles.length === 0) {
    const preview = result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
    if (libraryId.length > 0 && preview.length > 0) return `${libraryId} · ${preview}${result.output.trim().length > 72 ? '…' : ''}`;
    return libraryId.length > 0 ? libraryId : preview;
  }
  const head = libraryId.length > 0 ? `${libraryId} · ` : '';
  return `${head}${titles.join(' · ')}`;
};
const searchSkillGlance: GlanceFn = (_toolCall, result) => {
  const names: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /name="([^"]+)"/.exec(line);
    if (m && m[1] !== undefined && /<skill-candidate\b/.test(line)) {
      names.push(m[1]);
      if (names.length >= GLANCE_SAMPLES) break;
    }
  }
  return names.join(' · ');
};

const searchExpertGlance: GlanceFn = (_toolCall, result) => {
  const names: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /name="([^"]+)"/.exec(line);
    if (m && m[1] !== undefined && /<expert-candidate\b/.test(line)) {
      names.push(m[1]);
      if (names.length >= GLANCE_SAMPLES) break;
    }
  }
  return names.join(' · ');
};
const skillGlance: GlanceFn = (toolCall, result) => {
  const skill =
    typeof toolCall.args['skill'] === 'string'
      ? toolCall.args['skill']
      : typeof toolCall.args['name'] === 'string'
        ? toolCall.args['name']
        : '';
  if (/loaded inline/i.test(result.output)) {
    return skill.length > 0 ? `${skill} loaded` : 'skill loaded';
  }
  const first = result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
  if (skill.length > 0 && first.length > 0) return `${skill} · ${first}`;
  return skill.length > 0 ? skill : first;
};

const memoryGlance: GlanceFn = (toolCall, result) => {
  const action =
    typeof toolCall.args['write'] === 'object' && toolCall.args['write'] !== null
      ? 'write'
      : typeof toolCall.args['search'] === 'object' && toolCall.args['search'] !== null
        ? 'search'
        : typeof toolCall.args['read'] === 'object' && toolCall.args['read'] !== null
          ? 'read'
          : typeof toolCall.args['forget'] === 'object' && toolCall.args['forget'] !== null
            ? 'forget'
            : typeof toolCall.args['list'] === 'object' && toolCall.args['list'] !== null
              ? 'list'
              : '';
  const subjects: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /^Subject:\s+(.+)$/i.exec(line.trim());
    if (m && m[1] !== undefined) {
      subjects.push(m[1].trim());
      if (subjects.length >= GLANCE_SAMPLES) break;
    }
  }
  if (subjects.length > 0) {
    const head = action.length > 0 ? `${action} · ` : '';
    return `${head}${subjects.join(' · ')}`;
  }
  const first = result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
  if (action.length > 0 && first.length > 0) return `${action} · ${first}`;
  return action.length > 0 ? action : first;
};
const nextPhaseGlance: GlanceFn = (_toolCall, result) => {
  const m = /Advanced from (\w+) phase to (\w+) phase/i.exec(result.output);
  if (m) return `${m[1]} → ${m[2]}`;
  const first = result.output.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  return first.slice(0, 80);
};

const recordInterviewFindingGlance: GlanceFn = (toolCall, result) => {
  const question =
    typeof toolCall.args['question_answered'] === 'string' ? toolCall.args['question_answered'] : '';
  const origin = typeof toolCall.args['origin'] === 'string' ? toolCall.args['origin'] : '';
  if (origin.length > 0 && question.length > 0) return `${origin}: ${question.slice(0, 60)}`;
  if (question.length > 0) return question.slice(0, 72);
  const m = /Recorded (\w+) finding for:\s*(.+)/i.exec(result.output);
  if (m) return `${m[1]}: ${m[2]!.slice(0, 60)}`;
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

const getCurrentTimeGlance: GlanceFn = (_toolCall, result) => {
  try {
    const parsed = JSON.parse(result.output) as {
      iso?: unknown;
      local?: unknown;
      timezone?: unknown;
    };
    const local = typeof parsed.local === 'string' ? parsed.local : undefined;
    const iso = typeof parsed.iso === 'string' ? parsed.iso : undefined;
    const tz = typeof parsed.timezone === 'string' ? parsed.timezone : undefined;
    const when = local ?? iso ?? '';
    if (when.length > 0 && tz !== undefined && tz.length > 0) return `${when} · ${tz}`;
    return when;
  } catch {
    return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
  }
};
const askUserQuestionGlance: GlanceFn = (_toolCall, result) => {
  try {
    const parsed = JSON.parse(result.output) as { answers?: unknown };
    if (Array.isArray(parsed.answers)) {
      return parsed.answers
        .slice(0, GLANCE_SAMPLES)
        .map((answer) => String(answer).replaceAll(/\s+/g, ' ').trim().slice(0, 40))
        .filter((s) => s.length > 0)
        .join(' · ');
    }
    if (parsed.answers !== undefined && typeof parsed.answers === 'object' && parsed.answers !== null) {
      return Object.entries(parsed.answers as Record<string, unknown>)
        .slice(0, GLANCE_SAMPLES)
        .map(([key, value]) => `${key}=${String(value).replaceAll(/\s+/g, ' ').trim().slice(0, 28)}`)
        .join(' · ');
    }
  } catch {
    // fall through
  }
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

const lioraReviewGlance: GlanceFn = (_toolCall, result) => {
  if (/No issues found/i.test(result.output)) return 'clean · no findings';
  if (/No changes to review/i.test(result.output)) return 'empty diff';
  const files = /Files reviewed:\s+(\d+)/i.exec(result.output)?.[1];
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /^\s*-\s+\*\*([A-Z]+)\*\*\s+`([^`]+)`\s+—\s+(.+)$/.exec(line.trim());
    if (m) {
      samples.push(`${m[1]} ${m[2]}`);
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length > 0) {
    const head = files !== undefined ? `${files} files · ` : '';
    return `${head}${samples.join(' · ')}`;
  }
  return files !== undefined ? `${files} files reviewed` : result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};
const taskListGlance: GlanceFn = (_toolCall, result) => {
  const m = /(?:active_background_tasks|background_tasks):\s*(\d+)/i.exec(result.output);
  if (m) {
    const n = Number(m[1]);
    if (n === 0) return 'no background tasks';
    return `${n} background task${n === 1 ? '' : 's'}`;
  }
  if (/No background tasks found/i.test(result.output)) return 'no background tasks';
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

const taskOutputGlance: GlanceFn = (toolCall, result) => {
  const id = typeof toolCall.args['task_id'] === 'string' ? toolCall.args['task_id'] : '';
  const status = /status:\s*([a-z_]+)/i.exec(result.output)?.[1];
  const path = /output_path:\s*(\S+)/i.exec(result.output)?.[1];
  const parts: string[] = [];
  if (id.length > 0) parts.push(id);
  if (status !== undefined) parts.push(status);
  if (path !== undefined) parts.push(path);
  if (parts.length > 0) return parts.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};
const cronListGlance: GlanceFn = (_toolCall, result) => {
  const m = /cron_jobs:\s*(\d+)/i.exec(result.output);
  if (m) {
    const n = Number(m[1]);
    if (n === 0) return 'no cron jobs';
    return `${n} cron job${n === 1 ? '' : 's'}`;
  }
  if (/No cron jobs scheduled/i.test(result.output)) return 'no cron jobs';
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

const cronCreateGlance: GlanceFn = (_toolCall, result) => {
  const id = /^id:\s*(\S+)/m.exec(result.output)?.[1];
  const cron = /^cron:\s*(.+)$/m.exec(result.output)?.[1]?.trim();
  const next = /^nextFireAt:\s*(.+)$/m.exec(result.output)?.[1]?.trim();
  const parts: string[] = [];
  if (id !== undefined) parts.push(id);
  if (cron !== undefined) parts.push(cron);
  if (next !== undefined && next !== 'null') parts.push(`next ${next}`);
  if (parts.length > 0) return parts.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};
const ultraworkGraphGlance: GlanceFn = (_toolCall, result) => {
  if (/Ultrawork graph is empty/i.test(result.output)) return 'empty graph';
  const updated = /Ultrawork graph updated:\s*(\d+)\s+nodes,\s*(\d+)\s+task events/i.exec(result.output);
  if (updated) return `updated · ${updated[1]} nodes · ${updated[2]} events`;
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /^\s*\[([^\]]+)\]\s+([^:]+):\s+(.+)$/.exec(line);
    if (m) {
      samples.push(`${m[1]} ${m[2]}`);
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length > 0) return samples.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

const swarmChannelGlance: GlanceFn = (toolCall, result) => {
  if (/No Swarm bus messages/i.test(result.output)) return 'no messages';
  if (/Posted to Swarm bus/i.test(result.output)) {
    const channel = /channel=(\S+)/.exec(result.output)?.[1];
    const kind = /kind=(\S+)/.exec(result.output)?.[1];
    const parts = ['posted'];
    if (channel !== undefined) parts.push(channel);
    if (kind !== undefined) parts.push(kind);
    return parts.join(' · ');
  }
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /^\s*\[.+\]\s+(.+?)\s+→\s+.+?\s+\(([^)]+)\):\s*(.+)$/.exec(line);
    if (m) {
      samples.push(`${m[1]} (${m[2]})`);
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length > 0) return samples.join(' · ');
  const action = typeof toolCall.args['action'] === 'string' ? toolCall.args['action'] : '';
  return action.length > 0 ? action : result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};
const agentGlance: GlanceFn = (_toolCall, result) => {
  const agentId = /^agent_id:\s*(\S+)/m.exec(result.output)?.[1];
  const status = /^status:\s*([a-z_]+)/m.exec(result.output)?.[1];
  const type = /^actual_subagent_type:\s*(\S+)/m.exec(result.output)?.[1];
  const parts: string[] = [];
  if (type !== undefined) parts.push(type);
  if (status !== undefined) parts.push(status);
  if (agentId !== undefined) parts.push(agentId);
  if (parts.length > 0) return parts.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

const agentSwarmGlance: GlanceFn = (_toolCall, result) => {
  const summary = /<summary>([^<]+)<\/summary>/i.exec(result.output)?.[1]?.trim();
  if (summary !== undefined && summary.length > 0) return summary;
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /outcome="([^"]+)"/.exec(line);
    const item = /item="([^"]+)"/.exec(line)?.[1];
    if (m) {
      samples.push(item !== undefined ? `${item}:${m[1]}` : m[1]!);
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length > 0) return samples.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};

const ultraSwarmGlance: GlanceFn = (_toolCall, result) => {
  const summary = /<summary>([^<]+)<\/summary>/i.exec(result.output)?.[1]?.trim();
  const strategy = /<strategy>([^<]+)<\/strategy>/i.exec(result.output)?.[1]?.trim();
  const parts: string[] = [];
  if (strategy !== undefined) parts.push(strategy);
  if (summary !== undefined) parts.push(summary);
  if (parts.length > 0) return parts.join(' · ');
  const samples: string[] = [];
  for (const line of result.output.split('\n')) {
    const name = /name="([^"]+)"/.exec(line)?.[1];
    const outcome = /outcome="([^"]+)"/.exec(line)?.[1];
    if (name !== undefined && outcome !== undefined) {
      samples.push(`${name}:${outcome}`);
      if (samples.length >= GLANCE_SAMPLES) break;
    }
  }
  if (samples.length > 0) return samples.join(' · ');
  return result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
};











// ── Exports ──────────────────────────────────────────────────────────

// Tools whose chip already conveys everything — the body is empty in
// the collapsed state and only the raw output appears when expanded.
export const readSummary: ResultRenderer = withGlance(null);
const fetchGlance: GlanceFn = (toolCall, result) => {
  const url = typeof toolCall.args['url'] === 'string' ? toolCall.args['url'] : '';
  const host = (() => {
    try {
      return url.length > 0 ? new URL(url).host : '';
    } catch {
      return url;
    }
  })();
  const preview = result.output.replaceAll(/\s+/g, ' ').trim().slice(0, 72);
  if (host.length > 0 && preview.length > 0) return `${host} · ${preview}${result.output.trim().length > 72 ? '…' : ''}`;
  if (host.length > 0) return host;
  return preview;
};

export const fetchSummary: ResultRenderer = withGlance(fetchGlance);


const webSearchGlance: GlanceFn = (_toolCall, result) => {
  if (result.output.includes('No search results found.')) return 'no results';
  const titles: string[] = [];
  for (const line of result.output.split('\n')) {
    const m = /^\s*Title:\s+(.+)$/.exec(line);
    if (m && m[1] !== undefined) titles.push(m[1].trim());
    if (titles.length >= GLANCE_SAMPLES) break;
  }
  if (titles.length === 0) return '';
  return titles.join(' · ');
};

export const webSearchSummary: ResultRenderer = withGlance(webSearchGlance);
export const thinkSummary: ResultRenderer = withGlance(null);
export const editSummary: ResultRenderer = withGlance(null);

const generateMediaGlance: GlanceFn = (_toolCall, result) => {
  for (const line of result.output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Path:')) return trimmed.slice('Path:'.length).trim();
  }
  return '';
};

export const generateMediaSummary: ResultRenderer = withGlance(generateMediaGlance);
export const writeSummary: ResultRenderer = withGlance(null);

// Tools that benefit from inline path samples below the chip.
export const grepSummary: ResultRenderer = withGlance(grepGlance);
export const globSummary: ResultRenderer = withGlance(globGlance);
export const lioraReadSummary: ResultRenderer = withGlance(lioraReadGlance);
export const lioraSymbolSummary: ResultRenderer = withGlance(lioraSymbolGlance);
export const lioraTreeSummary: ResultRenderer = withGlance(lioraTreeGlance);
export const lioraExpandSummary: ResultRenderer = withGlance(lioraExpandGlance);
export const lioraCallgraphSummary: ResultRenderer = withGlance(lioraCallgraphGlance);
export const context7ResolveSummary: ResultRenderer = withGlance(context7ResolveGlance);
export const context7DocsSummary: ResultRenderer = withGlance(context7DocsGlance);
export const searchSkillSummary: ResultRenderer = withGlance(searchSkillGlance);
export const searchExpertSummary: ResultRenderer = withGlance(searchExpertGlance);
export const skillSummary: ResultRenderer = withGlance(skillGlance);
export const memorySummary: ResultRenderer = withGlance(memoryGlance);
export const nextPhaseSummary: ResultRenderer = withGlance(nextPhaseGlance);
export const recordInterviewFindingSummary: ResultRenderer = withGlance(recordInterviewFindingGlance);
export const getCurrentTimeSummary: ResultRenderer = withGlance(getCurrentTimeGlance);
export const enterPlanModeSummary: ResultRenderer = withGlance(null);
export const exitPlanModeSummary: ResultRenderer = withGlance(null);
export const askUserQuestionSummary: ResultRenderer = withGlance(askUserQuestionGlance);
export const lioraReviewSummary: ResultRenderer = withGlance(lioraReviewGlance);
export const taskListSummary: ResultRenderer = withGlance(taskListGlance);
export const taskOutputSummary: ResultRenderer = withGlance(taskOutputGlance);
export const taskStopSummary: ResultRenderer = withGlance(null);
export const cronListSummary: ResultRenderer = withGlance(cronListGlance);
export const cronCreateSummary: ResultRenderer = withGlance(cronCreateGlance);
export const cronDeleteSummary: ResultRenderer = withGlance(null);
export const ultraworkGraphSummary: ResultRenderer = withGlance(ultraworkGraphGlance);
export const swarmChannelSummary: ResultRenderer = withGlance(swarmChannelGlance);
export const agentSummary: ResultRenderer = withGlance(agentGlance);
export const agentSwarmSummary: ResultRenderer = withGlance(agentSwarmGlance);
export const ultraSwarmSummary: ResultRenderer = withGlance(ultraSwarmGlance);

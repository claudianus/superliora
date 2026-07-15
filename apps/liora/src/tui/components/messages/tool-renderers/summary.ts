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

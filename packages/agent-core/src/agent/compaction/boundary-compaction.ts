import {
  archiveContent,
  expandArchivedContent,
  formatArchiveMarker,
} from '../../tools/builtin/context/context-archive';
import type { ToolStore } from '../../tools/store';
import {
  collapseForHandoff,
  SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS,
  SWARM_EXPERT_BODY_MAX_CHARS,
} from './handoff-collapse';

export const SWARM_TOTAL_RESULT_MAX_CHARS = 2_000;

export interface BoundaryCompactionOptions {
  readonly expertBodyMaxChars?: number;
  readonly totalResultMaxChars?: number;
  readonly runId?: string;
}

export interface BoundaryCompactionResult {
  readonly output: string;
  readonly archiveIds: readonly string[];
  readonly applied: boolean;
  readonly fallback: boolean;
}

const ULTRA_SWARM_ROOT_RE = /<ultra_swarm_result\b/i;
const AGENT_SWARM_ROOT_RE = /<agent_swarm_result\b/i;
const EXPERT_BLOCK_RE = /<expert\s+([^>]+)>\n?([\s\S]*?)\n<\/expert>/g;
const SUBAGENT_BLOCK_RE = /<subagent([^>]*)>([\s\S]*?)<\/subagent>/g;
const SELECTION_REASON_RE = /^<selection_reason>[\s\S]*?<\/selection_reason>\n?/;
const ARCHIVE_MARKER_RE = /\[liora-archived id=([a-f0-9]+)/;

export function isSwarmToolResult(text: string): boolean {
  return ULTRA_SWARM_ROOT_RE.test(text) || AGENT_SWARM_ROOT_RE.test(text);
}

export function compactSwarmToolResult(
  store: ToolStore,
  rawXml: string,
  options: BoundaryCompactionOptions = {},
): BoundaryCompactionResult {
  if (!isSwarmToolResult(rawXml)) {
    return fallbackCompaction(rawXml, options);
  }

  const expertBodyMaxChars = options.expertBodyMaxChars ?? SWARM_EXPERT_BODY_MAX_CHARS;
  const totalResultMaxChars = options.totalResultMaxChars ?? SWARM_TOTAL_RESULT_MAX_CHARS;
  const runId = options.runId ?? extractRunId(rawXml);
  const archiveIds: string[] = [];

  let output = rawXml;
  if (ULTRA_SWARM_ROOT_RE.test(rawXml)) {
    output = compactExpertBlocks(rawXml, store, runId, expertBodyMaxChars, archiveIds);
  } else {
    output = compactSubagentBlocks(rawXml, store, runId, expertBodyMaxChars, archiveIds);
  }

  output = enforceTotalBudget(output, store, runId, expertBodyMaxChars, archiveIds, totalResultMaxChars);
  output = injectArchiveGuidance(output, archiveIds);
  // Guidance injection can re-grow the payload; re-apply the densify hard floor last
  // while preserving integration tags and a short LioraExpand trailer.
  if (output.length > totalResultMaxChars) {
    output = applyHardFloorWithIntegration(output, archiveIds, totalResultMaxChars);
  }

  return {
    output,
    archiveIds,
    applied: archiveIds.length > 0 || output.length < rawXml.length,
    fallback: false,
  };
}

/**
 * Projection-time mask for stale swarm tool results: keep XML metadata, replace
 * expert bodies with archive markers only.
 */
export function maskStaleSwarmToolResult(text: string): string {
  if (!isSwarmToolResult(text)) return text;
  if (ULTRA_SWARM_ROOT_RE.test(text)) {
    return text.replace(EXPERT_BLOCK_RE, (_match, attrs: string, inner: string) => {
      const expertId = readXmlAttribute(attrs, 'expert_id') ?? 'unknown';
      const archiveId = extractArchiveIdFromInner(inner);
      const selectionReason = SELECTION_REASON_RE.exec(inner)?.[0] ?? '';
      const marker = archiveId === undefined
        ? collapseForHandoff(stripSelectionReason(inner), 240)
        : formatArchiveMarker(archiveId, `swarm-handoff:${expertId}`);
      return `<expert ${attrs}>\n${selectionReason}${marker}\n</expert>`;
    });
  }
  return text.replace(SUBAGENT_BLOCK_RE, (_match, attrs: string, inner: string) => {
    const archiveId = extractArchiveIdFromInner(inner);
    const marker = archiveId === undefined
      ? collapseForHandoff(inner.trim(), 240)
      : formatArchiveMarker(archiveId, 'swarm-handoff:subagent');
    return `<subagent${attrs}>${marker}</subagent>`;
  });
}

export function expandSwarmArchivedBody(store: ToolStore, archiveId: string): string | undefined {
  const expanded = expandArchivedContent(store, archiveId);
  if (!expanded.found) return undefined;
  return expanded.entry.content;
}

function fallbackCompaction(
  rawXml: string,
  options: BoundaryCompactionOptions,
): BoundaryCompactionResult {
  const totalResultMaxChars = options.totalResultMaxChars ?? SWARM_TOTAL_RESULT_MAX_CHARS;
  const collapsed =
    rawXml.length > totalResultMaxChars ? collapseForHandoff(rawXml, totalResultMaxChars) : rawXml;
  return {
    output: collapsed,
    archiveIds: [],
    applied: collapsed.length < rawXml.length,
    fallback: true,
  };
}

function compactExpertBlocks(
  rawXml: string,
  store: ToolStore,
  runId: string | undefined,
  expertBodyMaxChars: number,
  archiveIds: string[],
): string {
  return rawXml.replace(EXPERT_BLOCK_RE, (_match, attrs: string, inner: string) => {
    const expertId = readXmlAttribute(attrs, 'expert_id') ?? 'unknown';
    const selectionReason = SELECTION_REASON_RE.exec(inner)?.[0] ?? '';
    const rawBody = stripSelectionReason(inner).trim();
    if (rawBody.length === 0) {
      return `<expert ${attrs}>\n${selectionReason}\n</expert>`;
    }
    const existingArchiveId = extractArchiveIdFromInner(rawBody);
    if (existingArchiveId !== undefined) {
      const markerLine = rawBody.split('\n')[0] ?? rawBody;
      const summaryBody = rawBody.slice(markerLine.length).trimStart();
      const summary = collapseForHandoff(summaryBody, Math.min(expertBodyMaxChars, SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS));
      return `<expert ${attrs}>\n${selectionReason}${markerLine}\n${summary}\n</expert>`;
    }
    const archived = archiveContent({
      store,
      content: rawBody,
      label: swarmHandoffLabel(expertId, runId),
    });
    archiveIds.push(archived.id);
    const summary = collapseForHandoff(rawBody, SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS);
    const body = `${archived.marker}\n${summary}`;
    return `<expert ${attrs}>\n${selectionReason}${body}\n</expert>`;
  });
}

function compactSubagentBlocks(
  rawXml: string,
  store: ToolStore,
  runId: string | undefined,
  expertBodyMaxChars: number,
  archiveIds: string[],
): string {
  return rawXml.replace(SUBAGENT_BLOCK_RE, (_match, attrs: string, inner: string) => {
    const rawBody = inner.trim();
    if (rawBody.length === 0) return `<subagent${attrs}></subagent>`;
    const existingArchiveId = extractArchiveIdFromInner(rawBody);
    if (existingArchiveId !== undefined) {
      const markerLine = rawBody.split('\n')[0] ?? rawBody;
      const summaryBody = rawBody.slice(markerLine.length).trimStart();
      const summary = collapseForHandoff(summaryBody, Math.min(expertBodyMaxChars, SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS));
      return `<subagent${attrs}>${markerLine}\n${summary}</subagent>`;
    }
    const item = readXmlAttribute(attrs, 'item');
    const label = item === undefined
      ? `swarm-handoff:subagent:${runId ?? 'run'}`
      : `swarm-handoff:subagent:${item}`;
    const archived = archiveContent({ store, content: rawBody, label });
    archiveIds.push(archived.id);
    const summary = collapseForHandoff(rawBody, SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS);
    return `<subagent${attrs}>${archived.marker}\n${summary}</subagent>`;
  });
}

function enforceTotalBudget(
  output: string,
  store: ToolStore,
  runId: string | undefined,
  expertBodyMaxChars: number,
  archiveIds: string[],
  totalResultMaxChars: number,
): string {
  if (output.length <= totalResultMaxChars) return output;
  // Re-compact expert/subagent bodies more aggressively under denser total caps.
  let next = ULTRA_SWARM_ROOT_RE.test(output)
    ? compactExpertBlocks(output, store, runId, Math.min(expertBodyMaxChars, 120), archiveIds)
    : compactSubagentBlocks(output, store, runId, Math.min(expertBodyMaxChars, 120), archiveIds);
  if (next.length <= totalResultMaxChars) return next;
  // Hard floor with integration preservation — never drop Ultrawork handoff tags.
  return applyHardFloorWithIntegration(next, archiveIds, totalResultMaxChars);
}

function extractIntegrationChunks(output: string): { readonly chunks: string[]; readonly without: string } {
  const chunks: string[] = [];
  let without = output;
  for (const tag of ['integration_report', 'integration_handoff'] as const) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi');
    without = without.replace(re, (match) => {
      chunks.push(match);
      return '';
    });
  }
  return { chunks, without };
}

function applyHardFloorWithIntegration(
  output: string,
  archiveIds: readonly string[],
  totalResultMaxChars: number,
): string {
  // Keep parent-agent integration tags even under denser total caps. Head+tail
  // collapse alone can drop the closing integration blocks that Ultrawork needs.
  const extracted = extractIntegrationChunks(output);
  const integrationTail =
    extracted.chunks.length > 0 ? `\n${extracted.chunks.join('\n')}` : '';
  // Preserve adaptive-restaff signal text that would otherwise fall out of the
  // collapsed expert head under denser total budgets.
  const restaffNote = /Restaffed after revision gaps\./i.test(output)
    ? '\nRestaffed after revision gaps.'
    : '';
  const expandTrailer =
    archiveIds.length > 0
      ? `\n[LioraExpand archives: ${archiveIds.slice(0, 6).join(',')}${archiveIds.length > 6 ? '…' : ''}]`
      : '';
  const fixedTail = `${integrationTail}${restaffNote}${expandTrailer}`;
  const headBudget = Math.max(0, totalResultMaxChars - fixedTail.length);
  let next = collapseForHandoff(extracted.without.trim(), headBudget) + fixedTail;
  if (next.length > totalResultMaxChars) {
    // Prefer keeping the integration tail over a longer head when the densify
    // budget is extremely tight.
    const minTail = fixedTail.trimStart();
    if (minTail.length >= totalResultMaxChars) {
      next = minTail.slice(0, totalResultMaxChars);
    } else {
      const remaining = totalResultMaxChars - minTail.length;
      const prefix = remaining > 0 ? collapseForHandoff(extracted.without.trim(), remaining) : '';
      next = `${prefix}${minTail.length > 0 ? `\n${minTail}` : ''}`;
      if (next.length > totalResultMaxChars) next = next.slice(0, totalResultMaxChars);
    }
  }
  return next;
}

function injectArchiveGuidance(output: string, archiveIds: readonly string[]): string {
  if (archiveIds.length === 0) return output;
  const guidance =
    '<boundary_compaction>Archived expert bodies: use LioraExpand(id=...) on failure paths. ' +
    `archive_ids="${archiveIds.join(',')}"</boundary_compaction>`;
  if (output.includes('</integration_handoff>')) {
    return output.replace(
      '</integration_handoff>',
      `Archived bodies available via LioraExpand. archive_ids="${archiveIds.join(',')}"</integration_handoff>`,
    );
  }
  if (output.includes('</agent_swarm_result>')) {
    return output.replace('</agent_swarm_result>', `${guidance}\n</agent_swarm_result>`);
  }
  return `${output}\n${guidance}`;
}

function swarmHandoffLabel(expertId: string, runId: string | undefined): string {
  return runId === undefined
    ? `swarm-handoff:${expertId}`
    : `swarm-handoff:${expertId}:${runId}`;
}

function extractRunId(rawXml: string): string | undefined {
  const match = /run_id="([^"]+)"/i.exec(rawXml);
  return match?.[1];
}

function readXmlAttribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
  return match?.[1];
}

function stripSelectionReason(inner: string): string {
  return inner.replace(SELECTION_REASON_RE, '');
}

function extractArchiveIdFromInner(inner: string): string | undefined {
  const match = ARCHIVE_MARKER_RE.exec(inner);
  return match?.[1];
}

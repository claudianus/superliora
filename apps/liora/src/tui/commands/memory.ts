import type { MemoryRecord, MemorySearchResult, MemoryStats } from '@superliora/sdk';

import {
  CANONICAL_EVIDENCE_ROOT,
  CANONICAL_LLM_WIKI_ROOT,
} from '#/constant/workspace-data';

import type { SlashCommandHost } from './dispatch';
import {
  buildLlmWikiStatusLines,
  buildPromoteEvidenceLines,
  loadLlmWikiStatus,
  promoteProjectEvidenceToVerified,
} from './llm-wiki';
import {
  formatEvidenceSignal,
  loadMemoryReadinessEvidence,
  type MemoryReadinessSnapshot,
} from './evidence-readiness';

export type {
  MemoryReadinessEvidence,
  MemoryReadinessEvidenceSignal,
  MemoryReadinessEvidenceTier,
  MemoryReadinessSnapshot,
} from './evidence-readiness';
export { loadMemoryReadinessEvidence, formatEvidenceSignal } from './evidence-readiness';

export async function handleMemoryCommand(host: SlashCommandHost, rawArgs: string): Promise<void> {
  const args = rawArgs.trim();
  const [command = 'stats', ...rest] = args.length === 0 ? ['stats'] : args.split(/\s+/u);
  const tail = rest.join(' ').trim();
  switch (command.toLowerCase()) {
    case 'stats':
      await showMemoryStats(host);
      return;
    case 'list':
      await listMemories(host, tail);
      return;
    case 'search':
    case 'recall':
      await searchMemories(host, tail);
      return;
    case 'readiness':
    case 'health':
      await showMemoryReadiness(host, tail);
      return;
    case 'wiki':
      showLlmWikiStatus(host);
      return;
    case 'verify':
    case 'promote':
      verifyProjectEvidence(host);
      return;
    case 'remember':
    case 'write':
      await rememberMemory(host, tail);
      return;
    case 'forget':
    case 'delete':
      await forgetMemory(host, tail);
      return;
    case 'consolidate':
      await consolidateMemories(host);
      return;
    default:
      host.showError('Usage: /memory [stats|list|search|wiki|verify|readiness|health|remember|forget|consolidate]');
  }
}

async function showMemoryStats(host: SlashCommandHost): Promise<void> {
  const stats = await host.harness.memory.stats();
  host.showNotice(
    'Liora Recall',
    `active ${stats.active} / total ${stats.total}\nsemantic ${stats.byKind.semantic}, episodic ${stats.byKind.episodic}, procedural ${stats.byKind.procedural}, prospective ${stats.byKind.prospective}`,
  );
}

async function listMemories(host: SlashCommandHost, args: string): Promise<void> {
  const limit = parseLimit(args, 10);
  const memories = await host.harness.memory.list({ limit });
  host.showNotice('Liora Recall memories', renderMemories(memories));
}

async function searchMemories(host: SlashCommandHost, query: string): Promise<void> {
  if (query.length === 0) {
    host.showError('Usage: /memory search <query>');
    return;
  }
  const results = host.session === undefined
    ? await host.harness.memory.search({ query, limit: 8 })
    : await host.session.recall(query, { limit: 8 });
  host.showNotice('Liora Recall search', renderSearchResults(results));
}

async function showMemoryReadiness(host: SlashCommandHost, query: string): Promise<void> {
  const { UsagePanelComponent } = await import('../components/messages/usage-panel');
  const statsResult = await loadMemoryStats(host);
  const searchResult = await loadMemoryReadinessSearch(host, query);
  const evidence = loadMemoryReadinessEvidence(host.state.appState.workDir);
  const panel = new UsagePanelComponent(
    () => buildMemoryReadinessLines({
      stats: 'stats' in statsResult ? statsResult.stats : undefined,
      statsError: 'error' in statsResult ? statsResult.error : undefined,
      query,
      searchResults: searchResult.results,
      searchError: searchResult.error,
      evidence,
    }),
    'primary',
    ' Memory ',
  );
  host.state.transcriptContainer.addChild(panel);
  host.state.ui.requestRender();
}

function showLlmWikiStatus(host: SlashCommandHost): void {
  host.showNotice(
    'LLM Wiki',
    buildLlmWikiStatusLines(loadLlmWikiStatus(host.state.appState.workDir))
      .map(redactMemoryReadinessText)
      .join('\n'),
  );
}

function verifyProjectEvidence(host: SlashCommandHost): void {
  const result = promoteProjectEvidenceToVerified(host.state.appState.workDir);
  host.showNotice(
    'Evidence verify',
    buildPromoteEvidenceLines(result).map(redactMemoryReadinessText).join('\n'),
  );
}

async function loadMemoryStats(
  host: SlashCommandHost,
): Promise<{ readonly stats: MemoryStats } | { readonly error: string }> {
  try {
    return { stats: await host.harness.memory.stats() };
  } catch (error) {
    return { error: formatMemoryReadinessError(error) };
  }
}

async function loadMemoryReadinessSearch(
  host: SlashCommandHost,
  query: string,
): Promise<{ readonly results?: readonly MemorySearchResult[]; readonly error?: string }> {
  if (query.length === 0) return {};
  try {
    const results = host.session === undefined
      ? await host.harness.memory.search({ query, limit: 3 })
      : await host.session.recall(query, { limit: 3 });
    return { results };
  } catch (error) {
    return { error: formatMemoryReadinessError(error) };
  }
}

async function rememberMemory(host: SlashCommandHost, args: string): Promise<void> {
  const parsed = parseRememberArgs(args);
  if (parsed === undefined) {
    host.showError('Usage: /memory remember <subject> :: <content>');
    return;
  }
  const memory = host.session === undefined
    ? await host.harness.memory.remember({
      kind: 'semantic',
      scope: 'user',
      subject: parsed.subject,
      content: parsed.content,
      tags: ['manual'],
      importance: 0.8,
      confidence: 0.95,
    })
    : await host.session.remember({
      kind: 'semantic',
      scope: 'workspace',
      subject: parsed.subject,
      content: parsed.content,
      tags: ['manual'],
      importance: 0.8,
      confidence: 0.95,
    });
  host.showStatus(`Liora Recall saved ${memory.id}`);
}

async function forgetMemory(host: SlashCommandHost, id: string): Promise<void> {
  if (id.length === 0) {
    host.showError('Usage: /memory forget <memory-id>');
    return;
  }
  const forgotten = await host.harness.memory.forget(id);
  host.showStatus(forgotten ? `Liora Recall forgot ${id}` : `No Liora Recall memory found for ${id}`);
}

async function consolidateMemories(host: SlashCommandHost): Promise<void> {
  const result = await host.harness.memory.consolidate();
  host.showStatus(`Liora Recall consolidated ${result.merged}/${result.examined} duplicate memories`);
}

function parseLimit(args: string, fallback: number): number {
  if (args.trim().length === 0) return fallback;
  const parsed = Number(args.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 50);
}

function parseRememberArgs(args: string): { readonly subject: string; readonly content: string } | undefined {
  const separator = args.includes('::') ? '::' : '|';
  const index = args.indexOf(separator);
  if (index < 0) return undefined;
  const subject = args.slice(0, index).trim();
  const content = args.slice(index + separator.length).trim();
  if (subject.length === 0 || content.length === 0) return undefined;
  return { subject, content };
}

function renderSearchResults(results: readonly MemorySearchResult[]): string {
  if (results.length === 0) return 'No matching memories.';
  return results
    .map((result, index) => `${index + 1}. ${result.score.toFixed(2)} ${renderMemory(result.memory)}`)
    .join('\n\n');
}

function renderMemories(memories: readonly MemoryRecord[]): string {
  if (memories.length === 0) return 'No memories stored yet.';
  return memories.map((memory, index) => `${index + 1}. ${renderMemory(memory)}`).join('\n\n');
}

function renderMemory(memory: MemoryRecord): string {
  const tags = memory.tags.length === 0 ? '' : ` [${memory.tags.join(', ')}]`;
  return `${memory.subject}${tags}\n${memory.id} ${memory.kind}/${memory.scope}\n${memory.content}`;
}

export function buildMemoryReadinessLines(snapshot: MemoryReadinessSnapshot): string[] {
  const lines = [
    'SuperLiora / Liora Recall readiness',
    durableStatsLine(snapshot.stats, snapshot.statsError),
    memoryKindsLine(snapshot.stats),
    recallSearchLine(snapshot.query, snapshot.searchResults, snapshot.searchError),
    `LLM-wiki/durable  ${formatEvidenceSignal(snapshot.evidence.llmWiki)}`,
    `Knowledge-map evidence  ${formatEvidenceSignal(snapshot.evidence.knowledgeMap)}`,
    `Browser-use evidence  ${formatEvidenceSignal(snapshot.evidence.browserUse)}`,
    `Computer-use evidence  ${formatEvidenceSignal(snapshot.evidence.computerUse)}`,
    `Next  ${nextMemoryReadinessAction(snapshot)}`,
  ];

  for (const warning of snapshot.evidence.warnings) {
    lines.push(`Warning  ${warning}`);
  }

  lines.push(`Source  ${snapshot.evidence.sourceRoot}`);
  return lines.map(redactMemoryReadinessText);
}

export function redactMemoryReadinessText(text: string): string {
  return text
    .replaceAll(/\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)[A-Z0-9_]*\b/g, '[REDACTED_ENV]')
    .replaceAll(/\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|credential)[A-Za-z0-9_-]*)=([^\s,;]+)/gi, '$1=[REDACTED_SECRET]')
    .replaceAll(/\b(?:sk|sk-proj|ghp|xoxb)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_SECRET]');
}

function durableStatsLine(stats: MemoryStats | undefined, error: string | undefined): string {
  if (stats === undefined) return `Durable memory  unavailable: ${error ?? 'stats failed'}`;
  return `Durable memory  active ${stats.active} / total ${stats.total}; archived ${stats.archived}, deleted ${stats.deleted}`;
}

function memoryKindsLine(stats: MemoryStats | undefined): string {
  if (stats === undefined) return 'Memory kinds  unavailable';
  return `Memory kinds  semantic ${stats.byKind.semantic}, episodic ${stats.byKind.episodic}, procedural ${stats.byKind.procedural}, prospective ${stats.byKind.prospective}`;
}

function recallSearchLine(
  query: string,
  results: readonly MemorySearchResult[] | undefined,
  error: string | undefined,
): string {
  if (query.length === 0) return 'Recall search  skipped; pass a query to verify retrieval';
  if (error !== undefined) return `Recall search  unavailable for "${query}": ${error}`;
  if (results === undefined || results.length === 0) return `Recall search  0 matches for "${query}"`;
  const top = results[0];
  if (top === undefined) return `Recall search  0 matches for "${query}"`;
  return `Recall search  ${results.length} matches for "${query}"; top ${top.score.toFixed(2)} ${top.memory.subject}`;
}

function nextMemoryReadinessAction(snapshot: MemoryReadinessSnapshot): string {
  if (snapshot.stats === undefined) return 'Fix Liora Recall availability, then rerun /memory readiness.';
  if (snapshot.stats.total === 0) return 'Create a durable memory with /memory remember <subject> :: <content>.';
  if (snapshot.query.length === 0) return 'Run /memory readiness <query> to verify recall retrieval.';
  if (snapshot.searchError !== undefined) return 'Fix recall search, then rerun /memory readiness <query>.';
  if ((snapshot.searchResults?.length ?? 0) === 0) return 'Add or refine durable memories for this query.';
  if (!snapshot.evidence.llmWiki.ready) return `Start Ultrawork to create project-local LLM Wiki evidence under ${CANONICAL_LLM_WIKI_ROOT}.`;
  if (!snapshot.evidence.llmWiki.verified) {
    return `Run /memory verify to promote LLM Wiki seed to verified, then rerun /memory readiness.`;
  }
  if (!snapshot.evidence.knowledgeMap.ready) return `Capture Liora Knowledge Map evidence under ${CANONICAL_EVIDENCE_ROOT}.`;
  if (!snapshot.evidence.knowledgeMap.verified) {
    return `Run /memory verify to promote Liora Knowledge Map seed to verified, then rerun /memory readiness.`;
  }
  if (!snapshot.evidence.browserUse.ready) return `Capture browser-use evidence under ${CANONICAL_EVIDENCE_ROOT}.`;
  if (!snapshot.evidence.computerUse.ready) return `Capture computer-use evidence under ${CANONICAL_EVIDENCE_ROOT}.`;
  return 'Ready: run the harness with current recall and evidence.';
}

function formatMemoryReadinessError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

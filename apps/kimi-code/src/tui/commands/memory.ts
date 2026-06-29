import { existsSync, readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import { basename, join } from 'node:path';

import type { MemoryRecord, MemorySearchResult, MemoryStats } from '@moonshot-ai/kimi-code-sdk';

import type { SlashCommandHost } from './dispatch';

const DEFAULT_MEMORY_EVIDENCE_ROOT = '.omo/evidence';
const MAX_EVIDENCE_DEPTH = 5;
const MAX_EVIDENCE_FILES = 200;
const MAX_EVIDENCE_READ_BYTES = 32_000;

const EVIDENCE_PATTERNS = {
  llmWiki: /\b(?:llm[-_\s]?wiki|llms\.txt|kimi recall|durable memory|memory readiness)\b/iu,
  knowledgeMap: /\b(?:kimi knowledge map|knowledge[-_\s]?map|compact[-_\s]?project[-_\s]?map|relationship_confidence|path_affected_questions|EXTRACTED, INFERRED, or AMBIGUOUS)\b/iu,
  browserUsePath: /\b(?:browser[-_]?use|browser_use|playwright|chromium)\b/iu,
  browserUseText: /\b(?:browser[-_\s]?use|browser automation|playwright|chromium|accessibility snapshot|browser_use)\b/iu,
  computerUsePath: /\b(?:computer[-_]?use|computer_use|screencapture|app[-_]?state)\b/iu,
  computerUseText: /\b(?:computer[-_\s]?use|mcp__computer_use|screencapture|app-state|computer_use)\b/iu,
} as const;

export interface MemoryReadinessEvidenceSignal {
  readonly ready: boolean;
  readonly matchCount: number;
  readonly sourcePath?: string;
  readonly summary: string;
}

export interface MemoryReadinessEvidence {
  readonly sourceRoot: string;
  readonly llmWiki: MemoryReadinessEvidenceSignal;
  readonly knowledgeMap: MemoryReadinessEvidenceSignal;
  readonly browserUse: MemoryReadinessEvidenceSignal;
  readonly computerUse: MemoryReadinessEvidenceSignal;
  readonly warnings: readonly string[];
}

export interface MemoryReadinessSnapshot {
  readonly stats?: MemoryStats;
  readonly statsError?: string;
  readonly query: string;
  readonly searchResults?: readonly MemorySearchResult[];
  readonly searchError?: string;
  readonly evidence: MemoryReadinessEvidence;
}

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
      host.showError('Usage: /memory [stats|list|search|readiness|health|remember|forget|consolidate]');
  }
}

async function showMemoryStats(host: SlashCommandHost): Promise<void> {
  const stats = await host.harness.memory.stats();
  host.showNotice(
    'Kimi Recall',
    `active ${stats.active} / total ${stats.total}\nsemantic ${stats.byKind.semantic}, episodic ${stats.byKind.episodic}, procedural ${stats.byKind.procedural}, prospective ${stats.byKind.prospective}`,
  );
}

async function listMemories(host: SlashCommandHost, args: string): Promise<void> {
  const limit = parseLimit(args, 10);
  const memories = await host.harness.memory.list({ limit });
  host.showNotice('Kimi Recall memories', renderMemories(memories));
}

async function searchMemories(host: SlashCommandHost, query: string): Promise<void> {
  if (query.length === 0) {
    host.showError('Usage: /memory search <query>');
    return;
  }
  const results = host.session === undefined
    ? await host.harness.memory.search({ query, limit: 8 })
    : await host.session.recall(query, { limit: 8 });
  host.showNotice('Kimi Recall search', renderSearchResults(results));
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
  host.showStatus(`Kimi Recall saved ${memory.id}`);
}

async function forgetMemory(host: SlashCommandHost, id: string): Promise<void> {
  if (id.length === 0) {
    host.showError('Usage: /memory forget <memory-id>');
    return;
  }
  const forgotten = await host.harness.memory.forget(id);
  host.showStatus(forgotten ? `Kimi Recall forgot ${id}` : `No Kimi Recall memory found for ${id}`);
}

async function consolidateMemories(host: SlashCommandHost): Promise<void> {
  const result = await host.harness.memory.consolidate();
  host.showStatus(`Kimi Recall consolidated ${result.merged}/${result.examined} duplicate memories`);
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

export function loadMemoryReadinessEvidence(workDir: string): MemoryReadinessEvidence {
  const sourceRoot = join(workDir, DEFAULT_MEMORY_EVIDENCE_ROOT);
  if (!existsSync(sourceRoot)) {
    return emptyMemoryReadinessEvidence(sourceRoot, [`No local evidence found at ${sourceRoot}`]);
  }

  const files = collectEvidenceFiles(sourceRoot);
  const warnings = files.truncated
    ? [`Evidence scan stopped after ${MAX_EVIDENCE_FILES} files under ${sourceRoot}`]
    : [];
  const matches = {
    llmWiki: createEvidenceAccumulator(),
    knowledgeMap: createEvidenceAccumulator(),
    browserUse: createEvidenceAccumulator(),
    computerUse: createEvidenceAccumulator(),
  };

  for (const file of files.paths) {
    const evidenceFile = readEvidenceFile(file);
    if (evidenceFile.warning !== undefined) warnings.push(evidenceFile.warning);
    const haystack = `${basename(file)}\n${evidenceFile.text}`;
    updateEvidenceAccumulator(matches.llmWiki, file, haystack, EVIDENCE_PATTERNS.llmWiki);
    updateEvidenceAccumulator(
      matches.knowledgeMap,
      file,
      haystack,
      EVIDENCE_PATTERNS.knowledgeMap,
    );
    updateCapabilityEvidenceAccumulator(
      matches.browserUse,
      file,
      evidenceFile.text,
      EVIDENCE_PATTERNS.browserUsePath,
      EVIDENCE_PATTERNS.browserUseText,
    );
    updateCapabilityEvidenceAccumulator(
      matches.computerUse,
      file,
      evidenceFile.text,
      EVIDENCE_PATTERNS.computerUsePath,
      EVIDENCE_PATTERNS.computerUseText,
    );
  }

  return {
    sourceRoot,
    llmWiki: evidenceSignal(matches.llmWiki, 'No llm-wiki or durable-memory evidence found.'),
    knowledgeMap: evidenceSignal(matches.knowledgeMap, 'No Kimi Knowledge Map evidence found.'),
    browserUse: evidenceSignal(matches.browserUse, 'No browser-use evidence found.'),
    computerUse: evidenceSignal(matches.computerUse, 'No computer-use evidence found.'),
    warnings,
  };
}

export function buildMemoryReadinessLines(snapshot: MemoryReadinessSnapshot): string[] {
  const lines = [
    'Super Kimi / Kimi Recall readiness',
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

function emptyMemoryReadinessEvidence(
  sourceRoot: string,
  warnings: readonly string[] = [],
): MemoryReadinessEvidence {
  return {
    sourceRoot,
    llmWiki: {
      ready: false,
      matchCount: 0,
      summary: 'No llm-wiki or durable-memory evidence found.',
    },
    knowledgeMap: {
      ready: false,
      matchCount: 0,
      summary: 'No Kimi Knowledge Map evidence found.',
    },
    browserUse: {
      ready: false,
      matchCount: 0,
      summary: 'No browser-use evidence found.',
    },
    computerUse: {
      ready: false,
      matchCount: 0,
      summary: 'No computer-use evidence found.',
    },
    warnings,
  };
}

function collectEvidenceFiles(root: string): { readonly paths: readonly string[]; readonly truncated: boolean } {
  const paths: string[] = [];
  visitEvidenceDir(root, 0, paths);
  return { paths, truncated: paths.length >= MAX_EVIDENCE_FILES };
}

function visitEvidenceDir(dir: string, depth: number, paths: string[]): void {
  if (depth > MAX_EVIDENCE_DEPTH || paths.length >= MAX_EVIDENCE_FILES) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (paths.length >= MAX_EVIDENCE_FILES) return;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      visitEvidenceDir(path, depth + 1, paths);
      continue;
    }
    if (!entry.isFile() || !isEvidenceFile(path, safeStat(path))) continue;
    paths.push(path);
  }
}

function isEvidenceFile(path: string, stats: Stats | undefined): boolean {
  if (stats === undefined || stats.size <= 0) return false;
  return /\.(?:json|jsonl|md|txt|log)$/iu.test(path);
}

function readEvidenceFile(path: string): { readonly text: string; readonly warning?: string } {
  try {
    const stats = safeStat(path);
    const text = readFileSync(path, 'utf8').slice(0, MAX_EVIDENCE_READ_BYTES);
    if (stats !== undefined && stats.size <= MAX_EVIDENCE_READ_BYTES && isJsonEvidenceFile(path) && !isValidJsonEvidence(text)) {
      return { text: '', warning: `Malformed evidence ignored: ${path}` };
    }
    return { text };
  } catch {
    return { text: '' };
  }
}

function safeStat(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function createEvidenceAccumulator(): { matchCount: number; sourcePath?: string } {
  return { matchCount: 0 };
}

function updateEvidenceAccumulator(
  accumulator: { matchCount: number; sourcePath?: string },
  path: string,
  haystack: string,
  pattern: RegExp,
): void {
  if (!pattern.test(haystack)) return;
  accumulator.matchCount += 1;
  accumulator.sourcePath ??= path;
}

function updateCapabilityEvidenceAccumulator(
  accumulator: { matchCount: number; sourcePath?: string },
  path: string,
  text: string,
  pathPattern: RegExp,
  textPattern: RegExp,
): void {
  const pathHaystack = `${basename(path)}\n${path}`;
  if (!pathPattern.test(pathHaystack)) return;
  if (!textPattern.test(text) || !hasEvidenceProof(text)) return;
  accumulator.matchCount += 1;
  accumulator.sourcePath ??= path;
}

function evidenceSignal(
  accumulator: { readonly matchCount: number; readonly sourcePath?: string },
  missingSummary: string,
): MemoryReadinessEvidenceSignal {
  if (accumulator.matchCount === 0) {
    return {
      ready: false,
      matchCount: 0,
      summary: missingSummary,
    };
  }

  return {
    ready: true,
    matchCount: accumulator.matchCount,
    sourcePath: accumulator.sourcePath,
    summary: 'evidence found',
  };
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

function formatEvidenceSignal(signal: MemoryReadinessEvidenceSignal): string {
  if (!signal.ready) return `missing; ${signal.summary}`;
  const matchWord = signal.matchCount === 1 ? 'match' : 'matches';
  const source = signal.sourcePath === undefined ? 'source not recorded' : signal.sourcePath;
  return `ready; ${signal.matchCount} ${matchWord}; ${source}`;
}

function nextMemoryReadinessAction(snapshot: MemoryReadinessSnapshot): string {
  if (snapshot.stats === undefined) return 'Fix Kimi Recall availability, then rerun /memory readiness.';
  if (snapshot.stats.total === 0) return 'Create a durable memory with /memory remember <subject> :: <content>.';
  if (snapshot.query.length === 0) return 'Run /memory readiness <query> to verify recall retrieval.';
  if (snapshot.searchError !== undefined) return 'Fix recall search, then rerun /memory readiness <query>.';
  if ((snapshot.searchResults?.length ?? 0) === 0) return 'Add or refine durable memories for this query.';
  if (!snapshot.evidence.llmWiki.ready) return 'Add llm-wiki or durable-memory evidence under .omo/evidence.';
  if (!snapshot.evidence.knowledgeMap.ready) return 'Capture Kimi Knowledge Map evidence under .omo/evidence.';
  if (!snapshot.evidence.browserUse.ready) return 'Capture browser-use evidence under .omo/evidence.';
  if (!snapshot.evidence.computerUse.ready) return 'Capture computer-use evidence under .omo/evidence.';
  return 'Ready: run the harness with current recall and evidence.';
}

function formatMemoryReadinessError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isJsonEvidenceFile(path: string): boolean {
  return /\.(?:json|jsonl)$/iu.test(path);
}

function isValidJsonEvidence(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes('\n')) {
    return trimmed.split(/\r?\n/u).every((line) => {
      const value = line.trim();
      if (value.length === 0) return true;
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    });
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function hasEvidenceProof(text: string): boolean {
  return /\b(?:PASS|passed|status|screenshot|transcript|action log|observation|validator|cleanup)\b/iu.test(text);
}

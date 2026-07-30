import { existsSync, readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import { basename, join } from 'node:path';

import type { MemorySearchResult, MemoryStats } from '@superliora/sdk';

import { resolveEvidenceRoot, resolveLlmWikiRoot } from '#/constant/workspace-data';

import { loadLlmWikiStatus, resolveLatestRunEvidenceState } from './llm-wiki';

const MAX_EVIDENCE_DEPTH = 5;
const MAX_EVIDENCE_FILES = 200;
const MAX_EVIDENCE_READ_BYTES = 32_000;
const MAX_MALFORMED_EVIDENCE_WARNING_SAMPLES = 3;
const MALFORMED_EVIDENCE_WARNING_PREFIX = 'Malformed evidence ignored: ';

const EVIDENCE_PATTERNS = {
  llmWiki: /\b(?:llm[-_\s]?wiki|llms\.txt|liora recall|durable memory|memory readiness)\b/iu,
  knowledgeMap:
    /\b(?:liora knowledge map|kimi knowledge map|knowledge[-_\s]?map|compact[-_\s]?project[-_\s]?map|relationship_confidence|path_affected_questions|EXTRACTED, INFERRED, or AMBIGUOUS)\b/iu,
  browserUsePath: /\b(?:browser[-_]?use|browser_use|playwright|chromium)\b/iu,
  browserUseText:
    /\b(?:browser[-_\s]?use|browser automation|playwright|chromium|accessibility snapshot|browser_use)\b/iu,
  computerUsePath: /\b(?:computer[-_]?use|computer_use|screencapture|app[-_]?state)\b/iu,
  computerUseText:
    /\b(?:computer[-_\s]?use|mcp__computer_use|screencapture|app-state|computer_use)\b/iu,
} as const;

export type MemoryReadinessEvidenceTier = 'missing' | 'seed' | 'verified' | 'legacy';

export interface MemoryReadinessEvidenceSignal {
  readonly ready: boolean;
  readonly verified: boolean;
  readonly tier: MemoryReadinessEvidenceTier;
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

interface EvidenceAccumulator {
  matchCount: number;
  sourcePath?: string;
  tier: MemoryReadinessEvidenceTier;
}

export function loadMemoryReadinessEvidence(workDir: string): MemoryReadinessEvidence {
  const evidenceRoot = join(workDir, resolveEvidenceRoot(workDir));
  const wikiRoot = join(workDir, resolveLlmWikiRoot(workDir));
  const sourceRoot = `${evidenceRoot}; ${wikiRoot}`;
  const roots = [evidenceRoot, wikiRoot].filter((root) => existsSync(root));
  if (roots.length === 0) {
    return emptyMemoryReadinessEvidence(sourceRoot, [
      `No local evidence found at ${evidenceRoot} or ${wikiRoot}`,
    ]);
  }

  const warnings: string[] = [];
  const matches = {
    llmWiki: createEvidenceAccumulator(),
    knowledgeMap: createEvidenceAccumulator(),
    browserUse: createEvidenceAccumulator(),
    computerUse: createEvidenceAccumulator(),
  };

  for (const root of roots) {
    const files = collectEvidenceFiles(root);
    if (files.truncated) warnings.push(`Evidence scan stopped after ${MAX_EVIDENCE_FILES} files under ${root}`);
    for (const file of files.paths) {
      const evidenceFile = readEvidenceFile(file);
      if (evidenceFile.warning !== undefined) warnings.push(evidenceFile.warning);
      if (isUnderRoot(file, wikiRoot)) continue;
      const haystack = `${basename(file)}\n${evidenceFile.text}`;
      updateRegexEvidenceAccumulator(matches.llmWiki, file, haystack, EVIDENCE_PATTERNS.llmWiki, 'legacy');
      updateKnowledgeMapAccumulator(matches.knowledgeMap, file, haystack, evidenceFile.text);
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
  }

  const wikiStatus = loadLlmWikiStatus(workDir);
  if (wikiStatus.indexExists && wikiStatus.manifestValid) {
    matches.llmWiki.matchCount += 1;
    matches.llmWiki.sourcePath = wikiStatus.indexPath;
    matches.llmWiki.tier = resolveLlmWikiTier(resolveLatestRunEvidenceState(workDir));
  } else if (wikiStatus.exists) {
    warnings.push(...wikiStatus.warnings);
  }

  return {
    sourceRoot,
    llmWiki: evidenceSignal(matches.llmWiki, 'No llm-wiki or durable-memory evidence found.'),
    knowledgeMap: evidenceSignal(matches.knowledgeMap, 'No Liora Knowledge Map evidence found.'),
    browserUse: evidenceSignal(matches.browserUse, 'No browser-use evidence found.'),
    computerUse: evidenceSignal(matches.computerUse, 'No computer-use evidence found.'),
    warnings: summarizeEvidenceWarnings(warnings),
  };
}

export function formatEvidenceSignal(signal: MemoryReadinessEvidenceSignal): string {
  if (!signal.ready) return `missing; ${signal.summary}`;
  const matchWord = signal.matchCount === 1 ? 'match' : 'matches';
  const source = signal.sourcePath === undefined ? 'source not recorded' : signal.sourcePath;
  const tierLabel = signal.tier === 'verified' ? 'verified' : signal.tier;
  return `${tierLabel}; ${signal.matchCount} ${matchWord}; ${source}`;
}

function emptyMemoryReadinessEvidence(
  sourceRoot: string,
  warnings: readonly string[] = [],
): MemoryReadinessEvidence {
  const missing = (summary: string): MemoryReadinessEvidenceSignal => ({
    ready: false,
    verified: false,
    tier: 'missing',
    matchCount: 0,
    summary,
  });
  return {
    sourceRoot,
    llmWiki: missing('No llm-wiki or durable-memory evidence found.'),
    knowledgeMap: missing('No Liora Knowledge Map evidence found.'),
    browserUse: missing('No browser-use evidence found.'),
    computerUse: missing('No computer-use evidence found.'),
    warnings,
  };
}

function createEvidenceAccumulator(): EvidenceAccumulator {
  return { matchCount: 0, tier: 'missing' };
}

function resolveLlmWikiTier(state: ReturnType<typeof resolveLatestRunEvidenceState>): MemoryReadinessEvidenceTier {
  if (state === 'verified') return 'verified';
  return 'seed';
}

function updateRegexEvidenceAccumulator(
  accumulator: EvidenceAccumulator,
  path: string,
  haystack: string,
  pattern: RegExp,
  tier: MemoryReadinessEvidenceTier,
): void {
  if (!pattern.test(haystack)) return;
  accumulator.matchCount += 1;
  if (
    accumulator.sourcePath === undefined
    || evidenceSourcePriority(path) < evidenceSourcePriority(accumulator.sourcePath)
  ) {
    accumulator.sourcePath = path;
  }
  if (accumulator.tier === 'missing') accumulator.tier = tier;
}

function updateKnowledgeMapAccumulator(
  accumulator: EvidenceAccumulator,
  path: string,
  haystack: string,
  text: string,
): void {
  if (!EVIDENCE_PATTERNS.knowledgeMap.test(haystack)) return;
  accumulator.matchCount += 1;
  if (
    accumulator.sourcePath === undefined
    || evidenceSourcePriority(path) < evidenceSourcePriority(accumulator.sourcePath)
  ) {
    accumulator.sourcePath = path;
  }
  accumulator.tier = mergeEvidenceTier(accumulator.tier, resolveKnowledgeMapTier(text));
}

function resolveKnowledgeMapTier(text: string): MemoryReadinessEvidenceTier {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed['evidenceState'] === 'verified') return 'verified';
    if (parsed['evidenceState'] === 'seed') return 'seed';
    if (/\bPASS\b/u.test(text)) return 'verified';
    if (hasVerifiedKnowledgeMapContent(parsed)) return 'verified';
    if (parsed['kind'] === 'liora knowledge map') return 'seed';
  } catch {
    // Fall through to legacy classification.
  }
  return 'legacy';
}

function hasVerifiedKnowledgeMapContent(parsed: Record<string, unknown>): boolean {
  const relationships = parsed['relationship_confidence'];
  if (Array.isArray(relationships) && relationships.length > 0) return true;
  const nodes = parsed['nodes'];
  if (!Array.isArray(nodes)) return false;
  return nodes.some((node) => {
    if (typeof node !== 'object' || node === null) return false;
    const id = (node as { id?: unknown }).id;
    return typeof id === 'string' && id !== 'ultragoal_seed' && id !== 'coverage_matrix' && id !== 'expert_review_loop';
  });
}

function mergeEvidenceTier(
  current: MemoryReadinessEvidenceTier,
  next: MemoryReadinessEvidenceTier,
): MemoryReadinessEvidenceTier {
  const rank: Record<MemoryReadinessEvidenceTier, number> = {
    missing: 0,
    seed: 1,
    legacy: 2,
    verified: 3,
  };
  return rank[next] > rank[current] ? next : current;
}

function updateCapabilityEvidenceAccumulator(
  accumulator: EvidenceAccumulator,
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
  accumulator.tier = 'verified';
}

function evidenceSignal(
  accumulator: EvidenceAccumulator,
  missingSummary: string,
): MemoryReadinessEvidenceSignal {
  if (accumulator.matchCount === 0) {
    return {
      ready: false,
      verified: false,
      tier: 'missing',
      matchCount: 0,
      summary: missingSummary,
    };
  }

  const tier = accumulator.tier === 'missing' ? 'legacy' : accumulator.tier;
  return {
    ready: true,
    verified: tier === 'verified' || tier === 'legacy',
    tier,
    matchCount: accumulator.matchCount,
    sourcePath: accumulator.sourcePath,
    summary: tier === 'seed' ? 'startup seed only; promote to verified during Learn' : 'evidence found',
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
      return { text: '', warning: `${MALFORMED_EVIDENCE_WARNING_PREFIX}${path}` };
    }
    return { text };
  } catch {
    return { text: '' };
  }
}

function summarizeEvidenceWarnings(warnings: readonly string[]): readonly string[] {
  const malformed: string[] = [];
  const other: string[] = [];
  for (const warning of warnings) {
    if (warning.startsWith(MALFORMED_EVIDENCE_WARNING_PREFIX)) {
      malformed.push(warning);
    } else {
      other.push(warning);
    }
  }

  if (malformed.length <= MAX_MALFORMED_EVIDENCE_WARNING_SAMPLES) {
    return [...other, ...malformed];
  }

  const sampled = malformed.slice(0, MAX_MALFORMED_EVIDENCE_WARNING_SAMPLES);
  const hidden = malformed.length - sampled.length;
  return [
    ...other,
    ...sampled,
    `${MALFORMED_EVIDENCE_WARNING_PREFIX}${malformed.length} files total; ${hidden} more hidden`,
  ];
}

function safeStat(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function isJsonEvidenceFile(path: string): boolean {
  return /\.(?:json|jsonl)$/iu.test(path);
}

function isValidJsonEvidence(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // Fall through to JSONL validation below.
  }
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
  return false;
}

function hasEvidenceProof(text: string): boolean {
  return /\b(?:PASS|passed|status|screenshot|transcript|action log|observation|validator|cleanup)\b/iu.test(text);
}

function isUnderRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function evidenceSourcePriority(path: string): number {
  const name = basename(path).toLowerCase();
  if (
    name.includes('llm-wiki')
    || name.includes('llms.txt')
    || name.includes('liora-knowledge-map')
    || name.includes('browser-use')
    || name.includes('computer-use')
  ) {
    return 0;
  }
  return 1;
}

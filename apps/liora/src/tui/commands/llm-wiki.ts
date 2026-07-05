import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  CANONICAL_LLM_WIKI_ROOT,
  resolveLlmWikiPaths,
  resolveLlmWikiRoot,
} from '#/constant/workspace-data';

import type { UltraworkActivationSource } from './ultrawork-contract';

/** @deprecated Use {@link CANONICAL_LLM_WIKI_ROOT} or {@link resolveLlmWikiRoot}. */
export const LLM_WIKI_ROOT = CANONICAL_LLM_WIKI_ROOT;
export const LLM_WIKI_INDEX_PATH = `${CANONICAL_LLM_WIKI_ROOT}/index.md`;
export const LLM_WIKI_MANIFEST_PATH = `${CANONICAL_LLM_WIKI_ROOT}/manifest.json`;

const LLM_WIKI_SCHEMA_VERSION = 1;
const MAX_MANIFEST_RUNS = 50;

export type LlmWikiEvidenceState = 'seed' | 'verified';

export interface LlmWikiCoverageLane {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly evidenceNeeded: readonly string[];
  readonly owner: string;
}

export interface LlmWikiEvidenceFiles {
  readonly root: string;
  readonly llmWikiPath: string;
  readonly knowledgeMapPath: string;
  readonly coverageMatrixPath: string;
  readonly reviewLoopPath: string;
  readonly learnLedgerPath: string;
}

export interface LlmWikiSeedInput {
  readonly runId: string;
  readonly createdAt: string;
  readonly objective: string;
  readonly source: UltraworkActivationSource;
  readonly replaceGoal: boolean;
  readonly coverageMatrix: readonly LlmWikiCoverageLane[];
  readonly evidenceFiles: LlmWikiEvidenceFiles;
}

export interface LlmWikiArtifacts {
  readonly wikiRootPath: string;
  readonly wikiIndexPath: string;
  readonly wikiManifestPath: string;
  readonly wikiRunPath: string;
}

interface LlmWikiManifestRun {
  readonly runId: string;
  readonly createdAt: string;
  readonly objective: string;
  readonly source: UltraworkActivationSource;
  readonly replaceGoal: boolean;
  readonly evidenceState?: LlmWikiEvidenceState;
  readonly path: string;
  readonly evidenceRoot: string;
  readonly llmWikiPath: string;
  readonly knowledgeMapPath: string;
  readonly coverageMatrixPath: string;
  readonly reviewLoopPath: string;
  readonly learnLedgerPath: string;
}

interface LlmWikiManifestSource {
  readonly type: 'local_evidence';
  readonly path: string;
}

interface LlmWikiManifest {
  readonly kind: 'llm-wiki-manifest';
  readonly schemaVersion: typeof LLM_WIKI_SCHEMA_VERSION;
  readonly workspaceRoot: '.';
  readonly updatedAt: string;
  readonly latestRunId: string;
  readonly runs: readonly LlmWikiManifestRun[];
  readonly topics: readonly string[];
  readonly sources: readonly LlmWikiManifestSource[];
}

export interface LlmWikiStatus {
  readonly rootPath: string;
  readonly indexPath: string;
  readonly manifestPath: string;
  readonly exists: boolean;
  readonly indexExists: boolean;
  readonly manifestValid: boolean;
  readonly latestRunPath?: string;
  readonly runCount: number;
  readonly warnings: readonly string[];
}

export function writeProjectLlmWikiSeed(workDir: string, input: LlmWikiSeedInput): LlmWikiArtifacts {
  const wikiPaths = resolveLlmWikiPaths(workDir);
  const artifacts: LlmWikiArtifacts = {
    wikiRootPath: wikiPaths.wikiRootPath,
    wikiIndexPath: wikiPaths.wikiIndexPath,
    wikiManifestPath: wikiPaths.wikiManifestPath,
    wikiRunPath: `${wikiPaths.wikiRootPath}/runs/${input.runId}.md`,
  };
  mkdirSync(join(workDir, wikiPaths.wikiRootPath, 'runs'), { recursive: true });

  const manifest = upsertManifest(readExistingManifest(workDir), input, artifacts);
  writeFileSync(join(workDir, artifacts.wikiRunPath), renderRunPage(input, artifacts), 'utf8');
  writeFileSync(join(workDir, artifacts.wikiIndexPath), renderIndexPage(manifest), 'utf8');
  writeFileSync(join(workDir, artifacts.wikiManifestPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return artifacts;
}

export function resolveLatestRunEvidenceState(workDir: string): LlmWikiEvidenceState | undefined {
  const manifest = readExistingManifest(workDir);
  if (manifest === undefined) return undefined;
  const latest = manifest.runs.find((run) => run.runId === manifest.latestRunId);
  return latest?.evidenceState ?? 'seed';
}

export interface PromoteProjectEvidenceResult {
  readonly wikiPromoted: boolean;
  readonly knowledgeMapPromoted: boolean;
  readonly manifestPath: string;
  readonly wikiRunPath?: string;
  readonly knowledgeMapPath?: string;
  readonly warnings: readonly string[];
}

export function promoteProjectEvidenceToVerified(workDir: string, now = new Date()): PromoteProjectEvidenceResult {
  const wikiPaths = resolveLlmWikiPaths(workDir);
  const manifestPath = join(workDir, wikiPaths.wikiManifestPath);
  const manifest = readExistingManifest(workDir);
  const warnings: string[] = [];
  if (manifest === undefined) {
    return {
      wikiPromoted: false,
      knowledgeMapPromoted: false,
      manifestPath,
      warnings: [`Missing or invalid LLM Wiki manifest: ${manifestPath}`],
    };
  }

  const latestRunId = manifest.latestRunId;
  const latest = manifest.runs.find((run) => run.runId === latestRunId);
  if (latest === undefined) {
    return {
      wikiPromoted: false,
      knowledgeMapPromoted: false,
      manifestPath,
      warnings: [`Latest LLM Wiki run not found in manifest: ${latestRunId}`],
    };
  }

  const updatedAt = now.toISOString();
  const nextManifest: LlmWikiManifest = {
    ...manifest,
    updatedAt,
    runs: manifest.runs.map((run) =>
      run.runId === latestRunId ? { ...run, evidenceState: 'verified' } : run,
    ),
  };
  writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');

  let knowledgeMapPromoted = false;
  const knowledgeMapAbsolutePath = join(workDir, latest.knowledgeMapPath);
  if (existsSync(knowledgeMapAbsolutePath)) {
    try {
      const parsed = JSON.parse(readFileSync(knowledgeMapAbsolutePath, 'utf8')) as Record<string, unknown>;
      writeFileSync(
        knowledgeMapAbsolutePath,
        `${JSON.stringify({ ...parsed, evidenceState: 'verified', verifiedAt: updatedAt }, null, 2)}\n`,
        'utf8',
      );
      knowledgeMapPromoted = true;
    } catch {
      warnings.push(`Failed to promote knowledge map: ${knowledgeMapAbsolutePath}`);
    }
  } else {
    warnings.push(`Knowledge map not found: ${knowledgeMapAbsolutePath}`);
  }

  return {
    wikiPromoted: true,
    knowledgeMapPromoted,
    manifestPath,
    wikiRunPath: join(workDir, latest.path),
    knowledgeMapPath: knowledgeMapAbsolutePath,
    warnings,
  };
}

export function buildPromoteEvidenceLines(result: PromoteProjectEvidenceResult): string[] {
  const lines = [
    `LLM Wiki  ${result.wikiPromoted ? 'verified' : 'blocked'}`,
    `Manifest  ${result.manifestPath}`,
    `Run  ${result.wikiRunPath ?? 'none'}`,
    `Knowledge map  ${result.knowledgeMapPromoted ? 'verified' : 'blocked'}; ${result.knowledgeMapPath ?? 'none'}`,
    `Next  ${result.wikiPromoted && result.knowledgeMapPromoted ? 'Run /memory readiness or /preflight to confirm gates.' : 'Fix warnings, then rerun /memory verify.'}`,
  ];
  for (const warning of result.warnings) lines.push(`Warning  ${warning}`);
  return lines;
}

export function loadLlmWikiStatus(workDir: string): LlmWikiStatus {
  const wikiPaths = resolveLlmWikiPaths(workDir);
  const rootPath = join(workDir, wikiPaths.wikiRootPath);
  const indexPath = join(workDir, wikiPaths.wikiIndexPath);
  const manifestPath = join(workDir, wikiPaths.wikiManifestPath);
  const warnings: string[] = [];
  const manifest = readExistingManifest(workDir);
  const exists = existsSync(rootPath);
  const indexExists = existsSync(indexPath);
  let latestRunPath: string | undefined;
  if (manifest !== undefined) {
    const latest = manifest.runs.find((run) => run.runId === manifest.latestRunId);
    latestRunPath = latest?.path;
  } else if (exists || indexExists || existsSync(manifestPath)) {
    warnings.push(`Malformed or missing LLM Wiki manifest: ${manifestPath}`);
  }
  if (!indexExists && exists) warnings.push(`Missing LLM Wiki index: ${indexPath}`);
  return {
    rootPath,
    indexPath,
    manifestPath,
    exists,
    indexExists,
    manifestValid: manifest !== undefined,
    latestRunPath,
    runCount: manifest?.runs.length ?? 0,
    warnings,
  };
}

export function buildLlmWikiStatusLines(status: LlmWikiStatus): string[] {
  const state = status.exists && status.indexExists && status.manifestValid ? 'ready' : 'missing';
  const lines = [
    `State  ${state}`,
    `Root  ${status.rootPath}`,
    `Index  ${status.indexPath}`,
    `Manifest  ${status.manifestValid ? 'valid' : 'missing or invalid'}; ${status.manifestPath}`,
    `Runs  ${status.runCount}`,
    `Latest  ${status.latestRunPath ?? 'none'}`,
    `Next  ${nextLlmWikiAction(status)}`,
  ];
  for (const warning of status.warnings) lines.push(`Warning  ${warning}`);
  return lines;
}

export function isValidLlmWikiManifestText(text: string): boolean {
  try {
    return isValidLlmWikiManifest(JSON.parse(text));
  } catch {
    return false;
  }
}

function readExistingManifest(workDir: string): LlmWikiManifest | undefined {
  const path = join(workDir, resolveLlmWikiPaths(workDir).wikiManifestPath);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isValidLlmWikiManifest(parsed)) return undefined;
    return normalizeLlmWikiManifest(parsed);
  } catch {
    return undefined;
  }
}

function normalizeLlmWikiManifest(manifest: LlmWikiManifest): LlmWikiManifest {
  return {
    ...manifest,
    runs: manifest.runs.map((run) => ({
      ...run,
      evidenceState: run.evidenceState ?? 'seed',
    })),
  };
}

function isValidLlmWikiManifest(value: unknown): value is LlmWikiManifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Partial<LlmWikiManifest>;
  return (
    manifest.kind === 'llm-wiki-manifest'
    && manifest.schemaVersion === LLM_WIKI_SCHEMA_VERSION
    && manifest.workspaceRoot === '.'
    && typeof manifest.updatedAt === 'string'
    && typeof manifest.latestRunId === 'string'
    && Array.isArray(manifest.runs)
    && manifest.runs.every(isValidManifestRun)
    && Array.isArray(manifest.topics)
    && Array.isArray(manifest.sources)
  );
}

function isValidManifestRun(value: unknown): value is LlmWikiManifestRun {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Partial<LlmWikiManifestRun>;
  return (
    typeof run.runId === 'string'
    && typeof run.createdAt === 'string'
    && typeof run.objective === 'string'
    && typeof run.source === 'string'
    && typeof run.replaceGoal === 'boolean'
    && (run.evidenceState === undefined || run.evidenceState === 'seed' || run.evidenceState === 'verified')
    && typeof run.path === 'string'
    && typeof run.evidenceRoot === 'string'
    && typeof run.llmWikiPath === 'string'
    && typeof run.knowledgeMapPath === 'string'
    && typeof run.coverageMatrixPath === 'string'
    && typeof run.reviewLoopPath === 'string'
    && typeof run.learnLedgerPath === 'string'
  );
}

function upsertManifest(
  previous: LlmWikiManifest | undefined,
  input: LlmWikiSeedInput,
  artifacts: LlmWikiArtifacts,
): LlmWikiManifest {
  const run: LlmWikiManifestRun = {
    runId: input.runId,
    createdAt: input.createdAt,
    objective: input.objective,
    source: input.source,
    replaceGoal: input.replaceGoal,
    evidenceState: 'seed',
    path: artifacts.wikiRunPath,
    evidenceRoot: input.evidenceFiles.root,
    llmWikiPath: input.evidenceFiles.llmWikiPath,
    knowledgeMapPath: input.evidenceFiles.knowledgeMapPath,
    coverageMatrixPath: input.evidenceFiles.coverageMatrixPath,
    reviewLoopPath: input.evidenceFiles.reviewLoopPath,
    learnLedgerPath: input.evidenceFiles.learnLedgerPath,
  };
  const previousRuns = previous?.runs.filter((entry) => entry.runId !== input.runId) ?? [];
  const sources = dedupeSources([
    ...(previous?.sources ?? []),
    { type: 'local_evidence', path: input.evidenceFiles.root },
  ]);
  return {
    kind: 'llm-wiki-manifest',
    schemaVersion: LLM_WIKI_SCHEMA_VERSION,
    workspaceRoot: '.',
    updatedAt: input.createdAt,
    latestRunId: input.runId,
    runs: [run, ...previousRuns].slice(0, MAX_MANIFEST_RUNS),
    topics: previous?.topics ?? [],
    sources,
  };
}

function dedupeSources(sources: readonly LlmWikiManifestSource[]): readonly LlmWikiManifestSource[] {
  const seen = new Set<string>();
  const result: LlmWikiManifestSource[] = [];
  for (const source of sources) {
    const key = `${source.type}:${source.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function renderIndexPage(manifest: LlmWikiManifest): string {
  const latest = manifest.runs.find((run) => run.runId === manifest.latestRunId);
  const runLinks = manifest.runs
    .slice(0, 10)
    .map((run) => `- [${run.createdAt} ${run.runId}](runs/${basename(run.path)}) - ${run.objective}`)
    .join('\n');
  const sources = manifest.sources.map((source) => `- ${source.type}: ${source.path}`).join('\n');
  return `# LLM Wiki

Updated: ${manifest.updatedAt}
Workspace root: ${manifest.workspaceRoot}

This project-local wiki stores human-reviewable, source-backed Ultrawork knowledge. Code remains the source of truth. Liora Recall remains the global searchable memory and should only receive concise durable facts, decisions, or user preferences.

## Latest Run

${latest === undefined ? '- none' : `- [${latest.runId}](runs/${basename(latest.path)}) - ${latest.objective}`}

## Recent Runs

${runLinks.length === 0 ? '- none' : runLinks}

## Durable Guidance

- Promote only verified findings, durable decisions, and reusable project knowledge.
- Keep raw transcripts, unverified snippets, secrets, credentials, and private identifiers out of the wiki.
- Mark speculation as Open Questions until it is backed by code, tests, runtime evidence, or cited sources.
- Link every important claim to a file path, evidence artifact, or source URL.

## Sources

${sources.length === 0 ? '- none' : sources}
`;
}

function renderRunPage(input: LlmWikiSeedInput, artifacts: LlmWikiArtifacts): string {
  const lanes = input.coverageMatrix
    .map((lane) => `- ${lane.id}: ${lane.reason} Owner: ${lane.owner}. Evidence: ${lane.evidenceNeeded.join(', ')}.`)
    .join('\n');
  return `# Ultrawork Run - ${input.runId}

Created: ${input.createdAt}
Source: ${input.source}
Replace goal requested: ${String(input.replaceGoal)}

## Objective

${input.objective}

## Current Understanding

- This page is the project-local LLM Wiki record for the Ultrawork run.
- Startup content is a seed. During Learn, replace placeholders with verified findings, durable decisions, and source-backed evidence.
- Liora Recall remains global searchable memory; this wiki is project-local review material.

## Durable Decisions

- Store project-specific reviewable knowledge under ${artifacts.wikiRootPath}.
- Store only concise cross-session facts or preferences in Liora Recall.
- Treat code, tests, and runtime evidence as the final source of truth.

## Evidence Links

- LLM Wiki index: ${artifacts.wikiIndexPath}
- LLM Wiki manifest: ${artifacts.wikiManifestPath}
- Run evidence root: ${input.evidenceFiles.root}
- Canonical run page: ${input.evidenceFiles.llmWikiPath}
- Liora Knowledge Map: ${input.evidenceFiles.knowledgeMapPath}
- Capability Coverage Matrix: ${input.evidenceFiles.coverageMatrixPath}
- Expert Review Loop: ${input.evidenceFiles.reviewLoopPath}
- Knowledge persistence ledger: ${input.evidenceFiles.learnLedgerPath}

## Capability Coverage

${lanes}

## Verification

- pending: fill with focused tests, typecheck, runtime evidence, screenshots, source URLs, or reviewer verdicts before completion.

## Open Questions

- pending: move any unverified claim here until it is backed by evidence.

## Next Retrieval Hints

- Start with ${artifacts.wikiIndexPath}, then inspect this run page and the linked knowledge map.
- Use LioraContext for compact source maps before broad reads.
- Use Liora Recall for concise durable memories only when they are relevant to the current task.
`;
}

function nextLlmWikiAction(status: LlmWikiStatus): string {
  if (!status.exists) return 'Start an Ultrawork run to create project-local LLM Wiki artifacts.';
  if (!status.indexExists) return 'Regenerate the LLM Wiki index with the next Ultrawork run.';
  if (!status.manifestValid) return 'Regenerate the LLM Wiki manifest with the next Ultrawork run.';
  return 'Open the index path above or run /memory readiness to verify recall plus evidence.';
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { KNOWLEDGE_MAP_FILENAME, resolveEvidenceRoot } from '#/constant/workspace-data';
import {
  writeProjectLlmWikiSeed,
  type LlmWikiArtifacts,
  type LlmWikiRunSource,
} from '#/tui/commands/memory/llm-wiki';

export interface WikiSeedFixture extends LlmWikiArtifacts {
  readonly runId: string;
  /** Workspace-relative run evidence root. */
  readonly root: string;
  /** Workspace-relative knowledge map path. */
  readonly knowledgeMapPath: string;
}

/**
 * Writes the LLM Wiki v2 index/manifest/run page plus a seed-tier knowledge map,
 * i.e. the on-disk shape a startup evidence seed leaves behind.
 */
export function writeWikiSeedFixture(
  workDir: string,
  objective: string,
  options: {
    readonly runId?: string;
    readonly createdAt?: string;
    readonly source?: LlmWikiRunSource;
  } = {},
): WikiSeedFixture {
  const runId = options.runId ?? 'seed-run';
  const createdAt = options.createdAt ?? '2026-07-02T00:00:00.000Z';
  const root = join(resolveEvidenceRoot(workDir), runId);
  const knowledgeMapPath = join(root, KNOWLEDGE_MAP_FILENAME);
  const evidenceFiles = {
    root,
    llmWikiPath: `${resolveEvidenceRoot(workDir)}/${runId}/llm-wiki.md`,
    knowledgeMapPath,
    coverageMatrixPath: join(root, 'capability-coverage-matrix.json'),
    reviewLoopPath: join(root, 'expert-review-loop.md'),
    learnLedgerPath: join(root, 'knowledge-persistence-ledger.json'),
  };

  mkdirSync(join(workDir, root), { recursive: true });
  writeFileSync(
    join(workDir, knowledgeMapPath),
    `${JSON.stringify(
      {
        kind: 'liora knowledge map',
        schema: 1,
        evidenceState: 'seed',
        createdAt,
        objective,
        relationship_confidence: [],
        nodes: [],
        edges: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const artifacts = writeProjectLlmWikiSeed(workDir, {
    runId,
    createdAt,
    objective,
    source: options.source ?? 'manual',
    replaceGoal: false,
    coverageMatrix: [],
    evidenceFiles,
  });

  return { ...artifacts, runId, root, knowledgeMapPath };
}

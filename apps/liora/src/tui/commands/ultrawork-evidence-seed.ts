/** Ultrawork evidence seed writers and run id helpers. */

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { KNOWLEDGE_MAP_FILENAME, resolveLlmWikiPaths, resolveUltraworkEvidenceRoot } from '#/constant/workspace-data';
import { writeProjectLlmWikiSeed } from './llm-wiki';
import {
  buildUltraworkCoverageMatrix,
  type UltraworkCoverageLane,
} from './ultrawork-coverage';
import type { UltraworkActivationSource, UltraworkEvidenceSeed } from './ultrawork-contract';

export function buildUltraworkRunId(objective: string, now = new Date()): string {
  const createdAt = now.toISOString();
  return `${createdAt.replaceAll(/[:.]/gu, '').replaceAll(/[^0-9TZ-]/gu, '')}-${slugifyObjective(objective)}-${randomUUID().slice(0, 8)}`;
}

export async function createUltraworkEvidenceSeed(
  workDir: string,
  objective: string,
  source: UltraworkActivationSource,
  replaceGoal: boolean,
  runId = buildUltraworkRunId(objective),
  now = new Date(),
): Promise<UltraworkEvidenceSeed> {
  const createdAt = now.toISOString();
  const root = join(resolveUltraworkEvidenceRoot(workDir), runId);
  const absoluteRoot = join(workDir, root);
  mkdirSync(absoluteRoot, { recursive: true });

  const safeObjective = redactEvidenceText(objective);
  const coverageMatrix = buildUltraworkCoverageMatrix(objective);
  const wikiRunPath = `${resolveLlmWikiPaths(workDir).wikiRootPath}/runs/${runId}.md`;
  const files = {
    llmWikiPath: wikiRunPath,
    knowledgeMapPath: join(root, KNOWLEDGE_MAP_FILENAME),
    coverageMatrixPath: join(root, 'capability-coverage-matrix.json'),
    reviewLoopPath: join(root, 'expert-review-loop.md'),
    learnLedgerPath: join(root, 'knowledge-persistence-ledger.json'),
  };
  const wikiArtifacts = writeProjectLlmWikiSeed(workDir, {
    runId,
    createdAt,
    objective: safeObjective,
    source,
    replaceGoal,
    coverageMatrix,
    evidenceFiles: { root, ...files },
  });
  const workflowReportPath = join(root, 'workflow-report.md');
  const workflowStagesPath = join(root, 'workflow-stages.json');
  // Parallel seed writes: independent artifacts under the same run root.
  await Promise.all([
    writeFile(
      join(workDir, files.knowledgeMapPath),
      `${JSON.stringify({
        kind: 'liora knowledge map',
        schema: 1,
        evidenceState: 'seed',
        createdAt,
        objective: safeObjective,
        extractionPolicy: 'Relationships must be labelled EXTRACTED, INFERRED, or AMBIGUOUS.',
        relationship_confidence: [],
        path_affected_questions: [
          'Which files, tests, tools, and visible surfaces are connected to this UltraGoal?',
          'Which acceptance criteria need runtime, browser, computer-use, or expert evidence?',
        ],
        linked_from: [wikiArtifacts.wikiIndexPath],
        linked_to: [wikiArtifacts.wikiIndexPath],
        nodes: [
          { id: 'ultragoal_seed', type: 'goal', label: 'Provisional UltraGoal seed', confidence: 'EXTRACTED' },
          { id: 'coverage_matrix', type: 'artifact', label: files.coverageMatrixPath, confidence: 'EXTRACTED' },
          { id: 'expert_review_loop', type: 'artifact', label: files.reviewLoopPath, confidence: 'EXTRACTED' },
        ],
        edges: [
          {
            from: 'ultragoal_seed',
            to: 'coverage_matrix',
            relation: 'requires_capability_coverage',
            confidence: 'EXTRACTED',
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(workDir, files.coverageMatrixPath),
      `${JSON.stringify({
        kind: 'capability coverage matrix',
        schema: 1,
        createdAt,
        objective: safeObjective,
        lanes: coverageMatrix,
        swarmDecisionPolicy: {
          engageWhen:
            'More than one material lane, subjective quality, domain correctness, runtime evidence, or independent review is required.',
          deferWhen:
            'Every required lane is safely owned by the main agent and single-agent execution is lower-risk.',
        },
      }, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(workDir, files.reviewLoopPath),
      renderExpertReviewLoopSeed(createdAt, safeObjective, coverageMatrix),
      'utf8',
    ),
    writeFile(
      join(workDir, files.learnLedgerPath),
      `${JSON.stringify({
        kind: 'knowledge persistence ledger',
        schema: 1,
        createdAt,
        objective: safeObjective,
        entries: [
          {
            target: 'liora_recall',
            action: 'skipped',
            reason: 'Startup seed is not yet a verified reusable finding; write during Learn if durable knowledge is produced.',
          },
          {
            target: 'llm_wiki',
            action: 'wrote',
            reason: 'Created project-local LLM Wiki v2 index and run page before implementation.',
            path: wikiArtifacts.wikiRunPath,
            evidence: wikiArtifacts.wikiRunPath,
          },
          {
            target: 'workflow_report',
            action: 'wrote',
            reason: 'Workflow transparency harness seeds workflow-report.md and workflow-stages.json at run start.',
            path: workflowReportPath,
            evidence: workflowReportPath,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    ),
  ]);

  return {
    root,
    ...wikiArtifacts,
    ...files,
    workflowReportPath,
    workflowStagesPath,
  };
}

function renderExpertReviewLoopSeed(
  createdAt: string,
  objective: string,
  coverageMatrix: readonly UltraworkCoverageLane[],
): string {
  const reviewRequired = coverageMatrix.some((lane) => lane.id === 'independent_review_loop');
  const laneRows = coverageMatrix
    .map((lane) => `| ${lane.id} | ${lane.owner} | ${lane.evidenceNeeded.join(', ')} |`)
    .join('\n');
  return `# Expert Review Loop

Created: ${createdAt}

Objective: ${objective}

Review required: ${reviewRequired ? 'yes' : 'conditional'}

Before reporting completion, compare the actual result against each lane below. If any reviewer returns non-PASS, fix the concrete issue and repeat review until PASS or an explicit blocker is recorded.

| lane | owner | evidence needed |
|---|---|---|
${laneRows}

Reviewer verdicts:

- pending
`;
}

function slugifyObjective(objective: string): string {
  const slug = objective
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, 32);
  return slug.length === 0 ? 'task' : slug;
}

function redactEvidenceText(value: string): string {
  return value
    .replaceAll(/\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)[A-Z0-9_]*\b/gu, '[REDACTED_ENV]')
    .replaceAll(/\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|credential)[A-Za-z0-9_-]*)=([^\s,;]+)/giu, '$1=[REDACTED_SECRET]')
    .replaceAll(/\b(?:sk|sk-proj|ghp|xoxb)-[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED_SECRET]')
    .replaceAll(/\bAKIA[0-9A-Z]{16}\b/gu, '[REDACTED_AWS_KEY]')
    .replaceAll(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/gu, '[REDACTED_JWT]')
    .replaceAll(/\b(?:Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gu, 'Bearer [REDACTED_TOKEN]');
}


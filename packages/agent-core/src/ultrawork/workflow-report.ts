import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'pathe';

import type { UltraworkRun, UltraworkStage } from '@superliora/protocol';

import type { Agent } from '../agent';
import { ULTRAWORK_STAGE_ORDER } from './state';

export const WORKFLOW_REPORT_FILENAME = 'workflow-report.md';
export const WORKFLOW_STAGES_FILENAME = 'workflow-stages.json';

export interface UltraworkWorkflowReportPaths {
  readonly reportPath: string;
  readonly stagesPath: string;
}

export interface SeedUltraworkWorkflowReportInput {
  readonly workDir: string;
  readonly evidenceRoot: string;
  readonly runId: string;
  readonly objective: string;
  readonly createdAt: string;
  readonly source: string;
}

export interface RecordUltraworkWorkflowStageInput {
  readonly workDir: string;
  readonly evidenceRoot: string;
  readonly run: UltraworkRun;
  readonly from?: UltraworkStage;
  readonly to: UltraworkStage;
  readonly reason?: string;
}

interface WorkflowStagesLedger {
  readonly kind: 'ultrawork-workflow-stages';
  readonly schema: 1;
  readonly runId: string;
  readonly objective: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly transitions: readonly WorkflowStageTransition[];
}

interface WorkflowStageTransition {
  readonly from?: UltraworkStage;
  readonly to: UltraworkStage;
  readonly at: string;
  readonly reason?: string;
  readonly runStatus: UltraworkRun['status'];
}

const NARRATIVE_STAGES = ULTRAWORK_STAGE_ORDER.filter((stage) => stage !== 'done');

export function resolveUltraworkWorkflowReportPaths(evidenceRoot: string): UltraworkWorkflowReportPaths {
  return {
    reportPath: join(evidenceRoot, WORKFLOW_REPORT_FILENAME),
    stagesPath: join(evidenceRoot, WORKFLOW_STAGES_FILENAME),
  };
}

export function isUltraworkWorkflowReportWritePath(
  path: string,
  evidenceRoot: string,
  workDir: string,
): boolean {
  const paths = resolveUltraworkWorkflowReportPaths(evidenceRoot);
  const normalized = normalize(path);
  const allowed = [
    normalize(paths.reportPath),
    normalize(join(workDir, paths.reportPath)),
    normalize(paths.stagesPath),
    normalize(join(workDir, paths.stagesPath)),
  ];
  if (allowed.includes(normalized)) return true;

  // Allow the whole active evidence root + wiki run ledger during ENGAGE /
  // plan-mode transparency fills (not product source).
  const absoluteRoot = normalize(join(workDir, evidenceRoot));
  if (normalized === absoluteRoot || normalized.startsWith(`${absoluteRoot}/`)) {
    return true;
  }
  const relativeRoot = normalize(evidenceRoot);
  if (normalized === relativeRoot || normalized.startsWith(`${relativeRoot}/`)) {
    return true;
  }
  const wikiMarker = `${normalize('.superliora/wiki')}/`;
  if (normalized.includes(wikiMarker) || normalized.includes('/.superliora/wiki/')) {
    return true;
  }
  return false;
}

export function ensureUltraworkWorkflowArtifacts(agent: Agent): void {
  const run = agent.ultrawork.getRun();
  const activation = agent.ultrawork.getActivation();
  if (run === null || activation === undefined) return;

  const workDir = activation.workDir || agent.kaos.getcwd();
  const absoluteRoot = join(workDir, activation.evidenceRoot);
  const reportPath = join(absoluteRoot, WORKFLOW_REPORT_FILENAME);
  const stagesPath = join(absoluteRoot, WORKFLOW_STAGES_FILENAME);
  if (existsSync(reportPath) && existsSync(stagesPath)) return;

  try {
    seedUltraworkWorkflowReport({
      workDir,
      evidenceRoot: activation.evidenceRoot,
      runId: run.id,
      objective: run.objective,
      createdAt: run.createdAt,
      source: activation.source,
    });
  } catch (error) {
    agent.log.warn('ultrawork workflow report ensure failed', { runId: run.id, error });
  }
}

export function seedUltraworkWorkflowReport(input: SeedUltraworkWorkflowReportInput): UltraworkWorkflowReportPaths {
  const paths = resolveUltraworkWorkflowReportPaths(input.evidenceRoot);
  const absoluteRoot = join(input.workDir, input.evidenceRoot);
  mkdirSync(absoluteRoot, { recursive: true });

  const ledger: WorkflowStagesLedger = {
    kind: 'ultrawork-workflow-stages',
    schema: 1,
    runId: input.runId,
    objective: input.objective,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    transitions: [
      {
        to: 'intake',
        at: input.createdAt,
        reason: `Ultrawork run created (${input.source})`,
        runStatus: 'running',
      },
    ],
  };

  writeFileSync(join(input.workDir, paths.stagesPath), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(input.workDir, paths.reportPath),
    renderWorkflowReportSeed({
      runId: input.runId,
      objective: input.objective,
      createdAt: input.createdAt,
      evidenceRoot: input.evidenceRoot,
      source: input.source,
      currentStage: 'intake',
    }),
    'utf8',
  );
  return paths;
}

export function recordUltraworkWorkflowStage(input: RecordUltraworkWorkflowStageInput): boolean {
  if (input.from === input.to) return false;
  const paths = resolveUltraworkWorkflowReportPaths(input.evidenceRoot);
  const reportAbsolutePath = join(input.workDir, paths.reportPath);
  const stagesAbsolutePath = join(input.workDir, paths.stagesPath);
  if (!existsSync(reportAbsolutePath) || !existsSync(stagesAbsolutePath)) return false;

  const at = input.run.updatedAt;
  const transition: WorkflowStageTransition = {
    from: input.from,
    to: input.to,
    at,
    reason: input.reason,
    runStatus: input.run.status,
  };

  const ledger = readWorkflowStagesLedger(stagesAbsolutePath);
  if (ledger === undefined) return false;
  const nextLedger: WorkflowStagesLedger = {
    ...ledger,
    updatedAt: at,
    transitions: [...ledger.transitions, transition],
  };
  writeFileSync(stagesAbsolutePath, `${JSON.stringify(nextLedger, null, 2)}\n`, 'utf8');

  const report = readFileSync(reportAbsolutePath, 'utf8');
  const timelineRow = `| ${at} | ${input.from ?? '—'} | ${input.to} | ${escapeTableCell(input.reason ?? '—')} |`;
  const withTimeline = appendTimelineRow(report, timelineRow);
  const withCurrentStage = replaceCurrentStage(withTimeline, input.to);
  const withCompletion = input.to === 'done'
    ? appendRunCompletion(withCurrentStage, at, input.reason)
    : withCurrentStage;
  writeFileSync(reportAbsolutePath, withCompletion, 'utf8');
  return true;
}

export function injectUltraworkWorkflowStageReminder(
  agent: Agent,
  input: RecordUltraworkWorkflowStageInput,
): void {
  if (input.from === undefined || input.from === input.to) return;
  const paths = resolveUltraworkWorkflowReportPaths(input.evidenceRoot);
  const stageToDocument = input.from;
  agent.context.appendSystemReminder(
    [
      '<ultrawork_workflow_report>',
      `Ultrawork stage transition: ${stageToDocument} -> ${input.to}.`,
      'Mandatory project-local transparency: before continuing, update the workflow report in the open project folder.',
      `  - workflow_report: ${paths.reportPath}`,
      `  - workflow_stages: ${paths.stagesPath}`,
      `  - llm_wiki_run: ${resolveWikiRunPath(input.evidenceRoot, input.run.id)}`,
      `Fill the "## ${stageToDocument}" narrative in workflow-report.md with:`,
      '  1. What happened in this stage (concrete actions, not process narration).',
      '  2. Artifacts / paths (plan file, tests, screenshots, source URLs, tool outputs).',
      '  3. Decisions made (including Swarm ENGAGE/DEFER when relevant).',
      '  4. Gaps / follow-ups still open when leaving the stage.',
      'Replace every `pending` placeholder under that stage. Do not leave proof only in chat.',
      input.to === 'learn'
        ? 'Learn is next: also update knowledge-persistence-ledger.json and the LLM Wiki run page with verified durable findings.'
        : undefined,
      input.to === 'done'
        ? 'Run complete: ensure every stage narrative is filled and add a concise Run Summary at the end of workflow-report.md.'
        : undefined,
      '</ultrawork_workflow_report>',
    ].filter((line): line is string => line !== undefined).join('\n'),
    { kind: 'injection', variant: 'ultrawork_workflow_report' },
  );
}

export function mirrorUltraworkWorkflowStage(
  agent: Agent,
  input: RecordUltraworkWorkflowStageInput,
): void {
  try {
    recordUltraworkWorkflowStage(input);
  } catch (error) {
    agent.log.warn('ultrawork workflow report stage mirror failed', {
      runId: input.run.id,
      from: input.from,
      to: input.to,
      error,
    });
  }
  injectUltraworkWorkflowStageReminder(agent, input);
}

function resolveWikiRunPath(evidenceRoot: string, runId: string): string {
  const segment = '.superliora/wiki/runs/';
  if (evidenceRoot.includes('/ultrawork-runs/')) {
    return `${segment}${runId}.md`;
  }
  return `${segment}${runId}.md`;
}

function readWorkflowStagesLedger(path: string): WorkflowStagesLedger | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as WorkflowStagesLedger;
    if (parsed.kind !== 'ultrawork-workflow-stages' || parsed.schema !== 1) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function renderWorkflowReportSeed(input: {
  readonly runId: string;
  readonly objective: string;
  readonly createdAt: string;
  readonly evidenceRoot: string;
  readonly source: string;
  readonly currentStage: UltraworkStage;
}): string {
  const narratives = NARRATIVE_STAGES.map((stage) => renderStageNarrativeSection(stage)).join('\n\n');
  return `# Ultrawork Workflow Report

Run ID: ${input.runId}
Objective: ${input.objective}
Created: ${input.createdAt}
Source: ${input.source}
Evidence root: ${input.evidenceRoot}

This file is the mandatory transparency ledger for this Ultrawork run.
The harness appends stage transitions to the timeline below.
The agent must replace every \`pending\` placeholder before leaving each stage.

Linked wiki run: \`.superliora/wiki/runs/${input.runId}.md\`

## Current Stage

${input.currentStage}

## Stage Timeline

| At | From | To | Reason |
|---|---|---|---|
| ${input.createdAt} | — | intake | Ultrawork run created (${input.source}) |

## Stage Narratives

${narratives}

## Run Summary

- pending: fill when the run completes with outcome, verification status, and where durable knowledge was saved.
`;
}

function renderStageNarrativeSection(stage: UltraworkStage): string {
  return `### ${stage}

**Harness status:** pending

- **What happened:** pending
- **Artifacts / paths:** pending
- **Decisions:** pending
- **Gaps / follow-ups:** pending`;
}

function appendTimelineRow(report: string, row: string): string {
  const marker = '## Stage Narratives';
  const index = report.indexOf(marker);
  if (index < 0) return `${report}\n${row}\n`;
  const before = report.slice(0, index).trimEnd();
  return `${before}\n${row}\n\n${report.slice(index)}`;
}

function replaceCurrentStage(report: string, stage: UltraworkStage): string {
  return report.replace(
    /## Current Stage\n\n[\w-]+/,
    `## Current Stage\n\n${stage}`,
  );
}

function appendRunCompletion(report: string, at: string, reason?: string): string {
  if (report.includes('## Run Completion')) return report;
  const lines = [
    '',
    '## Run Completion',
    '',
    `Completed: ${at}`,
    `Reason: ${reason ?? 'Ultrawork completed'}`,
    '',
    'Ensure every stage narrative above is filled and the Run Summary is updated before closing the session.',
  ];
  return `${report.trimEnd()}\n${lines.join('\n')}\n`;
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

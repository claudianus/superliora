import type { WorkGraph, WorkGraphNode, UltraworkStage } from '@superliora/protocol';

import type { Agent } from '..';
import {
  cloneWorkGraph,
  todosFromWorkGraph,
  ULTRAWORK_GRAPH_STORE_KEY,
} from '../../tools/builtin/state/ultrawork-graph';
import { TODO_STORE_KEY } from '../../tools/builtin/state/todo-list';

const ULTRAWORK_STAGES = new Set<UltraworkStage>([
  'intake',
  'plan',
  'research',
  'goal',
  'staff',
  'swarm',
  'integrate',
  'verify',
  'learn',
  'done',
]);

const WORK_GRAPH_HEADING = 'WorkGraph';

export interface SeedWorkGraphFromPlanResult {
  readonly seeded: boolean;
  readonly runId?: string;
  readonly nodeIds: readonly string[];
}

export function parseWorkGraphNodesFromPlan(plan: string): WorkGraphNode[] | undefined {
  const section = extractPlanSection(plan, WORK_GRAPH_HEADING);
  if (section.length === 0) return undefined;

  const tableNodes = parseWorkGraphTable(section);
  if (tableNodes.length > 0) return tableNodes;

  const bulletNodes = parseWorkGraphBullets(section);
  return bulletNodes.length > 0 ? bulletNodes : undefined;
}

export function seedUltraworkGraphFromApprovedPlan(
  agent: Agent,
  plan: string,
  planPath?: string,
): SeedWorkGraphFromPlanResult {
  const nodes = parseWorkGraphNodesFromPlan(plan);
  if (nodes === undefined || nodes.length === 0) {
    return { seeded: false, nodeIds: [] };
  }

  const validationError = validateWorkGraphNodes(nodes);
  if (validationError !== undefined) {
    return { seeded: false, nodeIds: [] };
  }

  const runId = agent.ultrawork.getActiveRunId() ?? deriveRunId(planPath);
  const now = new Date().toISOString();
  const graph: WorkGraph = cloneWorkGraph({
    id: `${runId}:work_graph`,
    runId,
    rootGoal: extractRootGoalFromPlan(plan),
    createdAt: now,
    updatedAt: now,
    nodes,
  });

  agent.tools.updateStore(ULTRAWORK_GRAPH_STORE_KEY, graph);
  agent.tools.updateStore(TODO_STORE_KEY, todosFromWorkGraph(graph));

  return {
    seeded: true,
    runId,
    nodeIds: nodes.map((node) => node.id),
  };
}

export function formatSeededWorkGraphNotice(result: SeedWorkGraphFromPlanResult): string | undefined {
  if (!result.seeded || result.nodeIds.length === 0) return undefined;
  const runId = result.runId ?? 'ultra-plan';
  return [
    'UltraworkGraph was seeded from the approved plan WorkGraph.',
    `run_id: ${runId}`,
    `work_node_ids: ${result.nodeIds.join(', ')}`,
    'You can call UltraSwarm with those work_node_ids without calling UltraworkGraph first.',
  ].join('\n');
}

function extractPlanSection(plan: string, heading: string): string {
  const lines = plan.split(/\r?\n/);
  const headingPattern = new RegExp(`^\\s*#{2,}\\s+${escapeRegExp(heading)}\\b`, 'i');
  let start = -1;
  for (let index = 0; index < lines.length; index++) {
    if (headingPattern.test(lines[index] ?? '')) {
      start = index + 1;
      break;
    }
  }
  if (start === -1) return '';

  const section: string[] = [];
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (/^\s*#{2,}\s+\S/.test(line)) break;
    section.push(line);
  }
  return section.join('\n');
}

function parseWorkGraphTable(section: string): WorkGraphNode[] {
  const rows = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));
  if (rows.length < 2) return [];

  const headerCells = splitTableRow(rows[0] ?? '');
  const columnIndex = mapWorkGraphColumns(headerCells);
  if (columnIndex.id === undefined) return [];

  const nodes: WorkGraphNode[] = [];
  for (const row of rows.slice(1)) {
    if (isTableSeparatorRow(row)) continue;
    const cells = splitTableRow(row);
    const node = nodeFromTableCells(cells, columnIndex);
    if (node !== undefined) nodes.push(node);
  }
  return nodes;
}

function parseWorkGraphBullets(section: string): WorkGraphNode[] {
  const nodes: WorkGraphNode[] = [];
  for (const line of section.split(/\r?\n/)) {
    const match =
      /^\s*[-*+•]\s+(?:\*\*)?(?:node\s*id|id)\s*:?\s*(?:\*\*)?\s*([A-Za-z0-9_.:-]+)/i.exec(line);
    if (match?.[1] === undefined) continue;
    const id = match[1].trim();
    const acMatch = /\bac(?:\s*id)?\s*:?\s*([A-Za-z0-9_.:-]+)/i.exec(line);
    const stageMatch = /\bstage\s*:?\s*([A-Za-z0-9_.:-]+)/i.exec(line);
    const evidenceMatch = /\brequired\s+evidence\s*:?\s*(.+)$/i.exec(line);
    const stage = parseStage(stageMatch?.[1]);
    if (stage === undefined) continue;
    nodes.push({
      id,
      title: buildNodeTitle(id, acMatch?.[1], evidenceMatch?.[1]),
      acceptanceCriterionId: normalizeOptional(acMatch?.[1]),
      stage,
      laneId: parseLaneId(line),
      status: 'queued',
      kind: kindForStage(stage),
      dependsOn: parseDependencies(line),
      requiredEvidence: parseRequiredEvidence(evidenceMatch?.[1]),
    });
  }
  return nodes;
}

interface WorkGraphColumnIndex {
  id?: number;
  title?: number;
  acceptanceCriterionId?: number;
  stage?: number;
  ownerLane?: number;
  dependsOn?: number;
  requiredEvidence?: number;
}

function mapWorkGraphColumns(headerCells: readonly string[]): WorkGraphColumnIndex {
  const index: WorkGraphColumnIndex = {};
  headerCells.forEach((rawCell, cellIndex) => {
    const cell = rawCell.trim().toLowerCase();
    if (/^node\s*id$/i.test(cell) || cell === 'id') index.id = cellIndex;
    else if (/\btitle\b/.test(cell)) index.title = cellIndex;
    else if (/\b(?:ac(?:\s*id)?|acceptance\s+criterion(?:\s+id)?)\b/.test(cell)) {
      index.acceptanceCriterionId = cellIndex;
    } else if (/\bstage\b/.test(cell)) index.stage = cellIndex;
    else if (/\b(?:owner\s*\/\s*lane|owner|lane)\b/.test(cell)) index.ownerLane = cellIndex;
    else if (/\b(?:dependencies|dependency|depends\s+on)\b/.test(cell)) index.dependsOn = cellIndex;
    else if (/\b(?:required\s+evidence|required_evidence|evidence\s+required)\b/.test(cell)) {
      index.requiredEvidence = cellIndex;
    }
  });
  return index;
}

function nodeFromTableCells(
  cells: readonly string[],
  columnIndex: WorkGraphColumnIndex,
): WorkGraphNode | undefined {
  const id = cellValue(cells, columnIndex.id);
  if (id === undefined) return undefined;

  const stage = parseStage(cellValue(cells, columnIndex.stage));
  if (stage === undefined) return undefined;

  const acceptanceCriterionId = normalizeOptional(cellValue(cells, columnIndex.acceptanceCriterionId));
  const requiredEvidenceRaw = cellValue(cells, columnIndex.requiredEvidence);
  const title =
    normalizeOptional(cellValue(cells, columnIndex.title)) ??
    buildNodeTitle(id, acceptanceCriterionId, requiredEvidenceRaw);

  return {
    id,
    title,
    acceptanceCriterionId,
    stage,
    laneId: parseLaneId(cellValue(cells, columnIndex.ownerLane)),
    status: 'queued',
    kind: kindForStage(stage),
    dependsOn: parseDependencies(cellValue(cells, columnIndex.dependsOn)),
    requiredEvidence: parseRequiredEvidence(requiredEvidenceRaw),
  };
}

function splitTableRow(row: string): string[] {
  return row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparatorRow(row: string): boolean {
  return /^\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|$/.test(row.replaceAll(/\s+/g, ''));
}

function cellValue(cells: readonly string[], index: number | undefined): string | undefined {
  if (index === undefined) return undefined;
  const value = cells[index]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function parseStage(raw: string | undefined): UltraworkStage | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (!ULTRAWORK_STAGES.has(normalized as UltraworkStage)) return undefined;
  return normalized as UltraworkStage;
}

function parseLaneId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || /^none$/i.test(trimmed)) return undefined;
  const parts = trimmed.split('/').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;
  return parts.at(-1);
}

function parseDependencies(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || /^none$/i.test(trimmed)) return undefined;
  const values = trimmed
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !/^none$/i.test(entry));
  return values.length === 0 ? undefined : values;
}

function parseRequiredEvidence(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || /^none$/i.test(trimmed)) return undefined;
  const values = trimmed
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length === 0 ? undefined : values;
}

function buildNodeTitle(
  id: string,
  acceptanceCriterionId: string | undefined,
  requiredEvidence: string | undefined,
): string {
  const acLabel = acceptanceCriterionId ?? id;
  const evidence = requiredEvidence?.trim();
  if (evidence !== undefined && evidence.length > 0 && !/^none$/i.test(evidence)) {
    return `[${acLabel}] ${evidence}`;
  }
  return `WorkGraph node ${id}`;
}

function kindForStage(stage: UltraworkStage): WorkGraphNode['kind'] {
  if (stage === 'research') return 'research';
  if (stage === 'verify') return 'verification';
  if (stage === 'learn') return 'learn';
  if (stage === 'integrate') return 'integration';
  if (stage === 'swarm' || stage === 'staff') return 'implementation';
  if (stage === 'plan' || stage === 'goal' || stage === 'intake') return 'acceptance_criterion';
  return 'other';
}

function extractRootGoalFromPlan(plan: string): string | undefined {
  const seedSection = extractPlanSection(plan, 'Seed Spec');
  const match =
    /(?:\*\*)?Verifiable UltraGoal(?:\*\*)?\s*:\s*(.+)$/im.exec(seedSection) ??
    /(?:\*\*)?Completion Criterion(?:\*\*)?\s*:\s*(.+)$/im.exec(seedSection);
  return normalizeOptional(match?.[1]?.replaceAll(/\*\*/g, '').trim());
}

function deriveRunId(planPath: string | undefined): string {
  if (planPath === undefined || planPath.trim().length === 0) {
    return `ultra-plan-${Date.now()}`;
  }
  const base = planPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/u, '') ?? 'plan';
  const slug = base.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-').replaceAll(/^-+|-+$/gu, '');
  return slug.length === 0 ? `ultra-plan-${Date.now()}` : `ultra-plan-${slug}`;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 || /^none$/i.test(trimmed) ? undefined : trimmed;
}

function validateWorkGraphNodes(nodes: readonly WorkGraphNode[]): string | undefined {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) return `Duplicate WorkGraph node id: ${node.id}`;
    ids.add(node.id);
  }
  for (const node of nodes) {
    for (const dependency of node.dependsOn ?? []) {
      if (dependency === node.id) return `WorkGraph node ${node.id} cannot depend on itself.`;
      if (!ids.has(dependency)) {
        return `WorkGraph node ${node.id} depends on missing node ${dependency}.`;
      }
    }
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

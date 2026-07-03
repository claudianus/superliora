import { randomUUID } from 'node:crypto';

import type { TeamPlan, WorkGraph, WorkGraphNode } from '@moonshot-ai/protocol';
import { z } from 'zod';

import type { Agent } from '../../../agent';
import type { SwarmMode } from '../../../agent/swarm';
import type { BuiltinTool } from '../../../agent/tool';
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type QueuedSubagentRunResult,
  type QueuedSubagentTask,
  type SessionSubagentHost,
} from '../../../session/subagent-host';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import ULTRA_SWARM_DESCRIPTION from './ultra-swarm.md?raw';
import { toInputJsonSchema } from '../../support/input-schema';
import { globalUltraSwarmOrchestrator } from '../../../expert-agents/orchestrator';
import type { ExpertAssignment, ExpertSwarmPlan } from '../../../expert-agents/types';
import { appendSwarmResearchAutonomy } from './swarm-research-autonomy';
import type { ToolStore } from '../../store';
import { TODO_STORE_KEY } from '../state/todo-list';
import {
  ULTRAWORK_GRAPH_STORE_KEY,
  cloneWorkGraph,
  todosFromWorkGraph,
} from '../state/ultrawork-graph';

const MAX_ULTRA_SWARM_SUBAGENTS = 128;
const ULTRA_SWARM_PHASES = ['plan', 'implement', 'review'] as const;
type UltraSwarmPhase = typeof ULTRA_SWARM_PHASES[number];
type UltraSwarmFocus = 'plan' | 'research' | 'implement' | 'review' | 'full';

export const UltraSwarmToolInputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1)
      .describe('Task description for the UltraSwarm. Be specific about what you need.'),
    run_id: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Optional Ultrawork/UltraSwarm run id to echo into result metadata and trace evidence.',
      ),
    work_node_ids: z
      .array(z.string().trim().min(1))
      .max(MAX_ULTRA_SWARM_SUBAGENTS)
      .optional()
      .describe(
        'Optional UltraworkGraph node ids to bind this swarm call to.',
      ),
    experts: z
      .array(z.string().trim().min(1))
      .max(MAX_ULTRA_SWARM_SUBAGENTS)
      .optional()
      .describe(
        'Optional list of expert IDs to summon. If omitted, the system will auto-select the best experts for the task.',
      ),
    required_experts: z
      .array(z.string().trim().min(1))
      .max(MAX_ULTRA_SWARM_SUBAGENTS)
      .optional()
      .describe(
        'Expert IDs that must be included even when auto_select is true. Useful when Ultrawork has already identified mandatory research, review, or verification roles.',
      ),
    max_experts: z
      .number()
      .int()
      .min(1)
      .max(MAX_ULTRA_SWARM_SUBAGENTS)
      .optional()
      .describe('Maximum experts to launch. Defaults to 24 and never exceeds 128.'),
    intensity: z
      .enum(['balanced', 'premium', 'max'])
      .optional()
      .describe(
        'Swarm staffing intensity. balanced keeps staffing conservative, premium uses the default enterprise team, max allows the largest team up to max_experts.',
      ),
    focus: z
      .enum(['plan', 'research', 'implement', 'review', 'full'])
      .optional()
      .describe(
        'Primary swarm focus. Ultrawork uses this to distinguish planning, research, implementation, review, or full lifecycle work.',
      ),
    auto_select: z
      .boolean()
      .optional()
      .describe(
        'When true (default), the system automatically selects experts based on the task description. Set to false to require explicit expert IDs.',
      ),
    subagent_type: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Base execution profile for spawned experts. Each expert still runs as its own expert subagent. Defaults to "coder" when omitted.',
      ),
    run_in_background: z
      .boolean()
      .optional()
      .describe(
        'If true, return immediately without waiting for completion. Prefer false unless the task can run independently.',
      ),
  })
  .strict();

export type UltraSwarmToolInput = z.infer<typeof UltraSwarmToolInputSchema>;

interface UltraSwarmSpec {
  readonly index: number;
  readonly expertId: string;
  readonly expertName: string;
  readonly division?: string;
  readonly assignmentPrompt: string;
  readonly phase: UltraSwarmPhase;
  readonly focus: UltraSwarmFocus;
  readonly dependsOn?: readonly string[];
  readonly emoji: string;
  readonly color: string;
  readonly coverageLane?: string;
  readonly selectionReason?: string;
  readonly runId: string;
  readonly requiredForCompletion: boolean;
  readonly workNodeIds: readonly string[];
}

interface UltraSwarmRunResult {
  readonly spec: UltraSwarmSpec;
  readonly agentId?: string;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly state?: 'started' | 'not_started';
  readonly result?: string;
  readonly error?: string;
}

interface UltraSwarmRenderedResult extends UltraSwarmRunResult {
  readonly verdict: 'PASS' | 'BLOCKED' | 'FAIL';
  readonly evidenceIds: readonly string[];
}

export class UltraSwarmTool implements BuiltinTool<UltraSwarmToolInput> {
  readonly name = 'UltraSwarm' as const;
  readonly description = ULTRA_SWARM_DESCRIPTION + `

 — Summon a team of expert agents to tackle complex tasks collaboratively.

This tool automatically assembles and orchestrates a swarm of specialized expert agents based on your task description. Each expert is selected from a catalog of 217+ professionals across 16 domains (Engineering, Design, Security, Product, Marketing, etc.) and given their specific persona to ensure high-quality, domain-specific output.

## How it works
1. Analyze your task description to identify required expertise domains
2. Search the expert catalog using BM25+fuzzy text search to find the best matches
3. Spawn each expert as a subagent with their full persona injected
4. Execute all experts in parallel (or sequential if dependencies exist)
5. Collect and synthesize results

## Usage tips
- Be specific in your description for better expert matching
- You can explicitly request experts by ID, or let the system auto-select
- Each expert receives their full persona + your task description
- Each call can launch up to 128 expert subagents; cap active concurrency with KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY when needed
- Results are tagged with expert name and emoji for easy identification

## Available divisions
Engineering, Design, Security, Product, Marketing, Testing, Academic, Finance, Game Development, GIS, Paid Media, Project Management, Sales, Spatial Computing, Specialized, Support`;

  readonly parameters: Record<string, unknown> = toInputJsonSchema(UltraSwarmToolInputSchema);

  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly swarmMode: SwarmMode,
    private readonly store: ToolStore,
    private readonly agent: Agent,
  ) {}

  resolveExecution(args: UltraSwarmToolInput): ToolExecution {
    const expertCount = args.experts?.length ?? 'auto';
    return {
      accesses: ToolAccesses.all(),
      description: `UltraSwarm: ${args.description}`,
      display: {
        kind: 'agent_call',
        agent_name: `UltraSwarm (${expertCount} experts)`,
        prompt: args.description,
      },
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: UltraSwarmToolInput,
    context: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      this.swarmMode.enter('tool');
      const result = await this.runUltraSwarm(args, context.signal, context.toolCallId);
      return { output: result };
    } catch (error) {
      return {
        output: error instanceof Error ? error.message : String(error),
        isError: true,
      };
    }
  }

  private async runUltraSwarm(
    args: UltraSwarmToolInput,
    signal: AbortSignal,
    toolCallId: string,
  ): Promise<string> {
    const profileBaseName = normalizeOptionalString(args.subagent_type) ?? 'coder';
    const autoSelect = args.auto_select !== false;
    const maxExperts = args.max_experts ?? defaultMaxExperts(args.intensity);
    const runId = normalizeOptionalString(args.run_id) ?? `ultra-swarm-${randomUUID()}`;
    const workNodeContext = this.resolveWorkNodeContext(args);
    const requestedExperts = uniqueStrings([
      ...(autoSelect ? [] : (args.experts ?? [])),
      ...(args.required_experts ?? []),
    ]);
    const requiredExpertIds = new Set(args.required_experts ?? []);
    if (requestedExperts.length > maxExperts) {
      throw new Error(
        `UltraSwarm max_experts is ${String(maxExperts)}, but ${String(requestedExperts.length)} explicit/required experts were requested.`,
      );
    }

    // Build the swarm plan
    const plan = await this.buildPlan(
      withWorkNodeSelectionHint(args.description, workNodeContext?.nodes ?? []),
      autoSelect,
      requestedExperts,
      maxExperts,
      args.intensity,
    );

    if (plan.experts.length === 0) {
      return 'No matching experts found for this task. Try being more specific in your description.';
    }

    if (plan.experts.length > MAX_ULTRA_SWARM_SUBAGENTS) {
      throw new Error(
        `UltraSwarm supports at most ${String(MAX_ULTRA_SWARM_SUBAGENTS)} experts. Requested: ${String(plan.experts.length)}`,
      );
    }

    // Build specs from plan
    const specs: UltraSwarmSpec[] = plan.experts.map((assignment, index) => {
      const phase = phaseForAssignment(assignment, args.focus);
      return {
        index: index + 1,
        expertId: assignment.expertId,
        expertName: assignment.expertName,
        division: assignment.division ?? assignment.divisionLabel,
        assignmentPrompt: assignment.prompt,
        phase,
        focus: focusForPhase(phase, args.focus),
        dependsOn: assignment.dependsOn,
        emoji: assignment.emoji,
        color: assignment.color,
        coverageLane: assignment.coverageLane,
        selectionReason: assignment.selectionReason,
        runId,
        requiredForCompletion:
          requiredExpertIds.has(assignment.expertId) ||
          phase === 'review' ||
          args.focus === 'review' ||
          args.focus === 'full',
        workNodeIds: workNodeContext?.nodes.map((node) => node.id) ?? [],
      };
    });

    this.emitTeamStaffed(runId, toolCallId, specs, args, maxExperts);

    if (workNodeContext !== undefined) {
      this.markWorkNodesRunning(
        workNodeContext.nodes.map((node) => node.id),
        ownerExpertIdForWorkNodes(specs),
      );
    }

    const phaseResults: UltraSwarmRunResult[] = [];
    let phaseHandoff = '';
    let blockedBy: UltraSwarmRenderedResult | undefined;
    try {
      for (const phase of ULTRA_SWARM_PHASES) {
        const phaseSpecs = specs.filter((spec) => spec.phase === phase);
        if (phaseSpecs.length === 0) continue;
        if (blockedBy !== undefined) {
          phaseResults.push(...blockedResultsForPhase(phaseSpecs, blockedBy));
          continue;
        }

        const tasks = phaseSpecs.map((spec): QueuedSubagentTask<UltraSwarmSpec> => ({
          kind: 'spawn',
          data: spec,
          profileName: spec.expertId,
          profileBaseName,
          parentToolCallId: toolCallId,
          prompt: this.buildExpertPrompt(
            spec,
            args.description,
            workNodeContext?.nodes ?? [],
            phaseHandoff,
          ),
          description: `${args.description} #${String(spec.index)} (${spec.expertName} ${spec.emoji})`,
          swarmIndex: spec.index,
          runInBackground: args.run_in_background === true,
          swarmItem: spec.workNodeIds.length === 1 ? spec.workNodeIds[0] : spec.expertId,
          signal,
          timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
        }));

        const results = await this.subagentHost.runQueued(tasks);
        const renderedPhaseResults = results
          .map(({ task, ...result }) => ({ spec: task.data, ...result }))
          .map(withRenderedMetadata);
        phaseResults.push(...renderedPhaseResults);
        phaseHandoff = buildPhaseHandoff(phaseResults.map(withRenderedMetadata));
        blockedBy = blockingRequiredResult(renderedPhaseResults, phase);
      }
    } catch (error) {
      if (workNodeContext !== undefined) {
        this.failWorkNodes(workNodeContext.nodes.map((node) => node.id), error);
      }
      throw error;
    }
    const rendered = phaseResults.map(withRenderedMetadata);
    if (workNodeContext !== undefined) {
      this.finishWorkNodes(workNodeContext.nodes.map((node) => node.id), rendered);
    }
    this.agent.ultraSwarmEngageGate?.clear('ultra-swarm-completed');
    return renderUltraSwarmResults(
      rendered,
      plan,
      runId,
    );
  }

  private resolveWorkNodeContext(
    args: UltraSwarmToolInput,
  ): { readonly graph: WorkGraph; readonly nodes: readonly WorkGraphNode[] } | undefined {
    const ids = uniqueStrings(args.work_node_ids ?? []);
    if (ids.length === 0) return undefined;
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined) {
      throw new Error('UltraSwarm work_node_ids requires an existing UltraworkGraph.');
    }
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const nodes = ids.map((id) => {
      const node = nodeById.get(id);
      if (node === undefined) throw new Error(`UltraSwarm work_node_ids includes missing node ${id}.`);
      return node;
    });
    return { graph: cloneWorkGraph(graph), nodes: nodes.map(cloneWorkGraphNode) };
  }

  private markWorkNodesRunning(nodeIds: readonly string[], ownerExpertId: string | undefined): void {
    this.updateWorkNodes(nodeIds, (node) => ({
      ...node,
      status: 'running',
      ownerExpertId: node.ownerExpertId ?? ownerExpertId,
    }));
  }

  private finishWorkNodes(
    nodeIds: readonly string[],
    results: readonly UltraSwarmRenderedResult[],
  ): void {
    const outcome = workNodeOutcome(results);
    const owner = ownerResultForWorkNodes(results);
    this.updateWorkNodes(nodeIds, (node) => ({
      ...node,
      ownerExpertId: node.ownerExpertId ?? owner?.spec.expertId,
      ownerAgentId: node.ownerAgentId ?? owner?.agentId,
      status: outcome.status,
      evidenceIds: uniqueStrings([...(node.evidenceIds ?? []), ...outcome.evidenceIds]),
      verificationStatus: outcome.verificationStatus,
      verificationSummary: outcome.summary,
    }));
  }

  private failWorkNodes(nodeIds: readonly string[], error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.updateWorkNodes(nodeIds, (node) => ({
      ...node,
      status: 'failed',
      verificationStatus: 'failed',
      verificationSummary: `UltraSwarm failed before returning node evidence: ${message}`,
    }));
  }

  private updateWorkNodes(
    nodeIds: readonly string[],
    update: (node: WorkGraphNode) => WorkGraphNode,
  ): void {
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined) return;
    const targetIds = new Set(nodeIds);
    const next = cloneWorkGraph({
      ...graph,
      updatedAt: new Date().toISOString(),
      nodes: graph.nodes.map((node) => (targetIds.has(node.id) ? update(cloneWorkGraphNode(node)) : node)),
    });
    this.store.set(ULTRAWORK_GRAPH_STORE_KEY, next);
    this.store.set(TODO_STORE_KEY, todosFromWorkGraph(next));
    for (const node of next.nodes) {
      if (!targetIds.has(node.id)) continue;
      this.agent.emitEvent({
        type: 'ultrawork.task.assigned',
        runId: next.runId,
        task: node,
      });
    }
  }

  private async buildPlan(
    description: string,
    autoSelect: boolean,
    requestedExperts: readonly string[],
    maxExperts: number,
    intensity: UltraSwarmToolInput['intensity'],
  ): Promise<ExpertSwarmPlan> {
    const base = await globalUltraSwarmOrchestrator.buildSwarmPlan(
      description,
      autoSelect ? undefined : requestedExperts,
      { intensity, maxExperts },
    );
    if (autoSelect && requestedExperts.length > 0) {
      const required = await globalUltraSwarmOrchestrator.buildSwarmPlan(
        description,
        requestedExperts,
        { intensity, maxExperts },
      );
      return capPlan(mergePlans(required, base), maxExperts);
    }
    return capPlan(base, maxExperts);
  }

  private buildExpertPrompt(
    spec: UltraSwarmSpec,
    taskDescription: string,
    workNodes: readonly WorkGraphNode[],
    phaseHandoff: string,
  ): string {
    const briefing = `<expert_briefing name="${spec.expertName}" emoji="${spec.emoji}" color="${spec.color}" phase="${spec.phase}">
${spec.assignmentPrompt}
</expert_briefing>`;
    const task = `<task>
${taskDescription}
</task>`;
    const laneLine = spec.coverageLane === undefined ? '' : `\nCoverage lane: ${spec.coverageLane}.`;
    const reasonLine = spec.selectionReason === undefined
      ? ''
      : `\nSelection reason: ${spec.selectionReason}`;
    const focusLine = `\nFocus lane: ${spec.focus}.`;
    const phaseLine = `\nUltraSwarm phase: ${spec.phase}.`;
    const handoffLine = phaseHandoff.length === 0
      ? ''
      : `\n\n<previous_phase_handoff>\n${phaseHandoff}\n</previous_phase_handoff>`;
    const reviewLine =
      spec.phase === 'review' || spec.focus === 'review' || spec.focus === 'full'
        ? '\nReview gate: start your final answer with one of "VERDICT: PASS", "VERDICT: BLOCKED", or "VERDICT: FAIL". Return PASS only when evidence is sufficient; otherwise return concrete fixes and the evidence still missing.'
        : '';
    const workNodeLine = workNodes.length === 0 ? '' : `\n\n${formatWorkNodeContract(workNodes)}`;
    return appendSwarmResearchAutonomy(
      `${briefing}\n\n${task}${laneLine}${reasonLine}${focusLine}${phaseLine}${reviewLine}${workNodeLine}${handoffLine}\n\nApply your ${spec.expertName} expertise to this task. Provide a thorough, high-quality response that leverages your specialized knowledge and skills. Subagents must not directly integrate final product-file edits; return a compact handoff for the parent agent to integrate.`,
    );
  }

  private emitTeamStaffed(
    runId: string,
    toolCallId: string,
    specs: readonly UltraSwarmSpec[],
    args: UltraSwarmToolInput,
    maxExperts: number,
  ): void {
    const team: TeamPlan = {
      id: `team-${runId}`,
      runId,
      intensity: args.intensity ?? 'balanced',
      maxExperts,
      requiredExperts: args.required_experts,
      councilExpertIds: specs
        .filter((spec) => spec.phase === 'review')
        .map((spec) => spec.expertId),
      reason: 'UltraSwarm staffed a phased specialist team.',
      experts: specs.map((spec) => ({
        id: spec.expertId,
        name: spec.expertName,
        role: spec.coverageLane ?? spec.division ?? 'specialist',
        focus: spec.focus,
        status: 'queued',
        taskIds: spec.workNodeIds.length > 0 ? spec.workNodeIds : undefined,
        division: spec.division,
        emoji: spec.emoji,
        color: spec.color,
        coverageLane: spec.coverageLane,
        selectionReason: spec.selectionReason,
        dependsOn: spec.dependsOn,
      })),
    };
    this.agent.emitEvent({
      type: 'ultrawork.team.staffed',
      runId,
      toolCallId,
      team,
    });
  }
}

function withWorkNodeSelectionHint(
  description: string,
  workNodes: readonly WorkGraphNode[],
): string {
  if (workNodes.length === 0) return description;
  const nodeLines = workNodes.map((node) => {
    const lane = node.laneId === undefined ? '' : ` lane=${node.laneId}`;
    const ac = node.acceptanceCriterionId === undefined ? '' : ` ac=${node.acceptanceCriterionId}`;
    return `- ${node.id}${ac}${lane}: ${node.title}`;
  });
  return `${description}\n\nUltrawork WorkGraph nodes:\n${nodeLines.join('\n')}`;
}

function formatWorkNodeContract(workNodes: readonly WorkGraphNode[]): string {
  const lines = [
    '<work_node_contracts>',
    'You are assigned these UltraworkGraph nodes. Treat the parent UltraGoal and Seed as fixed; do not renegotiate global scope. You may run a local mini-interview only to resolve unknowns inside these assigned nodes. Final answer must start with VERDICT: PASS, VERDICT: BLOCKED, or VERDICT: FAIL and include evidence_ids: ... when evidence exists.',
  ];
  for (const node of workNodes) {
    const fields = [
      `id="${escapeXml(node.id)}"`,
      `status="${escapeXml(node.status)}"`,
      node.kind === undefined ? '' : `kind="${escapeXml(node.kind)}"`,
      node.acceptanceCriterionId === undefined
        ? ''
        : `acceptance_criterion_id="${escapeXml(node.acceptanceCriterionId)}"`,
      node.laneId === undefined ? '' : `lane_id="${escapeXml(node.laneId)}"`,
    ].filter((field) => field.length > 0);
    const requiredEvidence =
      node.requiredEvidence === undefined || node.requiredEvidence.length === 0
        ? ''
        : `\n  Required evidence: ${node.requiredEvidence.join(', ')}`;
    const dependencies =
      node.dependsOn === undefined || node.dependsOn.length === 0
        ? ''
        : `\n  Depends on: ${node.dependsOn.join(', ')}`;
    lines.push(
      `<node ${fields.join(' ')}>\n  Title: ${node.title}${dependencies}${requiredEvidence}\n</node>`,
    );
  }
  lines.push('</work_node_contracts>');
  return lines.join('\n');
}

function cloneWorkGraphNode(node: WorkGraphNode): WorkGraphNode {
  return {
    id: node.id,
    title: node.title,
    kind: node.kind,
    stage: node.stage,
    parentId: node.parentId,
    acceptanceCriterionId: node.acceptanceCriterionId,
    laneId: node.laneId,
    ownerExpertId: node.ownerExpertId,
    ownerAgentId: node.ownerAgentId,
    status: node.status,
    dependsOn: cloneStringList(node.dependsOn),
    evidenceIds: cloneStringList(node.evidenceIds),
    requiredEvidence: cloneStringList(node.requiredEvidence),
    verificationStatus: node.verificationStatus,
    verificationSummary: node.verificationSummary,
  };
}

function cloneStringList(values: readonly string[] | undefined): readonly string[] | undefined {
  return values === undefined ? undefined : [...values];
}

function phaseForAssignment(
  assignment: ExpertAssignment,
  focus: UltraSwarmToolInput['focus'],
): UltraSwarmPhase {
  if (focus === 'plan' || focus === 'research') return 'plan';
  if (focus === 'review') return 'review';
  const lane = assignment.coverageLane;
  if (lane === 'product_requirements' || lane === 'domain_subject_matter') return 'plan';
  if (
    lane === 'testing_evidence' ||
    lane === 'security_privacy' ||
    lane === 'performance_reliability'
  ) {
    return 'review';
  }
  return 'implement';
}

function focusForPhase(
  phase: UltraSwarmPhase,
  requestedFocus: UltraSwarmToolInput['focus'],
): UltraSwarmFocus {
  if (requestedFocus === 'full') return 'full';
  if (requestedFocus === 'research') return phase === 'plan' ? 'research' : phase;
  if (requestedFocus === 'review') return 'review';
  if (requestedFocus === 'plan') return 'plan';
  return phase;
}

function ownerExpertIdForWorkNodes(specs: readonly UltraSwarmSpec[]): string | undefined {
  return (
    specs.find((spec) => spec.phase === 'implement') ??
    specs.find((spec) => spec.phase === 'plan') ??
    specs[0]
  )?.expertId;
}

function blockingRequiredResult(
  results: readonly UltraSwarmRenderedResult[],
  phase: UltraSwarmPhase,
): UltraSwarmRenderedResult | undefined {
  if (phase !== 'plan' && phase !== 'review') return undefined;
  return results.find((result) =>
    result.spec.requiredForCompletion &&
    (result.status !== 'completed' || result.verdict !== 'PASS')
  );
}

function blockedResultsForPhase(
  specs: readonly UltraSwarmSpec[],
  blockedBy: UltraSwarmRenderedResult,
): UltraSwarmRunResult[] {
  const message =
    `Skipped because required ${blockedBy.spec.phase} expert ${blockedBy.spec.expertId} returned ${blockedBy.verdict}.`;
  return specs.map((spec) => ({
    spec,
    status: 'aborted' as const,
    state: 'not_started' as const,
    error: message,
  }));
}

function buildPhaseHandoff(results: readonly UltraSwarmRenderedResult[]): string {
  const lines = ['<phase_handoff_pack>'];
  for (const result of results.slice(-12)) {
    const text = collapseForHandoff(result.result ?? result.error ?? '');
    const evidence = result.evidenceIds.length === 0
      ? ''
      : ` evidence_ids="${escapeXml(result.evidenceIds.join(','))}"`;
    lines.push(
      `<handoff expert_id="${escapeXml(result.spec.expertId)}" phase="${result.spec.phase}" verdict="${result.verdict}"${evidence}>${escapeXml(text)}</handoff>`,
    );
  }
  lines.push('</phase_handoff_pack>');
  return lines.join('\n');
}

function collapseForHandoff(text: string): string {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim();
  return collapsed.length > 900 ? `${collapsed.slice(0, 897)}...` : collapsed;
}

function workNodeOutcome(results: readonly UltraSwarmRenderedResult[]): {
  readonly status: WorkGraphNode['status'];
  readonly verificationStatus: NonNullable<WorkGraphNode['verificationStatus']>;
  readonly evidenceIds: readonly string[];
  readonly summary: string;
} {
  const evidenceIds = uniqueStrings(results.flatMap((result) => result.evidenceIds));
  const failed = results.some((result) => result.status === 'failed' || result.verdict === 'FAIL');
  const blocked = results.some(
    (result) => result.status === 'aborted' || result.verdict === 'BLOCKED',
  );
  const status: WorkGraphNode['status'] = failed ? 'failed' : blocked ? 'blocked' : 'done';
  const verificationStatus: NonNullable<WorkGraphNode['verificationStatus']> =
    status === 'done' ? 'passed' : status === 'failed' ? 'failed' : 'blocked';
  const summary = `UltraSwarm completed ${String(results.length)} expert result(s): ${results
    .map((result) => `${result.spec.expertId}=${result.verdict}`)
    .join(', ')}`;
  return { status, verificationStatus, evidenceIds, summary };
}

function ownerResultForWorkNodes(
  results: readonly UltraSwarmRenderedResult[],
): UltraSwarmRenderedResult | undefined {
  return (
    results.find((result) => result.spec.phase === 'implement' && result.status === 'completed') ??
    results.find((result) => result.spec.phase === 'plan' && result.status === 'completed') ??
    results.find((result) => result.status === 'completed') ??
    results[0]
  );
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultMaxExperts(intensity: UltraSwarmToolInput['intensity']): number {
  if (intensity === 'max') return MAX_ULTRA_SWARM_SUBAGENTS;
  return 24;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function mergePlans(primary: ExpertSwarmPlan, secondary: ExpertSwarmPlan): ExpertSwarmPlan {
  const seen = new Set<string>();
  const experts: ExpertAssignment[] = [];
  for (const assignment of [...primary.experts, ...secondary.experts]) {
    if (seen.has(assignment.expertId)) continue;
    seen.add(assignment.expertId);
    experts.push(assignment);
  }
  return {
    taskDescription: secondary.taskDescription,
    strategy: experts.length > 3 ? 'mixed' : experts.length > 1 ? 'parallel' : 'sequential',
    experts,
  };
}

function capPlan(plan: ExpertSwarmPlan, maxExperts: number): ExpertSwarmPlan {
  if (plan.experts.length <= maxExperts) return plan;
  return {
    ...plan,
    experts: plan.experts.slice(0, maxExperts),
    strategy: maxExperts > 3 ? 'mixed' : maxExperts > 1 ? 'parallel' : 'sequential',
  };
}

function renderUltraSwarmResults(
  rendered: readonly UltraSwarmRenderedResult[],
  plan: { readonly taskDescription: string; readonly strategy: string },
  runId: string,
): string {
  const completed = rendered.filter((r) => r.status === 'completed').length;
  const failed = rendered.filter((r) => r.status === 'failed').length;
  const aborted = rendered.filter((r) => r.status === 'aborted').length;

  const lines = [
    `<ultra_swarm_result run_id="${escapeXml(runId)}">`,
    `<task>${escapeXml(plan.taskDescription)}</task>`,
    `<strategy>${plan.strategy}</strategy>`,
    `<summary>completed: ${String(completed)}, failed: ${String(failed)}, aborted: ${String(aborted)}</summary>`,
    '<coverage>Each expert row includes the assigned coverage lane and selection reason for auditability.</coverage>',
  ];

  for (const result of rendered) {
    const agentId = result.agentId === undefined ? '' : ` agent_id="${result.agentId}"`;
    const state = result.state === undefined ? '' : ` state="${result.state}"`;
    const lane = result.spec.coverageLane === undefined
      ? ''
      : ` coverage_lane="${escapeXml(result.spec.coverageLane)}"`;
    const division = result.spec.division === undefined
      ? ''
      : ` division="${escapeXml(result.spec.division)}"`;
    const dependsOn = result.spec.dependsOn === undefined || result.spec.dependsOn.length === 0
      ? ''
      : ` depends_on="${escapeXml(result.spec.dependsOn.join(','))}"`;
    const evidenceIds = result.evidenceIds.length === 0
      ? ''
      : ` evidence_ids="${escapeXml(result.evidenceIds.join(','))}"`;
    const workNodeIds = result.spec.workNodeIds.length === 0
      ? ''
      : ` work_node_ids="${escapeXml(result.spec.workNodeIds.join(','))}"`;
    const body =
      result.status === 'completed'
        ? (result.result ?? '')
        : (result.error ?? 'unknown error');
    const selectionReason = result.spec.selectionReason === undefined
      ? ''
      : `<selection_reason>${escapeXml(result.spec.selectionReason)}</selection_reason>\n`;
    lines.push(
      `<expert expert_id="${escapeXml(result.spec.expertId)}" name="${escapeXml(result.spec.expertName)}" emoji="${escapeXml(result.spec.emoji)}" color="${escapeXml(result.spec.color)}" phase="${result.spec.phase}" focus="${result.spec.focus}" outcome="${result.status}" verdict="${result.verdict}" required_for_completion="${String(result.spec.requiredForCompletion)}"${agentId}${state}${division}${lane}${dependsOn}${workNodeIds}${evidenceIds}>\n${selectionReason}${body}\n</expert>`,
    );
  }

  lines.push('<integration_handoff>Parent agent must integrate the accepted specialist handoffs into product-file changes and verification evidence.</integration_handoff>');
  lines.push('</ultra_swarm_result>');
  return lines.join('\n');
}

function withRenderedMetadata(result: UltraSwarmRunResult): UltraSwarmRenderedResult {
  const text = result.status === 'completed' ? (result.result ?? '') : (result.error ?? '');
  return {
    ...result,
    verdict: inferVerdict(result.status, text),
    evidenceIds: extractEvidenceIds(text),
  };
}

function inferVerdict(
  status: UltraSwarmRunResult['status'],
  text: string,
): UltraSwarmRenderedResult['verdict'] {
  if (status === 'failed') return 'FAIL';
  if (status === 'aborted') return 'BLOCKED';
  const verdictMatch = /\bVERDICT:\s*(PASS|BLOCKED|FAIL)\b/i.exec(text);
  if (verdictMatch?.[1] !== undefined) {
    return verdictMatch[1].toUpperCase() as UltraSwarmRenderedResult['verdict'];
  }
  if (/\bBLOCKED\b/i.test(text)) return 'BLOCKED';
  if (/\bFAIL(?:ED)?\b/i.test(text)) return 'FAIL';
  return 'PASS';
}

function extractEvidenceIds(text: string): readonly string[] {
  const ids = new Set<string>();
  const pattern = /\bevidence(?:[_ -]?ids?)?\s*[:=]\s*([A-Za-z0-9_.:-]+(?:[ ,]+[A-Za-z0-9_.:-]+)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    for (const rawId of match[1]?.split(/[,\s]+/) ?? []) {
      const id = rawId.trim();
      if (id.length > 0) ids.add(id);
    }
  }
  return [...ids];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

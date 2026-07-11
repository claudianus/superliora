import { randomUUID } from 'node:crypto';

import type { TeamPlan, WorkGraph, WorkGraphNode } from '@superliora/protocol';
import { z } from 'zod';

import type { Agent } from '../../../agent';
import type { SwarmMode } from '../../../agent/swarm';
import type { BuiltinTool } from '../../../agent/tool';
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type QueuedSubagentTask,
  type SessionSubagentHost,
} from '../../../session/subagent-host';
import {
  assignReviewCriticEdges,
  assignDiverseCriticEdges,
  buildCriticAssignmentXml,
  CRITIC_LENSES,
  type CriticAssignment,
  type CriticLens,
} from '../../../session/ultra-swarm-critic';
import {
  consensusFromDiverseVotes,
  extractLensVotes,
  type CouncilDecision,
} from '../../../session/ultra-swarm-consensus';
import type { SwarmRoutingIntensity } from '../../../agent/plan/ultra-swarm-routing';
import {
  buildRestaffReflectionPrompt,
  collectRestaffGaps,
  filterRestaffPlan,
  needsRestaffing,
  restaffPhaseForGaps,
  restaffSlotsAvailable,
} from '../../../session/ultra-swarm-restaff';
import {
  consumeUltraSwarmSteerRequests,
  createUltraSwarmRunContext,
} from '../../../agent/ultra-swarm-run';
import {
  injectUltraworkPostSwarmContinuation,
  maybeAdvanceUltraworkStage,
  maybeFinishUltraworkRun,
} from '../../../ultrawork';
import {
  buildSwarmChannelRulesXml,
  buildSwarmCollaborationRequiredXml,
  buildTeamRosterXml,
  emitCouncilDecisionFromReview,
  postOrchestratorStandup,
  postWaveStandup,
  type SwarmStandupTimerHandle,
} from '../../../session/swarm-bus-coordination';
import {
  buildDependencyWaves,
} from '../../../session/subagent-wave-scheduler';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import ULTRA_SWARM_DESCRIPTION from './ultra-swarm.md?raw';
import { toInputJsonSchema } from '../../support/input-schema';
import { globalUltraSwarmOrchestrator } from '../../../expert-agents/orchestrator';
import type { ExpertAssignment, ExpertSwarmPlan } from '../../../expert-agents/types';
import { compactSwarmToolResult } from '../../../agent/compaction/boundary-compaction';
import { SWARM_HANDOFF_COMPACTION_RATIO } from '../../../agent/compaction/strategy';
import { buildUltraSwarmIntegrationReportXml } from './ultra-swarm-integration-report';
import { collapseForHandoff } from '../../../agent/compaction/handoff-collapse';
import { appendSwarmResearchAutonomy } from './swarm-research-autonomy';
import { buildExpertSwarmExecutionFooter } from '../../../expert-agents/expert-persona';
import type { ToolStore } from '../../store';
import { TODO_STORE_KEY } from '../state/todo-list';
import {
  ULTRAWORK_GRAPH_STORE_KEY,
  cloneWorkGraph,
  todosFromWorkGraph,
} from '../state/ultrawork-graph';
import {
  clearSwarmRunBus,
  extendSwarmBusAllowlist,
  initSwarmRunBus,
  renderSwarmBusDigest,
} from '../state/swarm-bus';

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
        'Ignored. UltraSwarm always runs experts in the foreground swarm panel so orchestration, handoffs, and progress stay unified. Use the Agent tool for detached background work.',
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
  readonly criticAssignment?: CriticAssignment;
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
  readonly verdict: 'PASS' | 'BLOCKED' | 'FAIL' | 'ABORTED' | 'SKIPPED';
  readonly evidenceIds: readonly string[];
}

export class UltraSwarmTool implements BuiltinTool<UltraSwarmToolInput> {
  readonly name = 'UltraSwarm' as const;
  readonly description = ULTRA_SWARM_DESCRIPTION;

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
    const engageGate = this.agent.ultraSwarmEngageGate;
    const routing = typeof engageGate?.data === 'function' ? engageGate.data()?.routing : undefined;
    const maxExperts = resolveMaxExperts(args.intensity, routing, args.max_experts);
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

    await this.agent.fullCompaction.ensureBelowHandoffThreshold(signal, SWARM_HANDOFF_COMPACTION_RATIO);

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

    let team = buildTeamPlan(runId, specs, args, maxExperts);
    this.emitTeamStaffedEvent(runId, toolCallId, team);

    const busEnabled = true;
    let standupTimer: SwarmStandupTimerHandle | undefined;
    initSwarmRunBus(this.store, { runId, parentToolCallId: toolCallId, team });
    this.agent.ultraSwarmRun = createUltraSwarmRunContext({
      runId,
      parentToolCallId: toolCallId,
      team,
      busEnabled: true,
    });
    standupTimer = this.subagentHost.startSwarmStandupTimer(this.agent, this.store, {
      parentAgentId: this.subagentHost.parentAgentId,
      runId,
      parentToolCallId: toolCallId,
    });

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

        if (busEnabled) {
          postOrchestratorStandup(
            this.agent,
            {
              parentAgentId: this.subagentHost.parentAgentId,
              runId,
              parentToolCallId: toolCallId,
              phase,
              expertCount: phaseSpecs.length,
            },
            this.store,
          );
        }

        let phaseSpecsForRun = phaseSpecs;
        if (phase === 'review') {
          phaseSpecsForRun = attachCriticAssignments(
            phaseSpecs,
            phaseResults.map(withRenderedMetadata),
            routing?.intensity,
          );
        }

        let renderedPhaseResults = await this.runPhaseExperts({
          phaseSpecs: phaseSpecsForRun,
          phase,
          phaseHandoff,
          team,
          busEnabled,
          args,
          workNodeContext,
          profileBaseName,
          toolCallId,
          runId,
          signal,
        });

        if (phase === 'review') {
          renderedPhaseResults = await this.retryFailedReviewExperts({
            renderedPhaseResults,
            phaseHandoff,
            team,
            busEnabled,
            args,
            workNodeContext,
            profileBaseName,
            toolCallId,
            runId,
            signal,
          });
        }

        phaseResults.push(...renderedPhaseResults);
        phaseHandoff = buildPhaseHandoff(
          renderedPhaseResults.map(withRenderedMetadata),
          busEnabled ? renderSwarmBusDigest(this.store) : '',
        );
        blockedBy = blockingRequiredResult(renderedPhaseResults, phase);

        // Pause-Redirect-Resume checkpoint: if the user steered mid-run, stop
        // launching further phases after this phase finishes. Completed work is kept.
        const steerTexts = consumeUltraSwarmSteerRequests(this.agent.ultraSwarmRun);
        if (steerTexts.length > 0) {
          const steerNote = steerTexts.join('\n\n');
          phaseHandoff = `${phaseHandoff}\n\n<user_steering>\n${steerNote}\n</user_steering>`;
          // Mark remaining unstarted phases as skipped by setting blockedBy-like marker.
          // We break the phase loop early; restaff is also skipped below when paused.
          if (this.agent.ultraSwarmRun !== undefined) {
            this.agent.ultraSwarmRun.pausedForSteer = true;
          }
          this.agent.emitEvent({
            type: 'ultrawork.swarm.paused',
            runId,
            reason: 'User steering applied at phase checkpoint',
            input: steerNote,
            phase,
          } as any);
          break;
        }
      }

      // Cost control: skip adaptive restaff when review consensus is already solid.
      // strong-approve always skips; plain approve skips only for light intensity.
      const preRestaffDecision = councilDecisionFromReview(
        phaseResults.map(withRenderedMetadata),
      );
      const skipRestaff =
        this.agent.ultraSwarmRun?.pausedForSteer === true
        || preRestaffDecision === 'strong-approve'
        || (preRestaffDecision === 'approve' && routing?.intensity === 'light');
      const restaffed = skipRestaff
        ? []
        : await this.maybeRestaffForRevision({
            rendered: phaseResults.map(withRenderedMetadata),
            specs,
            team,
            busEnabled,
            args,
            workNodeContext,
            profileBaseName,
            toolCallId,
            runId,
            signal,
            maxExperts,
            requiredExpertIds,
            onTeamUpdated: (nextTeam) => {
              team = nextTeam;
            },
          });
      phaseResults.push(...restaffed);
    } catch (error) {
      if (workNodeContext !== undefined) {
        this.failWorkNodes(workNodeContext.nodes.map((node) => node.id), error);
      }
      throw error;
    } finally {
      if (busEnabled) {
        standupTimer?.stop();
        clearSwarmRunBus(this.store);
        this.agent.ultraSwarmRun = undefined;
      }
    }
    const rendered = phaseResults.map(withRenderedMetadata);
    if (busEnabled) {
      const reviewResults = rendered.filter((result) => result.spec.phase === 'review');
      const decision = councilDecisionFromReview(rendered);
      // Protocol CouncilDecision does not yet carry strong-approve; collapse for emission.
      const emitDecision =
        decision === 'strong-approve' ? 'approve' : decision;
      emitCouncilDecisionFromReview(this.agent, {
        runId,
        councilExpertIds: team.councilExpertIds ?? [],
        verdictSummary: reviewResults
          .map((result) => `${result.spec.expertId}=${result.verdict}`)
          .join(', '),
        decision: emitDecision,
      });
    }
    if (workNodeContext !== undefined) {
      this.finishWorkNodes(workNodeContext.nodes.map((node) => node.id), rendered);
    }
    this.agent.ultraSwarmEngageGate?.clear('ultra-swarm-completed');
    maybeAdvanceUltraworkStage(this.agent, 'integrate', 'UltraSwarm completed');
    injectUltraworkPostSwarmContinuation(this.agent);
    const steerSuffix = this.agent.ultraSwarmRun?.pausedForSteer === true
      ? '\n\n<user_steering_applied>UltraSwarm paused after user steering. Incorporate the steering note in the phase handoff and continue from the remaining work.</user_steering_applied>'
      : '';
    const rawResult = renderUltraSwarmResults(rendered, plan, runId) + steerSuffix;
    const compacted = compactSwarmToolResult(this.store, rawResult, { runId });
    if (compacted.archiveIds.length > 0) {
      this.agent.telemetry.track('boundary_compaction_applied', {
        archive_count: compacted.archiveIds.length,
        run_id: runId,
        fallback: compacted.fallback,
        swarm_archive_ids: compacted.archiveIds.join(','),
      });
    }
    return compacted.output;
  }

  private resolveWorkNodeContext(
    args: UltraSwarmToolInput,
  ): { readonly graph: WorkGraph; readonly nodes: readonly WorkGraphNode[] } | undefined {
    const ids = uniqueStrings(args.work_node_ids ?? []);
    if (ids.length === 0) return undefined;
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined) {
      throw new Error(
        'UltraSwarm work_node_ids requires an existing UltraworkGraph. Approved Ultra Plans seed the graph on ExitPlanMode; otherwise call UltraworkGraph first or omit work_node_ids.',
      );
    }
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const nodes = ids.map((id) => {
      const node = nodeById.get(id);
      if (node === undefined) {
        const knownIds = graph.nodes.map((entry) => entry.id).join(', ');
        throw new Error(
          `UltraSwarm work_node_ids includes missing node ${id}. Known node ids: ${knownIds.length === 0 ? 'none' : knownIds}.`,
        );
      }
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
    // Sync the updated graph into the run so its workGraph reflects the new
    // node statuses, then check whether the run (and its UltraGoal) should
    // finish. Without this, swarm-completed nodes never trigger the
    // run/goal termination path — the UltraworkGraph tool does this sync,
    // but updateWorkNodes is the path UltraSwarm uses, and it was missing.
    this.agent.ultrawork.syncWorkGraphFromStore();
    maybeFinishUltraworkRun(this.agent);
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

  private async runPhaseExperts(input: {
    readonly phaseSpecs: readonly UltraSwarmSpec[];
    readonly phase: UltraSwarmPhase;
    readonly phaseHandoff: string;
    readonly team: TeamPlan;
    readonly busEnabled: boolean;
    readonly args: UltraSwarmToolInput;
    readonly workNodeContext: { readonly nodes: readonly WorkGraphNode[] } | undefined;
    readonly profileBaseName: string | undefined;
    readonly toolCallId: string;
    readonly runId: string;
    readonly signal: AbortSignal;
  }): Promise<readonly UltraSwarmRenderedResult[]> {
    const waves = buildDependencyWaves(input.phaseSpecs);
    const phaseResults: UltraSwarmRunResult[] = [];
    let dependencyHandoff = '';
    let waveIndex = 0;

    for (const wave of waves) {
      waveIndex += 1;
      const tasks = wave.map((spec): QueuedSubagentTask<UltraSwarmSpec> => ({
        kind: 'spawn',
        data: spec,
        profileName: spec.expertId,
        profileBaseName: input.profileBaseName,
        parentToolCallId: input.toolCallId,
        prompt: this.buildExpertPrompt(
          spec,
          input.args.description,
          input.workNodeContext?.nodes ?? [],
          input.phaseHandoff,
          input.team,
          input.busEnabled,
          dependencyHandoff,
          input.phase,
          this.store,
        ),
        description: `${input.args.description} #${String(spec.index)} (${spec.expertName} ${spec.emoji})`,
        swarmIndex: spec.index,
        runInBackground: false,
        swarmItem: spec.workNodeIds.length === 1 ? spec.workNodeIds[0] : spec.expertId,
        signal: input.signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      }));

      const results = await this.subagentHost.runQueued(tasks);
      const renderedWaveResults = results
        .map(({ task, ...result }) => ({ spec: task.data, ...result }))
        .map(withRenderedMetadata);
      phaseResults.push(...renderedWaveResults);
      dependencyHandoff = buildIntraPhaseDependencyHandoff(renderedWaveResults);

      if (input.busEnabled && input.phase === 'implement') {
        postWaveStandup(
          this.agent,
          {
            parentAgentId: this.subagentHost.parentAgentId,
            runId: input.runId,
            parentToolCallId: input.toolCallId,
            phase: input.phase,
            waveIndex,
            waveCount: waves.length,
            expertCount: renderedWaveResults.length,
          },
          this.store,
        );
      }
    }

    return phaseResults.map(withRenderedMetadata);
  }

  private async retryFailedReviewExperts(input: {
    readonly renderedPhaseResults: readonly UltraSwarmRenderedResult[];
    readonly phaseHandoff: string;
    readonly team: TeamPlan;
    readonly busEnabled: boolean;
    readonly args: UltraSwarmToolInput;
    readonly workNodeContext: { readonly nodes: readonly WorkGraphNode[] } | undefined;
    readonly profileBaseName: string | undefined;
    readonly toolCallId: string;
    readonly runId: string;
    readonly signal: AbortSignal;
  }): Promise<readonly UltraSwarmRenderedResult[]> {
    const retrySpecs = input.renderedPhaseResults
      .filter((result) => needsReviewRetry(result))
      .map((result) => result.spec);
    if (retrySpecs.length === 0) {
      return input.renderedPhaseResults;
    }

    if (input.busEnabled) {
      postOrchestratorStandup(
        this.agent,
        {
          parentAgentId: this.subagentHost.parentAgentId,
          runId: input.runId,
          parentToolCallId: input.toolCallId,
          phase: 'review-revision',
          expertCount: retrySpecs.length,
        },
        this.store,
      );
    }

    const retryHandoff = buildReviewRetryHandoff(
      input.renderedPhaseResults.filter((result) => needsReviewRetry(result)),
    );
    const retryResults = await this.runPhaseExperts({
      phaseSpecs: retrySpecs,
      phase: 'review',
      phaseHandoff: `${input.phaseHandoff}\n\n${retryHandoff}`,
      team: input.team,
      busEnabled: input.busEnabled,
      args: input.args,
      workNodeContext: input.workNodeContext,
      profileBaseName: input.profileBaseName,
      toolCallId: input.toolCallId,
      runId: input.runId,
      signal: input.signal,
    });

    return mergeReviewResults(input.renderedPhaseResults, retryResults);
  }

  private async maybeRestaffForRevision(input: {
    readonly rendered: readonly UltraSwarmRenderedResult[];
    readonly specs: readonly UltraSwarmSpec[];
    readonly team: TeamPlan;
    readonly busEnabled: boolean;
    readonly args: UltraSwarmToolInput;
    readonly workNodeContext: { readonly nodes: readonly WorkGraphNode[] } | undefined;
    readonly profileBaseName: string | undefined;
    readonly toolCallId: string;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly maxExperts: number;
    readonly requiredExpertIds: ReadonlySet<string>;
    readonly onTeamUpdated: (team: TeamPlan) => void;
  }): Promise<readonly UltraSwarmRunResult[]> {
    const gaps = collectRestaffGaps(input.rendered);
    const slots = restaffSlotsAvailable(input.specs.length, input.maxExperts);
    if (!needsRestaffing(gaps, input.specs.length, input.maxExperts) || slots === 0) {
      return [];
    }

    const reflection = buildRestaffReflectionPrompt(
      input.args.description,
      gaps,
      input.busEnabled ? renderSwarmBusDigest(this.store) : undefined,
    );
    const restaffPlan = filterRestaffPlan(
      await globalUltraSwarmOrchestrator.buildSwarmPlan(reflection, undefined, {
        intensity: input.args.intensity,
        maxExperts: slots,
      }),
      input.specs.map((spec) => spec.expertId),
      slots,
    );
    if (restaffPlan.experts.length === 0) return [];

    if (input.busEnabled) {
      postOrchestratorStandup(
        this.agent,
        {
          parentAgentId: this.subagentHost.parentAgentId,
          runId: input.runId,
          parentToolCallId: input.toolCallId,
          phase: 'restaff',
          expertCount: restaffPlan.experts.length,
        },
        this.store,
      );
      extendSwarmBusAllowlist(this.store, restaffPlan.experts.map((assignment) => assignment.expertId));
    }

    const phase = restaffPhaseForGaps(gaps);
    const startIndex = input.specs.length;
    const restaffSpecs: UltraSwarmSpec[] = restaffPlan.experts.map((assignment, offset) => ({
      index: startIndex + offset + 1,
      expertId: assignment.expertId,
      expertName: assignment.expertName,
      division: assignment.division ?? assignment.divisionLabel,
      assignmentPrompt: assignment.prompt,
      phase,
      focus: focusForPhase(phase, input.args.focus),
      dependsOn: assignment.dependsOn,
      emoji: assignment.emoji,
      color: assignment.color,
      coverageLane: assignment.coverageLane,
      selectionReason: assignment.selectionReason ?? 'Restaffed after revision gaps.',
      runId: input.runId,
      requiredForCompletion: true,
      workNodeIds: input.workNodeContext?.nodes.map((node) => node.id) ?? [],
    }));

    const nextTeam = augmentTeamPlan(input.team, restaffSpecs, input.args, input.maxExperts);
    input.onTeamUpdated(nextTeam);
    this.emitTeamStaffedEvent(input.runId, input.toolCallId, nextTeam);
    if (this.agent.ultraSwarmRun !== undefined) {
      this.agent.ultraSwarmRun = {
        ...this.agent.ultraSwarmRun,
        team: nextTeam,
      };
    }

    const phaseHandoff = buildPhaseHandoff(
      input.rendered,
      input.busEnabled ? renderSwarmBusDigest(this.store) : '',
    );
    const restaffRouting = typeof this.agent.ultraSwarmEngageGate?.data === 'function'
      ? this.agent.ultraSwarmEngageGate.data()?.routing
      : undefined;
    const phaseSpecs =
      phase === 'review'
        ? attachCriticAssignments(restaffSpecs, input.rendered, restaffRouting?.intensity)
        : restaffSpecs;

    const results = await this.runPhaseExperts({
      phaseSpecs,
      phase,
      phaseHandoff,
      team: nextTeam,
      busEnabled: input.busEnabled,
      args: input.args,
      workNodeContext: input.workNodeContext,
      profileBaseName: input.profileBaseName,
      toolCallId: input.toolCallId,
      runId: input.runId,
      signal: input.signal,
    });

    return results;
  }

  private buildExpertPrompt(
    spec: UltraSwarmSpec,
    taskDescription: string,
    workNodes: readonly WorkGraphNode[],
    phaseHandoff: string,
    team: TeamPlan,
    busEnabled: boolean,
    dependencyHandoff = '',
    phase: UltraSwarmPhase = spec.phase,
    store?: ToolStore,
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
    const dependencyLine = dependencyHandoff.length === 0
      ? ''
      : `\n\n${dependencyHandoff}`;
    const reviewLine =
      spec.phase === 'review' || spec.focus === 'review' || spec.focus === 'full'
        ? '\nReview gate: start your final answer with one of "VERDICT: PASS", "VERDICT: BLOCKED", or "VERDICT: FAIL". Return PASS only when evidence is sufficient; otherwise return concrete fixes and the evidence still missing.'
        : '';
    const workNodeLine = workNodes.length === 0 ? '' : `\n\n${formatWorkNodeContract(workNodes)}`;
    const liveBusDigest = busEnabled && store !== undefined
      ? renderSwarmBusDigest(store, { limit: 8 })
      : '';
    const liveBusLine = liveBusDigest.length > 0 ? `\n\n${liveBusDigest}` : '';
    const collaborationLine = busEnabled
      ? `\n\n${buildTeamRosterXml(team)}\n\n${buildSwarmChannelRulesXml()}\n\n${buildSwarmCollaborationRequiredXml(phase)}${liveBusLine}`
      : '';
    const criticLine = spec.criticAssignment === undefined
      ? ''
      : `\n\n${buildCriticAssignmentXml(spec.criticAssignment)}`;
    return appendSwarmResearchAutonomy(
      `${briefing}\n\n${task}${laneLine}${reasonLine}${focusLine}${phaseLine}${reviewLine}${workNodeLine}${collaborationLine}${handoffLine}${dependencyLine}${criticLine}\n\n${buildExpertSwarmExecutionFooter(spec.expertName)}`,
    );
  }

  private emitTeamStaffedEvent(
    runId: string,
    toolCallId: string,
    team: TeamPlan,
  ): void {
    this.agent.ultrawork.attachTeamPlan(team);
    maybeAdvanceUltraworkStage(this.agent, 'staff', 'UltraSwarm staffed');
    maybeAdvanceUltraworkStage(this.agent, 'swarm', 'UltraSwarm engaged');
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
    result.status === 'completed' &&
    result.verdict !== 'PASS'
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

function buildTeamPlan(
  runId: string,
  specs: readonly UltraSwarmSpec[],
  args: UltraSwarmToolInput,
  maxExperts: number,
): TeamPlan {
  return {
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
}

function augmentTeamPlan(
  team: TeamPlan,
  newSpecs: readonly UltraSwarmSpec[],
  args: UltraSwarmToolInput,
  maxExperts: number,
): TeamPlan {
  return {
    ...team,
    maxExperts,
    reason: 'UltraSwarm restaffed additional specialists after revision gaps.',
    experts: [
      ...team.experts,
      ...newSpecs.map((spec) => ({
        id: spec.expertId,
        name: spec.expertName,
        role: spec.coverageLane ?? spec.division ?? 'specialist',
        focus: spec.focus,
        status: 'queued' as const,
        taskIds: spec.workNodeIds.length > 0 ? spec.workNodeIds : undefined,
        division: spec.division,
        emoji: spec.emoji,
        color: spec.color,
        coverageLane: spec.coverageLane,
        selectionReason: spec.selectionReason,
        dependsOn: spec.dependsOn,
      })),
    ],
  };
}

function councilDecisionFromReview(
  results: readonly UltraSwarmRenderedResult[],
): CouncilDecision {
  const reviewResults = results.filter((result) => result.spec.phase === 'review');
  if (
    reviewResults.length > 0 &&
    reviewResults.every((result) => result.verdict === 'ABORTED' || result.verdict === 'SKIPPED')
  ) {
    return 'interrupted';
  }
  const votes = extractLensVotes(reviewResults);
  if (votes.length === 0) {
    // No completed reviews — fall back to the prior rule-based path.
    if (reviewResults.some((result) => result.verdict === 'FAIL')) return 'block';
    if (reviewResults.some((result) => result.verdict !== 'PASS')) return 'revise';
    return 'approve';
  }
  return consensusFromDiverseVotes(votes);
}

function lensesForIntensity(intensity: SwarmRoutingIntensity | undefined): readonly CriticLens[] {
  const specStrict = CRITIC_LENSES[0];
  const adversarial = CRITIC_LENSES[1];
  if (intensity === 'light') {
    return specStrict !== undefined ? [specStrict] : CRITIC_LENSES.slice(0, 1);
  }
  if (intensity === 'standard') {
    return specStrict !== undefined && adversarial !== undefined
      ? [specStrict, adversarial]
      : CRITIC_LENSES.slice(0, 2);
  }
  // heavy or undefined → all three lenses
  return CRITIC_LENSES;
}

function attachCriticAssignments(
  specs: readonly UltraSwarmSpec[],
  priorResults: readonly UltraSwarmRenderedResult[],
  intensity: SwarmRoutingIntensity | undefined,
): UltraSwarmSpec[] {
  const lenses = lensesForIntensity(intensity);
  const sources = priorResults
    .filter((result) => result.status === 'completed')
    .map((result) => ({
      expertId: result.spec.expertId,
      expertName: result.spec.expertName,
      phase: result.spec.phase,
      verdict: result.verdict,
      handoff: collapseForHandoff(result.result ?? result.error ?? ''),
    }));
  const assignments =
    lenses.length >= 2
      ? assignDiverseCriticEdges(
          specs.map((spec) => ({ expertId: spec.expertId, expertName: spec.expertName })),
          sources,
          lenses,
        )
      : assignReviewCriticEdges(
          specs.map((spec) => ({ expertId: spec.expertId, expertName: spec.expertName })),
          sources,
        );
  return specs.map((spec) => {
    const assignment = assignments.get(spec.expertId);
    if (assignment === undefined) return spec;
    return { ...spec, criticAssignment: assignment };
  });
}

function needsReviewRetry(result: UltraSwarmRenderedResult): boolean {
  return result.spec.phase === 'review'
    && result.spec.requiredForCompletion
    && result.verdict !== 'PASS'
    && result.status !== 'aborted';
}

function mergeReviewResults(
  original: readonly UltraSwarmRenderedResult[],
  retries: readonly UltraSwarmRenderedResult[],
): UltraSwarmRenderedResult[] {
  const byExpertId = new Map(retries.map((result) => [result.spec.expertId, result]));
  return original.map((result) => byExpertId.get(result.spec.expertId) ?? result);
}

function buildReviewRetryHandoff(results: readonly UltraSwarmRenderedResult[]): string {
  const lines = [
    '<review_revision_request>',
    'Council revision pass: address the gaps from your prior review verdict before re-issuing VERDICT.',
  ];
  for (const result of results) {
    lines.push(
      `<prior_review expert_id="${escapeXml(result.spec.expertId)}" verdict="${result.verdict}">${escapeXml(collapseForHandoff(result.result ?? result.error ?? ''))}</prior_review>`,
    );
  }
  lines.push('</review_revision_request>');
  return lines.join('\n');
}

function buildIntraPhaseDependencyHandoff(
  results: readonly UltraSwarmRenderedResult[],
): string {
  if (results.length === 0) return '';
  const lines = ['<dependency_handoff>'];
  for (const result of results) {
    const text = collapseForHandoff(result.result ?? result.error ?? '');
    const evidence = result.evidenceIds.length === 0
      ? ''
      : ` evidence_ids="${escapeXml(result.evidenceIds.join(','))}"`;
    lines.push(
      `<upstream expert_id="${escapeXml(result.spec.expertId)}" phase="${result.spec.phase}" verdict="${result.verdict}"${evidence}>${escapeXml(text)}</upstream>`,
    );
  }
  lines.push('</dependency_handoff>');
  return lines.join('\n');
}

function buildPhaseHandoff(
  results: readonly UltraSwarmRenderedResult[],
  busDigest: string,
): string {
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
  if (busDigest.length > 0) {
    lines.push('');
    lines.push(busDigest);
  }
  return lines.join('\n');
}

function workNodeOutcome(results: readonly UltraSwarmRenderedResult[]): {
  readonly status: WorkGraphNode['status'];
  readonly verificationStatus: NonNullable<WorkGraphNode['verificationStatus']>;
  readonly evidenceIds: readonly string[];
  readonly summary: string;
} {
  const evidenceIds = uniqueStrings(results.flatMap((result) => result.evidenceIds));
  const failed = results.some((result) => result.status === 'failed' || result.verdict === 'FAIL');
  const blocked = results.some((result) => result.verdict === 'BLOCKED');
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

export function resolveMaxExperts(
  toolIntensity: UltraSwarmToolInput['intensity'] | undefined,
  routing: { readonly estimatedExperts: number } | undefined,
  explicitMax: number | undefined,
): number {
  if (explicitMax !== undefined) return Math.min(explicitMax, MAX_ULTRA_SWARM_SUBAGENTS);
  if (toolIntensity === 'max') return MAX_ULTRA_SWARM_SUBAGENTS;
  if (toolIntensity === undefined && routing !== undefined) {
    return Math.max(1, Math.min(routing.estimatedExperts, MAX_ULTRA_SWARM_SUBAGENTS));
  }
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

  lines.push(buildUltraSwarmIntegrationReportXml(rendered, runId));
  lines.push(
    '<integration_handoff>Read integration_report for per-agent work summaries. Parent agent must integrate accepted specialist handoffs into product-file changes and verification evidence.</integration_handoff>',
  );
  lines.push('</ultra_swarm_result>');
  return lines.join('\n');
}

function withRenderedMetadata(result: UltraSwarmRunResult): UltraSwarmRenderedResult {
  const text = result.status === 'completed' ? (result.result ?? '') : (result.error ?? '');
  return {
    ...result,
    verdict: inferVerdict(result.status, text, result.state),
    evidenceIds: extractEvidenceIds(text),
  };
}

function inferVerdict(
  status: UltraSwarmRunResult['status'],
  text: string,
  state?: UltraSwarmRunResult['state'],
): UltraSwarmRenderedResult['verdict'] {
  if (status === 'failed') return 'FAIL';
  if (status === 'aborted') return state === 'not_started' ? 'SKIPPED' : 'ABORTED';
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

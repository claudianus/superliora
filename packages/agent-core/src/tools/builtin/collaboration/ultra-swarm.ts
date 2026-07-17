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
import { synthesizeExpertsWithLlm } from '../../../expert-agents/synthetic-expert-llm';
import type { ExpertSwarmPlan } from '../../../expert-agents/types';
import type { SwarmRoutingIntensity } from '../../../agent/plan/ultra-swarm-routing';
import { compactSwarmToolResult } from '../../../agent/compaction/boundary-compaction';
import { SWARM_HANDOFF_COMPACTION_RATIO } from '../../../agent/compaction/strategy';
import {
  MAX_ULTRA_SWARM_SUBAGENTS,
  buildIntraPhaseDependencyHandoff,
  buildReviewRetryHandoff,
  capPlan,
  cloneWorkGraphNode,
  mergePlans,
  mergeReviewResults,
  needsReviewRetry,
  normalizeOptionalString,
  planFromSyntheticExperts,
  resolveMaxExperts,
  uniqueStrings,
  withWorkNodeSelectionHint,
} from './ultra-swarm-helpers';

export { resolveMaxExperts, MAX_ULTRA_SWARM_SUBAGENTS } from './ultra-swarm-helpers';
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

import {
  ULTRA_SWARM_PHASES,
  type UltraSwarmPhase,
  type UltraSwarmSpec,
  type UltraSwarmRunResult,
  type UltraSwarmRenderedResult,
  ownerExpertIdForWorkNodes,
  blockingRequiredResult,
  blockedResultsForPhase,
  buildTeamPlan,
  augmentTeamPlan,
  councilDecisionFromReview,
  attachCriticAssignments,
  buildPhaseHandoff,
  workNodeOutcome,
  ownerResultForWorkNodes,
  renderUltraSwarmResults,
  withRenderedMetadata,
  buildRestaffSpecs,
  buildInitialSpecs,
  shouldSkipAdaptiveRestaff,
  planPhaseWaveEntries,
  shouldPostImplementWaveStandup,
  selectRestaffPhaseSpecs,
} from './ultra-swarm-phase';
import { buildUltraSwarmExpertPrompt } from './ultra-swarm-prompt';

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
    let plan = await this.buildPlan(
      withWorkNodeSelectionHint(args.description, workNodeContext?.nodes ?? []),
      autoSelect,
      requestedExperts,
      maxExperts,
      args.intensity,
    );

    // Catalog miss / empty plan: invent elite specialists via the active LLM.
    if (plan.experts.length === 0 && autoSelect) {
      plan = await this.synthesizeFallbackPlan({
        description: args.description,
        intensity: args.intensity,
        maxExperts,
        signal,
      });
    }

    if (plan.experts.length === 0) {
      return 'No matching experts found for this task, and synthetic expert generation did not yield a specialist. Try being more specific in your description.';
    }

    if (plan.experts.length > MAX_ULTRA_SWARM_SUBAGENTS) {
      throw new Error(
        `UltraSwarm supports at most ${String(MAX_ULTRA_SWARM_SUBAGENTS)} experts. Requested: ${String(plan.experts.length)}`,
      );
    }

    await this.agent.fullCompaction.ensureBelowHandoffThreshold(signal, SWARM_HANDOFF_COMPACTION_RATIO);

    const specs = buildInitialSpecs({
      experts: plan.experts,
      focus: args.focus,
      runId,
      workNodeIds: workNodeContext?.nodes.map((node) => node.id) ?? [],
      workNodes: workNodeContext?.nodes,
      requiredExpertIds,
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

    let phaseResults: UltraSwarmRunResult[] = [];
    try {
      const loop = await this.runPhasedSwarmLoop({
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
        routingIntensity: routing?.intensity,
      });
      phaseResults = [...loop.phaseResults];
      team = loop.team;
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
      const claimed = new Set<string>();
      for (const result of rendered) {
        if (result.spec.workNodeIds.length === 0) continue;
        this.finishWorkNodes(result.spec.workNodeIds, [result]);
        for (const id of result.spec.workNodeIds) claimed.add(id);
      }
      const unclaimed = workNodeContext.nodes
        .map((node) => node.id)
        .filter((id) => !claimed.has(id));
      if (unclaimed.length > 0) {
        this.finishWorkNodes(unclaimed, rendered);
      }
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


  private async runPhasedSwarmLoop(input: {
    readonly specs: readonly UltraSwarmSpec[];
    team: TeamPlan;
    readonly busEnabled: boolean;
    readonly args: UltraSwarmToolInput;
    readonly workNodeContext: { readonly graph: WorkGraph; readonly nodes: readonly WorkGraphNode[] } | undefined;
    readonly profileBaseName: string | undefined;
    readonly toolCallId: string;
    readonly runId: string;
    readonly signal: AbortSignal;
    readonly maxExperts: number;
    readonly requiredExpertIds: ReadonlySet<string>;
    readonly routingIntensity: SwarmRoutingIntensity | undefined;
  }): Promise<{ phaseResults: UltraSwarmRunResult[]; team: TeamPlan }> {
    const phaseResults: UltraSwarmRunResult[] = [];
    let phaseHandoff = '';
    let blockedBy: UltraSwarmRenderedResult | undefined;
    let team = input.team;

    for (const phase of ULTRA_SWARM_PHASES) {
      const phaseSpecs = input.specs.filter((spec) => spec.phase === phase);
      if (phaseSpecs.length === 0) continue;
      if (blockedBy !== undefined) {
        phaseResults.push(...blockedResultsForPhase(phaseSpecs, blockedBy));
        continue;
      }

      if (input.busEnabled) {
        postOrchestratorStandup(
          this.agent,
          {
            parentAgentId: this.subagentHost.parentAgentId,
            runId: input.runId,
            parentToolCallId: input.toolCallId,
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
          input.routingIntensity,
        );
      }

      let renderedPhaseResults = await this.runPhaseExperts({
        phaseSpecs: phaseSpecsForRun,
        phase,
        phaseHandoff,
        team,
        busEnabled: input.busEnabled,
        args: input.args,
        workNodeContext: input.workNodeContext,
        profileBaseName: input.profileBaseName,
        toolCallId: input.toolCallId,
        runId: input.runId,
        signal: input.signal,
      });

      if (phase === 'review') {
        renderedPhaseResults = await this.retryFailedReviewExperts({
          renderedPhaseResults,
          phaseHandoff,
          team,
          busEnabled: input.busEnabled,
          args: input.args,
          workNodeContext: input.workNodeContext,
          profileBaseName: input.profileBaseName,
          toolCallId: input.toolCallId,
          runId: input.runId,
          signal: input.signal,
        });
      }

      phaseResults.push(...renderedPhaseResults);
      phaseHandoff = buildPhaseHandoff(
        renderedPhaseResults.map(withRenderedMetadata),
        input.busEnabled ? renderSwarmBusDigest(this.store) : '',
      );
      blockedBy = blockingRequiredResult(renderedPhaseResults, phase);

      // Pause-Redirect-Resume checkpoint after phase completion.
      const steerTexts = consumeUltraSwarmSteerRequests(this.agent.ultraSwarmRun);
      if (steerTexts.length > 0) {
        const steerNote = steerTexts.join('\n\n');
        phaseHandoff = `${phaseHandoff}\n\n<user_steering>\n${steerNote}\n</user_steering>`;
        if (this.agent.ultraSwarmRun !== undefined) {
          this.agent.ultraSwarmRun.pausedForSteer = true;
        }
        this.agent.emitEvent({
          type: 'ultrawork.swarm.paused',
          runId: input.runId,
          reason: 'User steering applied at phase checkpoint',
          input: steerNote,
          phase,
        } as any);
        break;
      }
    }

    // Cost control: skip adaptive restaff when review consensus is already solid.
    const preRestaffDecision = councilDecisionFromReview(
      phaseResults.map(withRenderedMetadata),
    );
    const skipRestaff = shouldSkipAdaptiveRestaff({
      pausedForSteer: this.agent.ultraSwarmRun?.pausedForSteer,
      decision: preRestaffDecision,
      intensity: input.routingIntensity,
    });
    const restaffed = skipRestaff
      ? []
      : await this.maybeRestaffForRevision({
          rendered: phaseResults.map(withRenderedMetadata),
          specs: input.specs,
          team,
          busEnabled: input.busEnabled,
          args: input.args,
          workNodeContext: input.workNodeContext,
          profileBaseName: input.profileBaseName,
          toolCallId: input.toolCallId,
          runId: input.runId,
          signal: input.signal,
          maxExperts: input.maxExperts,
          requiredExpertIds: input.requiredExpertIds,
          onTeamUpdated: (nextTeam) => {
            team = nextTeam;
          },
        });
    phaseResults.push(...restaffed);
    return { phaseResults, team };
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

  /**
   * When the static catalog cannot staff the task, ask the active model to
   * invent high-quality specialist personas and register them for spawn.
   */
  private async synthesizeFallbackPlan(input: {
    readonly description: string;
    readonly intensity: UltraSwarmToolInput['intensity'];
    readonly maxExperts: number;
    readonly signal: AbortSignal;
  }): Promise<ExpertSwarmPlan> {
    const experts = await synthesizeExpertsWithLlm(
      {
        generate: this.agent.generate,
        provider: this.agent.config.provider,
      },
      {
        taskDescription: input.description,
        intensity: input.intensity,
        count: Math.min(input.maxExperts, input.intensity === 'max' ? 3 : input.intensity === 'premium' ? 2 : 1),
        signal: input.signal,
      },
    );
    if (experts.length === 0) {
      return { taskDescription: input.description, experts: [], strategy: 'sequential' };
    }
    return capPlan(planFromSyntheticExperts(input.description, experts), input.maxExperts);
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
    const plannedWaves = planPhaseWaveEntries(input.phaseSpecs, waves);
    const phaseResults: UltraSwarmRunResult[] = [];
    let dependencyHandoff = '';
    let waveIndex = 0;

    for (const wave of plannedWaves) {
      waveIndex += 1;
      const tasks = wave.map((entry): QueuedSubagentTask<UltraSwarmSpec> => ({
        kind: 'spawn',
        data: entry.spec,
        profileName: entry.spec.expertId,
        profileBaseName: input.profileBaseName,
        parentToolCallId: input.toolCallId,
        prompt: this.buildExpertPrompt(
          entry.spec,
          input.args.description,
          input.workNodeContext?.nodes ?? [],
          input.phaseHandoff,
          input.team,
          input.busEnabled,
          dependencyHandoff,
          input.phase,
          this.store,
        ),
        description: `${input.args.description} ${entry.descriptionSuffix}`,
        swarmIndex: entry.spec.index,
        runInBackground: false,
        swarmItem: entry.swarmItem,
        signal: input.signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      }));

      const results = await this.subagentHost.runQueued(tasks);
      const renderedWaveResults = results
        .map(({ task, ...result }) => ({ spec: task.data, ...result }))
        .map(withRenderedMetadata);
      phaseResults.push(...renderedWaveResults);
      dependencyHandoff = buildIntraPhaseDependencyHandoff(renderedWaveResults);

      if (shouldPostImplementWaveStandup(input.busEnabled, input.phase)) {
        postWaveStandup(
          this.agent,
          {
            parentAgentId: this.subagentHost.parentAgentId,
            runId: input.runId,
            parentToolCallId: input.toolCallId,
            phase: input.phase,
            waveIndex,
            waveCount: plannedWaves.length,
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



  private announceRestaffOnBus(input: {
    readonly busEnabled: boolean;
    readonly runId: string;
    readonly toolCallId: string;
    readonly expertIds: readonly string[];
  }): void {
    if (!input.busEnabled) return;
    postOrchestratorStandup(
      this.agent,
      {
        parentAgentId: this.subagentHost.parentAgentId,
        runId: input.runId,
        parentToolCallId: input.toolCallId,
        phase: 'restaff',
        expertCount: input.expertIds.length,
      },
      this.store,
    );
    extendSwarmBusAllowlist(this.store, input.expertIds);
  }

  private async planRestaffExperts(input: {
    readonly rendered: readonly UltraSwarmRenderedResult[];
    readonly specs: readonly UltraSwarmSpec[];
    readonly maxExperts: number;
    readonly args: UltraSwarmToolInput;
    readonly busEnabled: boolean;
  }): Promise<ExpertSwarmPlan | undefined> {
    const gaps = collectRestaffGaps(input.rendered);
    const slots = restaffSlotsAvailable(input.specs.length, input.maxExperts);
    if (!needsRestaffing(gaps, input.specs.length, input.maxExperts) || slots === 0) {
      return undefined;
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
    if (restaffPlan.experts.length === 0) return undefined;
    return restaffPlan;
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
    const restaffPlan = await this.planRestaffExperts({
      rendered: input.rendered,
      specs: input.specs,
      maxExperts: input.maxExperts,
      args: input.args,
      busEnabled: input.busEnabled,
    });
    if (restaffPlan === undefined) return [];
    const gaps = collectRestaffGaps(input.rendered);

    this.announceRestaffOnBus({
      busEnabled: input.busEnabled,
      runId: input.runId,
      toolCallId: input.toolCallId,
      expertIds: restaffPlan.experts.map((assignment) => assignment.expertId),
    });

    const phase = restaffPhaseForGaps(gaps);
    const restaffSpecs = buildRestaffSpecs({
      experts: restaffPlan.experts,
      startIndex: input.specs.length,
      phase,
      focus: input.args.focus,
      runId: input.runId,
      workNodeIds: input.workNodeContext?.nodes.map((node) => node.id) ?? [],
    });

    const nextTeam = this.adoptRestaffedTeam({
      team: input.team,
      restaffSpecs,
      args: input.args,
      maxExperts: input.maxExperts,
      runId: input.runId,
      toolCallId: input.toolCallId,
      onTeamUpdated: input.onTeamUpdated,
    });

    const phaseHandoff = buildPhaseHandoff(
      input.rendered,
      input.busEnabled ? renderSwarmBusDigest(this.store) : '',
    );
    const restaffRouting = typeof this.agent.ultraSwarmEngageGate?.data === 'function'
      ? this.agent.ultraSwarmEngageGate.data()?.routing
      : undefined;
    const phaseSpecs = selectRestaffPhaseSpecs({
      phase,
      restaffSpecs,
      priorRendered: input.rendered,
      intensity: restaffRouting?.intensity,
    });

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


  private adoptRestaffedTeam(input: {
    readonly team: TeamPlan;
    readonly restaffSpecs: readonly UltraSwarmSpec[];
    readonly args: UltraSwarmToolInput;
    readonly maxExperts: number;
    readonly runId: string;
    readonly toolCallId: string;
    readonly onTeamUpdated: (team: TeamPlan) => void;
  }): TeamPlan {
    const nextTeam = augmentTeamPlan(
      input.team,
      input.restaffSpecs,
      input.args,
      input.maxExperts,
    );
    input.onTeamUpdated(nextTeam);
    this.emitTeamStaffedEvent(input.runId, input.toolCallId, nextTeam);
    if (this.agent.ultraSwarmRun !== undefined) {
      this.agent.ultraSwarmRun = {
        ...this.agent.ultraSwarmRun,
        team: nextTeam,
      };
    }
    return nextTeam;
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
    const liveBusDigest =
      busEnabled && store !== undefined ? renderSwarmBusDigest(store, { limit: 8 }) : '';
    return buildUltraSwarmExpertPrompt({
      spec,
      taskDescription,
      workNodes,
      phaseHandoff,
      team,
      busEnabled,
      dependencyHandoff,
      phase,
      liveBusDigest,
    });
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


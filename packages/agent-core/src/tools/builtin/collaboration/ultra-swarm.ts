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
  restaffPhaseForGaps,
  restaffSlotsAvailable,
  shouldPlanRestaffWave,
} from '../../../session/ultra-swarm-restaff';
import {
  consumeUltraSwarmRestaffRequests,
  consumeUltraSwarmSteerRequests,
  createUltraSwarmRunContext,
  hasPendingUltraSwarmRestaff,
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
  buildSwarmRunLedgerFromResults,
  writeSwarmRunLedgerArtifact,
} from '../../../session/swarm-run-ledger';
import {
  getDefaultSwarmFileLeaseRegistry,
} from '../../../session/swarm-file-lease';
import {
  createSwarmBudgetState,
  recordSwarmBudgetRound,
  suggestSwarmBudgetKill,
  type SwarmBudgetState,
} from '../../../session/swarm-budget';
import {
  buildDependencyWaves,
} from '../../../session/subagent-wave-scheduler';
import {
  partitionReadyWorkNodeIds,
  preferReadyWorkNodeIds,
  rebindPhaseWorkNodeIds,
  SWARM_DAG_TERMINAL_STATUSES,
} from '../../../session/swarm-dag-scheduler';
import { applyEvidenceHardGate } from '../../../session/swarm-evidence-gate';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import ULTRA_SWARM_DESCRIPTION from './ultra-swarm.md?raw';
import { toInputJsonSchema } from '../../support/input-schema';
import { globalUltraSwarmOrchestrator } from '../../../expert-agents/orchestrator';
import { recordOutcomesFromSwarmResults } from '../../../expert-agents/staffing-outcome';
import { synthesizeExpertsWithLlm } from '../../../expert-agents/synthetic-expert-llm';
import type { ExpertSwarmPlan } from '../../../expert-agents/types';
import type { SwarmRoutingIntensity } from '../../../agent/plan/ultra-swarm-routing';
import { compactSwarmToolResult } from '../../../agent/compaction/boundary-compaction';
import { SWARM_HANDOFF_COMPACTION_RATIO } from '../../../agent/compaction/strategy';
import {
  MAX_ULTRA_SWARM_SUBAGENTS,
  buildDebateDraftHandoffPack,
  debateDraftPhasesForHandoff,
  buildIntraPhaseDependencyHandoff,
  buildReviewRetryHandoff,
  capPlan,
  cloneWorkGraphNode,
  extractFileChangePaths,
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
  shouldStopPhaseLoopAtCheckpoint,
  planPhaseWaveEntries,
  shouldPostImplementWaveStandup,
  selectRestaffPhaseSpecs,
} from './ultra-swarm-phase';
import { buildUltraSwarmExpertPrompt } from './ultra-swarm-prompt';
import {
  attachDraftToDebate,
  createDebate,
  debatePhasesForRisk,
  emitDebateTurn,
  type RiskLevel,
} from '../../../session/ultra-swarm-debate';

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

  /** phase별 토론 추적 활성화된 debate 목록 (draftExcerpt → review handoff) */
  private readonly activeDebates: {
    debateId: string;
    workNodeId: string;
    phase: string;
    riskLevel: RiskLevel;
    authorExpertId: string;
    criticExpertId: string;
    /** Implementer/phase output attached as debate draft for critics. */
    draftExcerpt: string;
  }[] = [];

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
    // Pure DAG ready-set: prefer nodes whose deps are done so blocked nodes are
    // not claimed early. Full graph still used for dep resolution.
    const dagNodes =
      workNodeContext?.nodes.map((node) => ({
        id: node.id,
        dependsOn: node.dependsOn,
        status: node.status,
      })) ?? [];
    const readyPartition =
      dagNodes.length > 0 ? partitionReadyWorkNodeIds(dagNodes) : { readyIds: [], blockedIds: [] };
    const schedulableWorkNodeIds =
      workNodeContext === undefined
        ? []
        : preferReadyWorkNodeIds(
            workNodeContext.nodes.map((node) => node.id),
            dagNodes,
          );
    const schedulableWorkNodes =
      workNodeContext === undefined
        ? []
        : workNodeContext.nodes.filter((node) => schedulableWorkNodeIds.includes(node.id));
    if (workNodeContext !== undefined && workNodeContext.nodes.length > 0) {
      this.agent.telemetry.track('ultra_swarm_dag_ready', {
        run_id: runId,
        ready_count: readyPartition.readyIds.length,
        blocked_count: readyPartition.blockedIds.length,
        bound_count: workNodeContext.nodes.length,
        ready_ids: readyPartition.readyIds.slice(0, 32).join(','),
        blocked_ids: readyPartition.blockedIds.slice(0, 32).join(','),
      });
    }
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

    // Build the swarm plan — selection hint prefers ready work nodes.
    let plan = await this.buildPlan(
      withWorkNodeSelectionHint(args.description, schedulableWorkNodes),
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
      // Bind experts only to ready nodes when the DAG can distinguish them.
      workNodeIds: schedulableWorkNodeIds,
      workNodes: schedulableWorkNodes,
      requiredExpertIds,
    });

    let team = buildTeamPlan(runId, specs, args, maxExperts);
    this.emitTeamStaffedEvent(runId, toolCallId, team);

    const busEnabled = true;
    const runStartedAt = new Date().toISOString();
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

    // Only mark ready nodes running; blocked deps stay queued.
    if (workNodeContext !== undefined && schedulableWorkNodeIds.length > 0) {
      this.markWorkNodesRunning(schedulableWorkNodeIds, ownerExpertIdForWorkNodes(specs));
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
      // Only fail nodes we actually marked running; blocked deps stay queued.
      if (schedulableWorkNodeIds.length > 0) {
        this.failWorkNodes(schedulableWorkNodeIds, error);
      }
      getDefaultSwarmFileLeaseRegistry().releaseAll(runId);
      this.agent.ultraSwarmRun = undefined;
      throw error;
    } finally {
      if (busEnabled) {
        standupTimer?.stop();
        clearSwarmRunBus(this.store);
      }
    }
    const rendered = phaseResults.map(withRenderedMetadata);
    // Feed staffing priors from phase verdicts so future selection can re-rank.
    try {
      recordOutcomesFromSwarmResults(
        rendered.map((result) => ({
          expertId: result.spec.expertId,
          verdict: result.verdict,
          status: result.status,
        })),
      );
    } catch {
      // Outcome store is best-effort — never fail the swarm on prior write errors.
    }
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
      // Do not finish blocked (not-ready) nodes just because the run ended.
      const unclaimed = schedulableWorkNodeIds.filter((id) => !claimed.has(id));
      if (unclaimed.length > 0) {
        this.finishWorkNodes(unclaimed, rendered);
      }
    }

    // Phase 0 run ledger: pure snapshot + optional workdir JSON artifact.
    // Snapshot open leases before releaseAll so conflicts are still visible.
    const openLeases = getDefaultSwarmFileLeaseRegistry().listClaims(runId);
    const pausedForSteer = this.agent.ultraSwarmRun?.pausedForSteer === true;
    try {
      const leaseConflicts = openLeases.map((claim) => ({
        kind: 'file_lease',
        path: claim.path,
        holderId: claim.ownerId,
      }));
      const ledger = buildSwarmRunLedgerFromResults({
        runId,
        startedAt: runStartedAt,
        results: rendered,
        conflicts: leaseConflicts,
      });
      const ledgerPath = await writeSwarmRunLedgerArtifact(this.agent.kaos, ledger);
      this.agent.telemetry.track('ultra_swarm_run_ledger', {
        run_id: runId,
        expert_count: ledger.experts.length,
        evidence_count: ledger.evidenceIds.length,
        wasted_workers: ledger.wastedWorkerFlags.length,
        conflict_count: ledger.conflicts.length,
        ledger_path: ledgerPath,
      });
    } catch {
      // Ledger is observational — never fail the swarm on write errors.
    } finally {
      getDefaultSwarmFileLeaseRegistry().releaseAll(runId);
      this.agent.ultraSwarmRun = undefined;
    }

    this.agent.ultraSwarmEngageGate?.clear('ultra-swarm-completed');
    maybeAdvanceUltraworkStage(this.agent, 'integrate', 'UltraSwarm completed');
    injectUltraworkPostSwarmContinuation(this.agent);
    const steerSuffix = pausedForSteer
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
    let budgetState: SwarmBudgetState = createSwarmBudgetState();
    let budgetKilled = false;
    // Child controller so budget kill can abort in-flight/remaining phase work
    // without requiring the parent tool signal to be re-abortable.
    const phaseController = createLinkedAbortController(input.signal);
    const phaseSignal = phaseController.signal;

    for (const phase of ULTRA_SWARM_PHASES) {
      const phaseSpecs = input.specs.filter((spec) => spec.phase === phase);
      if (phaseSpecs.length === 0) continue;
      if (blockedBy !== undefined) {
        phaseResults.push(...blockedResultsForPhase(phaseSpecs, blockedBy));
        continue;
      }
      if (budgetKilled || phaseSignal.aborted) {
        break;
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

      // Rebind this phase's specs to the live DAG ready-set so nodes unlocked
      // by prior phases become schedulable (not stuck on the initial ready set).
      let phaseSpecsForRun = this.rebindPhaseSpecsToLiveReadyNodes(
        phaseSpecs,
        input.args.work_node_ids ?? [],
        input.runId,
      );
      if (phase === 'review') {
        phaseSpecsForRun = attachCriticAssignments(
          phaseSpecsForRun,
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
        signal: phaseSignal,
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
          signal: phaseSignal,
        });
      }

      phaseResults.push(...renderedPhaseResults);
      // Close work nodes finished in this phase so dependents become ready next.
      this.finishPhaseClaimedWorkNodes(renderedPhaseResults);

      // Budget governor: count rounds without high-signal progress; suggest kill after N wastes.
      // Review/implement PASS without evidenceIds still counts via verificationPassed so
      // verify-only waves are not killed as pure waste.
      const phaseEvidenceIds = uniqueStrings(
        renderedPhaseResults.flatMap((result) => result.evidenceIds ?? []),
      );
      const verificationPassed = renderedPhaseResults.some(
        (result) =>
          result.status === 'completed' &&
          (result.verdict === 'PASS' || result.verdict === 'PASS_WITH_ADVICE'),
      );
      const completedCount = renderedPhaseResults.filter(
        (result) => result.status === 'completed',
      ).length;
      // Product-file edits mentioned in expert text count as high-signal file changes
      // so implement waves with sparse evidenceIds are not pure waste.
      const phaseFileChangePaths = uniqueStrings(
        renderedPhaseResults.flatMap((result) => {
          const text =
            result.status === 'completed' ? (result.result ?? '') : (result.error ?? '');
          return extractFileChangePaths(text);
        }),
      );
      const phaseFileChangeCount = phaseFileChangePaths.length;
      // Path-like evidence/artifact tokens also count as artifacts for budget history.
      const phaseArtifactIds = uniqueStrings([
        ...phaseFileChangePaths,
        ...phaseEvidenceIds.filter((id) => id.includes('/') || /\.[A-Za-z0-9]{1,8}$/u.test(id)),
      ]);
      budgetState = recordSwarmBudgetRound(budgetState, {
        label: phase,
        evidenceIds: phaseEvidenceIds,
        artifactIds: phaseArtifactIds,
        verificationPassed,
        fileChangeCount: phaseFileChangeCount,
        // Completed expert results are high-signal tool successes even without
        // evidenceIds (e.g. PASS review with empty evidence bag).
        toolSuccessCount: completedCount,
        // Soft waste hint only — high-signal fields above win in isWastedBudgetRound.
        wasted:
          phaseEvidenceIds.length === 0 &&
          !verificationPassed &&
          completedCount === 0 &&
          phaseFileChangeCount === 0 &&
          phaseArtifactIds.length === 0,
        productive:
          phaseEvidenceIds.length > 0 ||
          verificationPassed ||
          completedCount > 0 ||
          phaseFileChangeCount > 0 ||
          phaseArtifactIds.length > 0,
      });
      const budgetSuggestion = suggestSwarmBudgetKill(budgetState);
      if (budgetSuggestion.shouldKill) {
        this.agent.telemetry.track('ultra_swarm_budget_kill', {
          run_id: input.runId,
          phase,
          wasted_rounds: budgetSuggestion.wastedRounds,
          kill_threshold: budgetSuggestion.killThreshold,
          reason: budgetSuggestion.reason,
        });
        // Hard kill: abort linked phase controller (in-flight/remaining work),
        // cancel open non-terminal work nodes, and surface a visible reason.
        // Completed phase work stays in phaseResults; no further phases run.
        budgetKilled = true;
        this.applyBudgetKill({
          phaseController,
          runId: input.runId,
          phase,
          reason: budgetSuggestion.reason,
          boundWorkNodeIds: input.args.work_node_ids ?? [],
        });
        phaseHandoff = `${phaseHandoff}\n\n${formatBudgetKillHandoff({
          reason: budgetSuggestion.reason,
          phase,
          wastedRounds: budgetSuggestion.wastedRounds,
          killThreshold: budgetSuggestion.killThreshold,
        })}`;
        break;
      }

      // ── Debate checkpoint: structured adversarial critique after each phase ──
      // Each phase result gets a risk assessment. Low-risk results skip debate;
      // medium/complex results trigger a debate cycle with critic vs author.
      // Consensus verdict flows into the phase handoff and WorkGraph.
      if (phase !== 'plan' && renderedPhaseResults.length > 0) {
        for (const result of renderedPhaseResults) {
          const riskResult = assessDebateRiskForResult(result, phase);
          if (riskResult === 'simple') continue; // skip debate for low-risk

          // Depth is recorded via riskLevel; full multi-turn cycle is deferred.
          void debatePhasesForRisk(riskResult);
          // Pick critic = a different expert from the same phase
          const otherExperts = input.team.experts.filter(
            (e) => e.id !== result.spec.expertId,
          );
          if (otherExperts.length === 0) continue;
          const criticExpert = otherExperts[0]!;
          const workNodeId = result.spec.workNodeIds[0] ?? 'unknown';
          const artifactSummary =
            result.status === 'completed' ? (result.result ?? '') : (result.error ?? '');

          let debate = createDebate({
            workNodeId,
            criticExpertId: criticExpert.id,
            criticExpertName: criticExpert.role,
            authorExpertId: result.spec.expertId,
            authorExpertName: result.spec.expertName,
            artifactSummary,
          });
          // Attach implementer handoff / phase output as the debate draft so
          // critics cite the concrete artifact rather than stance alone.
          debate = attachDraftToDebate(debate, artifactSummary);

          // Emit debate start event
          emitDebateTurn(this.agent, input.runId, {
            debateId: debate.debateId,
            workNodeId: debate.config.workNodeId,
            phase: 'critic',
            expertId: criticExpert.id,
            expertName: criticExpert.role,
            text: `Debate triggered (${riskResult} risk) for ${result.spec.expertName}'s ${phase} output.`,
            stance: 'neutral',
          });

          // Note: full runDebateCycle requires LLM access via subagent.
          // In the phased loop, we record the debate trigger and let the
          // review phase pick it up. The consensus verdict will be parsed
          // from the review phase results.
          const draftExcerpt = (debate.draftExcerpt ?? artifactSummary).trim();
          this.activeDebates.push({
            debateId: debate.debateId,
            workNodeId: debate.config.workNodeId,
            phase: phase,
            riskLevel: riskResult,
            authorExpertId: result.spec.expertId,
            criticExpertId: criticExpert.id,
            draftExcerpt: draftExcerpt.slice(0, 4_000),
          });
        }
      }

      phaseHandoff = buildPhaseHandoff(
        renderedPhaseResults.map(withRenderedMetadata),
        input.busEnabled ? renderSwarmBusDigest(this.store) : '',
      );
      // Append debate draft packs so review experts cite concrete phase output.
      // After implement: include plan+implement drafts; after review: keep implement+review.
      const debateDraftPack = buildDebateDraftHandoffPack(
        this.activeDebates,
        debateDraftPhasesForHandoff(phase),
      );
      if (debateDraftPack.length > 0) {
        phaseHandoff = `${phaseHandoff}\n\n${debateDraftPack}`;
      }
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
      // War-room pauseUltrawork sets pausedForSteer without steer text — stop here.
      if (
        shouldStopPhaseLoopAtCheckpoint({
          steerTexts: [],
          pausedForSteer: this.agent.ultraSwarmRun?.pausedForSteer,
        })
      ) {
        this.agent.emitEvent({
          type: 'ultrawork.swarm.paused',
          runId: input.runId,
          reason: 'UltraSwarm paused at phase checkpoint',
          phase,
        } as any);
        break;
      }
    }

    // Cost control: skip adaptive restaff when review consensus is already solid.
    // War-room / /swarm restaff forces a restaff wave even when council is green.
    // Budget kill also skips restaff — no more spend after governor abort.
    const forceRestaff =
      !budgetKilled && hasPendingUltraSwarmRestaff(this.agent.ultraSwarmRun);
    const restaffReasons = forceRestaff
      ? consumeUltraSwarmRestaffRequests(this.agent.ultraSwarmRun)
      : [];
    const preRestaffDecision = councilDecisionFromReview(
      phaseResults.map(withRenderedMetadata),
    );
    const skipRestaff =
      budgetKilled ||
      shouldSkipAdaptiveRestaff({
        pausedForSteer: this.agent.ultraSwarmRun?.pausedForSteer,
        decision: preRestaffDecision,
        intensity: input.routingIntensity,
        forceRestaff,
      });
    if (forceRestaff && restaffReasons.length > 0) {
      this.agent.telemetry.track('ultra_swarm_restaff_forced', {
        run_id: input.runId,
        reason: restaffReasons.join(' | ').slice(0, 240),
        decision: preRestaffDecision,
      });
    }
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
          forceRestaff,
          restaffReasons,
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

  /**
   * After a phase completes, mark claimed work nodes done/failed so the DAG
   * ready-set advances for subsequent phases.
   */
  private finishPhaseClaimedWorkNodes(
    results: readonly UltraSwarmRenderedResult[],
  ): void {
    const claimed = new Set<string>();
    for (const result of results) {
      if (result.spec.workNodeIds.length === 0) continue;
      this.finishWorkNodes(result.spec.workNodeIds, [result]);
      for (const id of result.spec.workNodeIds) claimed.add(id);
    }
    if (claimed.size > 0) {
      this.agent.telemetry.track('ultra_swarm_dag_phase_finish', {
        finished_count: claimed.size,
        finished_ids: [...claimed].slice(0, 32).join(','),
      });
    }
  }

  /**
   * Rebind phase specs to currently ready WorkGraph nodes (live store).
   * Specs that already hold ready/running ids keep them; empty/blocked specs
   * pick up newly unlocked ready nodes so phase runners do not starve.
   * Pure assignment lives in `rebindPhaseWorkNodeIds`; this method adds
   * telemetry and mark-running side effects.
   */
  private rebindPhaseSpecsToLiveReadyNodes(
    phaseSpecs: readonly UltraSwarmSpec[],
    boundWorkNodeIds: readonly string[],
    runId: string,
  ): UltraSwarmSpec[] {
    if (phaseSpecs.length === 0 || boundWorkNodeIds.length === 0) {
      return [...phaseSpecs];
    }
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined) return [...phaseSpecs];

    const dagNodes = graph.nodes.map((node) => ({
      id: node.id,
      dependsOn: node.dependsOn,
      status: node.status,
    }));
    const partition = partitionReadyWorkNodeIds(
      dagNodes.filter((node) => boundWorkNodeIds.includes(node.id)),
    );
    this.agent.telemetry.track('ultra_swarm_dag_phase_ready', {
      run_id: runId,
      ready_count: partition.readyIds.length,
      blocked_count: partition.blockedIds.length,
      ready_ids: partition.readyIds.slice(0, 32).join(','),
    });

    const rebound = rebindPhaseWorkNodeIds(phaseSpecs, boundWorkNodeIds, dagNodes);
    const readyIds = preferReadyWorkNodeIds(boundWorkNodeIds, dagNodes);
    if (readyIds.length === 0) return rebound;

    const newlyRunning = uniqueStrings(rebound.flatMap((spec) => spec.workNodeIds)).filter(
      (id) => {
        const node = graph.nodes.find((n) => n.id === id);
        return (
          node !== undefined &&
          node.status !== 'running' &&
          !SWARM_DAG_TERMINAL_STATUSES.has(node.status)
        );
      },
    );
    if (newlyRunning.length > 0) {
      this.markWorkNodesRunning(newlyRunning, ownerExpertIdForWorkNodes(rebound));
    }
    return rebound;
  }

  private finishWorkNodes(
    nodeIds: readonly string[],
    results: readonly UltraSwarmRenderedResult[],
  ): void {
    const outcome = workNodeOutcome(results);
    const owner = ownerResultForWorkNodes(results);
    // Skip already-terminal nodes so multi-phase finish is idempotent.
    // needs_integration / cancelled / failed / blocked count as terminal too.
    this.updateWorkNodes(nodeIds, (node) => {
      if (SWARM_DAG_TERMINAL_STATUSES.has(node.status)) return node;
      return {
        ...node,
        ownerExpertId: node.ownerExpertId ?? owner?.spec.expertId,
        ownerAgentId: node.ownerAgentId ?? owner?.agentId,
        status: outcome.status,
        evidenceIds: uniqueStrings([...(node.evidenceIds ?? []), ...outcome.evidenceIds]),
        verificationStatus: outcome.verificationStatus,
        verificationSummary: outcome.summary,
      };
    });
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

  /**
   * Budget governor hard kill: abort the linked phase controller (cancels
   * in-flight/remaining subagents that share its signal) and mark non-terminal
   * bound work nodes cancelled with a visible verificationSummary reason.
   */
  private applyBudgetKill(input: {
    readonly phaseController: AbortController;
    readonly runId: string;
    readonly phase: UltraSwarmPhase;
    readonly reason: string;
    readonly boundWorkNodeIds: readonly string[];
  }): void {
    if (!input.phaseController.signal.aborted) {
      input.phaseController.abort(new Error(input.reason));
    }

    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    const candidateIds =
      input.boundWorkNodeIds.length > 0
        ? input.boundWorkNodeIds
        : (graph?.nodes.map((node) => node.id) ?? []);
    const openIds = candidateIds.filter((id) => {
      const node = graph?.nodes.find((entry) => entry.id === id);
      if (node === undefined) return false;
      // running is never terminal; also cancel queued/ready open work.
      return node.status === 'running' || !SWARM_DAG_TERMINAL_STATUSES.has(node.status);
    });
    if (openIds.length > 0) {
      this.updateWorkNodes(openIds, (node) => {
        if (node.status !== 'running' && SWARM_DAG_TERMINAL_STATUSES.has(node.status)) {
          return node;
        }
        return {
          ...node,
          status: 'cancelled',
          verificationStatus: 'failed',
          verificationSummary: `Budget kill (${input.phase}): ${input.reason}`,
        };
      });
    }
    this.agent.emitEvent({
      type: 'ultrawork.swarm.paused',
      runId: input.runId,
      reason: `Budget kill: ${input.reason}`,
      phase: input.phase,
    } as any);
  }

  private updateWorkNodes(
    nodeIds: readonly string[],
    update: (node: WorkGraphNode) => WorkGraphNode,
  ): void {
    const graph = this.store.get(ULTRAWORK_GRAPH_STORE_KEY);
    if (graph === undefined) return;
    const targetIds = new Set(nodeIds);
    const mapped = graph.nodes.map((node) =>
      targetIds.has(node.id) ? update(cloneWorkGraphNode(node)) : node,
    );
    // Same hard gate as UltraworkGraph tool path — UltraSwarm must not be a
    // privileged done mutator that bypasses requiredEvidence checks.
    const gated = applyEvidenceHardGate(mapped);
    if (gated.violations.length > 0) {
      this.agent.telemetry.track('evidence_gate_violations', {
        run_id: graph.runId,
        source: 'ultra_swarm_update_work_nodes',
        violations: gated.violations.length,
        node_ids: gated.violations.map((v) => v.nodeId).slice(0, 32).join(','),
      });
    }
    const next = cloneWorkGraph({
      ...graph,
      updatedAt: new Date().toISOString(),
      nodes: gated.nodes,
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
    // Fire-and-forget: this method is sync; markComplete applies status
    // synchronously so the race window is minimal.
    void maybeFinishUltraworkRun(this.agent);
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
    readonly forceRestaff?: boolean;
    readonly restaffReasons?: readonly string[];
  }): Promise<ExpertSwarmPlan | undefined> {
    const gaps = collectRestaffGaps(input.rendered);
    const force = input.forceRestaff === true;
    if (
      !shouldPlanRestaffWave({
        forceRestaff: force,
        gaps,
        staffedCount: input.specs.length,
        maxExperts: input.maxExperts,
      })
    ) {
      return undefined;
    }
    const slots = restaffSlotsAvailable(input.specs.length, input.maxExperts);
    const reasonNote =
      force && (input.restaffReasons?.length ?? 0) > 0
        ? `\n\nUser/war-room restaff directive:\n${(input.restaffReasons ?? []).map((r) => `- ${r}`).join('\n')}`
        : force
          ? '\n\nUser/war-room restaff directive: restaff additional specialists even if gaps are soft.'
          : '';
    const reflection =
      buildRestaffReflectionPrompt(
        input.args.description,
        gaps,
        input.busEnabled ? renderSwarmBusDigest(this.store) : undefined,
      ) + reasonNote;
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
    readonly forceRestaff?: boolean;
    readonly restaffReasons?: readonly string[];
    readonly onTeamUpdated: (team: TeamPlan) => void;
  }): Promise<readonly UltraSwarmRunResult[]> {
    const restaffPlan = await this.planRestaffExperts({
      rendered: input.rendered,
      specs: input.specs,
      maxExperts: input.maxExperts,
      args: input.args,
      busEnabled: input.busEnabled,
      forceRestaff: input.forceRestaff === true,
      restaffReasons: input.restaffReasons ?? [],
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

// ── Budget kill + AbortSignal helpers ────────────────────────────────

/**
 * Link a child AbortController to a parent signal so budget kill can abort
 * phase work without mutating the parent tool signal.
 */
export function createLinkedAbortController(parent: AbortSignal): AbortController {
  const child = new AbortController();
  if (parent.aborted) {
    child.abort(parent.reason);
    return child;
  }
  const onAbort = (): void => {
    if (!child.signal.aborted) {
      child.abort(parent.reason);
    }
  };
  parent.addEventListener('abort', onAbort, { once: true });
  // Drop listener when child aborts first (budget kill) so we do not leak.
  child.signal.addEventListener(
    'abort',
    () => {
      parent.removeEventListener('abort', onAbort);
    },
    { once: true },
  );
  return child;
}

/** Visible handoff fragment for budget governor kill (parent + TUI). */
export function formatBudgetKillHandoff(input: {
  readonly reason: string;
  readonly phase: string;
  readonly wastedRounds: number;
  readonly killThreshold: number;
}): string {
  const reason = input.reason.replace(/"/g, "'");
  return [
    `<budget_kill reason="${reason}" phase="${input.phase}" ` +
      `wasted_rounds="${String(input.wastedRounds)}" ` +
      `threshold="${String(input.killThreshold)}" />`,
    'Budget governor stopped further UltraSwarm phases after consecutive low-signal rounds.',
    'Do not re-launch UltraSwarm for the same wasted pattern. Integrate accepted specialist handoffs,',
    'attach evidenceIds / verification, or change approach (smaller scope, different tools, or user steering).',
  ].join('\n');
}

// ── Debate risk assessment helpers ────────────────────────────────────

/**
 * phase 결과물의 위험도를 평가하여 debate 깊이를 결정.
 * - implement phase: 파일 수/의존성/증거 수 기준
 * - review phase: 모든 결과에 대해 최소 medium 토론
 * - plan phase: 토론 생략 (이미 plan 승인을 받았으므로)
 */
function assessDebateRiskForResult(
  result: UltraSwarmRenderedResult,
  phase: string,
): RiskLevel {
  if (phase === 'plan') return 'simple';
  if (phase === 'review') return 'medium'; // review는 항상 토론

  // implement phase: 결과물 길이와 증거 수로 위험도 추정
  const text =
    result.status === 'completed' ? (result.result ?? '') : (result.error ?? '');
  const renderedLength = text.length;
  if (renderedLength > 5000) return 'complex';
  if (renderedLength > 1000) return 'medium';
  return 'simple';
}


import { randomUUID } from 'node:crypto';

import type { Agent } from '../../../agent/index';
import type { SwarmMode } from '../../../agent/swarm';
import type { BuiltinTool } from '../../../agent/tool';
import {
  type SessionSubagentHost,
} from '../../../session/subagent/subagent-host';
import {
  createUltraSwarmRunContext,
} from '../../../agent/ultra-swarm-run';
import {
  buildSwarmRunLedgerFromResults,
  emitCouncilDecisionFromReview,
  fleetCostGuardSoftTipFromAgent,
  getDefaultSwarmFileLeaseRegistry,
  makerCheckerSoftWarnFromUltraSwarmResults,
  partitionReadyWorkNodeIds,
  preferReadyWorkNodeIds,
  type SwarmStandupTimerHandle,
  writeSwarmRunLedgerArtifact,
} from '#/fleet';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import ULTRA_SWARM_BODY from './ultra-swarm.md?raw';

const ULTRA_SWARM_DESCRIPTION =
  `Legacy/advanced swarm orchestration. Prefer AgentSwarm for new work, or /fleet in the TUI. ${ULTRA_SWARM_BODY}`;
import { toInputJsonSchema } from '../../support/input-schema';
import { recordOutcomesFromSwarmResults } from '../../../expert-agents/staffing-outcome';
import { compactSwarmToolResult } from '../../../agent/compaction/boundary-compaction';
import { resolveArchiveRecoverToolName } from '../../../agent/compaction/micro/micro-helpers';
import { SWARM_HANDOFF_COMPACTION_RATIO } from '../../../agent/compaction/strategy';
import {
  MAX_ULTRA_SWARM_SUBAGENTS,
  normalizeOptionalString,
  resolveMaxExperts,
  uniqueStrings,
  withWorkNodeSelectionHint,
} from './ultra-swarm-helpers';
import type { ToolStore } from '../../store';
import {
  clearSwarmRunBus,
  initSwarmRunBus,
} from '../state/swarm-bus';

import {
  type UltraSwarmRunResult,
  ownerExpertIdForWorkNodes,
  buildTeamPlan,
  councilDecisionFromReview,
  buildInitialSpecs,
  renderUltraSwarmResults,
  withRenderedMetadata,
} from './ultra-swarm-phase';
import { createLinkedAbortController, formatBudgetKillHandoff } from './ultra-swarm-budget-debate';
import { UltraSwarmWorkNodeCoordinator } from './ultra-swarm-worknodes';
import {
  UltraSwarmToolInputSchema,
  type UltraSwarmToolInput,
} from './ultra-swarm-schema';
import {
  buildUltraSwarmExpertPlan,
  synthesizeUltraSwarmFallbackPlan,
} from './ultra-swarm-plan';
import { UltraSwarmPhaseRunner } from './ultra-swarm-phase-runner';
import { UltraSwarmRestaffCoordinator } from './ultra-swarm-restaff';
import {
  UltraSwarmPhaseLoopRunner,
  type UltraSwarmActiveDebate,
} from './ultra-swarm-phase-loop';
import { emitUltraSwarmTeamStaffedEvent, onUltraSwarmRunCompleted } from './ultra-swarm-team';

export { resolveMaxExperts, MAX_ULTRA_SWARM_SUBAGENTS } from './ultra-swarm-helpers';
export { UltraSwarmToolInputSchema, type UltraSwarmToolInput } from './ultra-swarm-schema';
export { createLinkedAbortController, formatBudgetKillHandoff } from './ultra-swarm-budget-debate';

export class UltraSwarmTool implements BuiltinTool<UltraSwarmToolInput> {
  readonly name = 'UltraSwarm' as const;
  readonly description = ULTRA_SWARM_DESCRIPTION;

  readonly parameters: Record<string, unknown> = toInputJsonSchema(UltraSwarmToolInputSchema);

  private readonly activeDebates: UltraSwarmActiveDebate[] = [];
  private readonly workNodes: UltraSwarmWorkNodeCoordinator;
  private readonly phaseRunner: UltraSwarmPhaseRunner;
  private readonly restaff: UltraSwarmRestaffCoordinator;
  private readonly phaseLoop: UltraSwarmPhaseLoopRunner;

  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly swarmMode: SwarmMode,
    private readonly store: ToolStore,
    private readonly agent: Agent,
  ) {
    this.workNodes = new UltraSwarmWorkNodeCoordinator(store, agent);
    this.phaseRunner = new UltraSwarmPhaseRunner(subagentHost, agent, store);
    this.restaff = new UltraSwarmRestaffCoordinator(subagentHost, agent, store, this.phaseRunner);
    this.phaseLoop = new UltraSwarmPhaseLoopRunner(
      subagentHost,
      agent,
      store,
      this.workNodes,
      this.phaseRunner,
      this.restaff,
      this.activeDebates,
    );
  }

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
    const workNodeContext = this.workNodes.resolveWorkNodeContext(args);
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

    let plan = await buildUltraSwarmExpertPlan(
      withWorkNodeSelectionHint(args.description, schedulableWorkNodes),
      autoSelect,
      requestedExperts,
      maxExperts,
      args.intensity,
    );

    if (plan.experts.length === 0 && autoSelect) {
      plan = await synthesizeUltraSwarmFallbackPlan(this.agent, {
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
      workNodeIds: schedulableWorkNodeIds,
      workNodes: schedulableWorkNodes,
      requiredExpertIds,
    });

    let team = buildTeamPlan(runId, specs, args, maxExperts);
    emitUltraSwarmTeamStaffedEvent(this.agent, runId, toolCallId, team);

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

    let claimedWorkNodeIds = schedulableWorkNodeIds;
    if (workNodeContext !== undefined && schedulableWorkNodeIds.length > 0) {
      const claim = await this.workNodes.markWorkNodesRunning(
        schedulableWorkNodeIds,
        ownerExpertIdForWorkNodes(specs),
        runId,
        signal,
      );
      if (claim.haltReason !== undefined) {
        standupTimer?.stop();
        clearSwarmRunBus(this.store);
        this.agent.ultraSwarmRun = undefined;
        throw new Error(`Team hook halt (TaskCreated): ${claim.haltReason}`);
      }
      claimedWorkNodeIds = [...claim.claimedIds];
    }

    let phaseResults: UltraSwarmRunResult[] = [];
    try {
      const loop = await this.phaseLoop.runPhasedSwarmLoop({
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
      if (claimedWorkNodeIds.length > 0) {
        this.workNodes.failWorkNodes(claimedWorkNodeIds, error);
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
        await this.workNodes.finishWorkNodes(result.spec.workNodeIds, [result], runId, signal);
        for (const id of result.spec.workNodeIds) claimed.add(id);
      }
      const unclaimed = claimedWorkNodeIds.filter((id) => !claimed.has(id));
      if (unclaimed.length > 0) {
        await this.workNodes.finishWorkNodes(unclaimed, rendered, runId, signal);
      }
    }

    const openLeases = getDefaultSwarmFileLeaseRegistry().listClaims(runId);
    const pausedForSteer =  this.agent.ultraSwarmRun?.pausedForSteer;
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

    onUltraSwarmRunCompleted(this.agent);
    const steerSuffix = pausedForSteer
      ? '\n\n<user_steering_applied>UltraSwarm paused after user steering. Incorporate the steering note in the phase handoff and continue from the remaining work.</user_steering_applied>'
      : '';
    const makerCheckerTip = makerCheckerSoftWarnFromUltraSwarmResults(rendered);
    const costGuardTip = fleetCostGuardSoftTipFromAgent(this.agent, rendered.length);
    const governanceSuffix = [makerCheckerTip, costGuardTip]
      .filter((line) => line !== undefined)
      .join('\n\n');
    const rawResult =
      renderUltraSwarmResults(rendered, plan, runId) +
      steerSuffix +
      (governanceSuffix.length > 0 ? `\n\n${governanceSuffix}` : '');
    const recoverToolName = resolveArchiveRecoverToolName(
      this.agent.tools.loopTools.map((tool) => tool.name),
    );
    const compacted = compactSwarmToolResult(this.store, rawResult, { runId, recoverToolName });
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
}

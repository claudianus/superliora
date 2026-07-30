import type { TeamPlan, WorkGraph, WorkGraphNode } from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import type { SwarmRoutingIntensity } from '../../../agent/plan/ultra-swarm-routing';
import {
  consumeUltraSwarmRestaffRequests,
  consumeUltraSwarmSteerRequests,
  hasPendingUltraSwarmRestaff,
} from '../../../agent/ultra-swarm-run';
import {
  attachDraftToDebate,
  createDebate,
  debatePhasesForRisk,
  emitDebateTurn,
  type RiskLevel,
} from '../../../session/ultra-swarm-debate';
import { postOrchestratorStandup } from '../../../collaboration/swarm-bus-coordination';
import {
  createSwarmBudgetState,
  recordSwarmBudgetRound,
  suggestSwarmBudgetKill,
  type SwarmBudgetState,
} from '../../../collaboration/swarm-budget';
import type { SessionSubagentHost } from '../../../session/subagent/subagent-host';
import type { ToolStore } from '../../store';
import { renderSwarmBusDigest } from '../state/swarm-bus';
import {
  createLinkedAbortController,
  assessDebateRiskForResult,
  formatBudgetKillHandoff,
} from './ultra-swarm-budget-debate';
import {
  buildDebateDraftHandoffPack,
  debateDraftPhasesForHandoff,
  extractFileChangePaths,
  uniqueStrings,
} from './ultra-swarm-helpers';
import {
  ULTRA_SWARM_PHASES,
  attachCriticAssignments,
  blockedResultsForPhase,
  blockingRequiredResult,
  buildPhaseHandoff,
  councilDecisionFromReview,
  shouldSkipAdaptiveRestaff,
  shouldStopPhaseLoopAtCheckpoint,
  withRenderedMetadata,
  type UltraSwarmPhase,
  type UltraSwarmRenderedResult,
  type UltraSwarmRunResult,
  type UltraSwarmSpec,
} from './ultra-swarm-phase';
import type { UltraSwarmPhaseRunner } from './ultra-swarm-phase-runner';
import type { UltraSwarmRestaffCoordinator } from './ultra-swarm-restaff';
import type { UltraSwarmToolInput } from './ultra-swarm-schema';
import type { UltraSwarmWorkNodeCoordinator } from './ultra-swarm-worknodes';

/** phase별 토론 추적 활성화된 debate 목록 (draftExcerpt → review handoff) */
export type UltraSwarmActiveDebate = {
  debateId: string;
  workNodeId: string;
  phase: string;
  riskLevel: RiskLevel;
  authorExpertId: string;
  criticExpertId: string;
  /** Implementer/phase output attached as debate draft for critics. */
  draftExcerpt: string;
};

/**
 * Owns the phased UltraSwarm loop: per-phase expert waves, budget governor,
 * debate checkpoints, steer pauses, and adaptive restaff.
 */
export class UltraSwarmPhaseLoopRunner {
  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly agent: Agent,
    private readonly store: ToolStore,
    private readonly workNodes: UltraSwarmWorkNodeCoordinator,
    private readonly phaseRunner: UltraSwarmPhaseRunner,
    private readonly restaff: UltraSwarmRestaffCoordinator,
    private readonly activeDebates: UltraSwarmActiveDebate[],
  ) {}

  async runPhasedSwarmLoop(input: {
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
      let phaseSpecsForRun = this.workNodes.rebindPhaseSpecsToLiveReadyNodes(
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

      let renderedPhaseResults = await this.phaseRunner.runPhaseExperts({
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
        renderedPhaseResults = await this.phaseRunner.retryFailedReviewExperts({
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
      this.workNodes.finishPhaseClaimedWorkNodes(renderedPhaseResults);

      budgetState = this.recordPhaseBudgetRound({
        budgetState,
        renderedPhaseResults,
        phase,
      });
      const budgetSuggestion = suggestSwarmBudgetKill(budgetState);
      if (budgetSuggestion.shouldKill) {
        budgetKilled = this.applyBudgetKill({
          budgetSuggestion,
          budgetState,
          phaseController,
          runId: input.runId,
          phase,
          boundWorkNodeIds: input.args.work_node_ids ?? [],
        });
        phaseHandoff = `${phaseHandoff}\n\n${formatBudgetKillHandoff({
          reason: budgetSuggestion.reason,
          phase,
          wastedRounds: budgetSuggestion.wastedRounds,
          killThreshold: budgetSuggestion.killThreshold,
          lastRounds: budgetState.history.map((round) => ({
            label: round.label,
            wasted: round.wasted,
            evidenceCount: round.evidenceCount,
            toolSuccessCount: round.toolSuccessCount,
          })),
        })}`;
        break;
      }

      this.maybeTriggerDebates({
        phase,
        renderedPhaseResults,
        team,
        runId: input.runId,
      });

      phaseHandoff = buildPhaseHandoff(
        renderedPhaseResults.map(withRenderedMetadata),
        input.busEnabled ? renderSwarmBusDigest(this.store) : '',
      );
      const debateDraftPack = buildDebateDraftHandoffPack(
        this.activeDebates,
        debateDraftPhasesForHandoff(phase),
      );
      if (debateDraftPack.length > 0) {
        phaseHandoff = `${phaseHandoff}\n\n${debateDraftPack}`;
      }
      blockedBy = blockingRequiredResult(renderedPhaseResults, phase);

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

    const restaffed = await this.maybeRunRestaff({
      budgetKilled,
      phaseResults,
      input,
      team,
      onTeamUpdated: (nextTeam) => {
        team = nextTeam;
      },
    });
    phaseResults.push(...restaffed);
    return { phaseResults, team };
  }

  private recordPhaseBudgetRound(input: {
    budgetState: SwarmBudgetState;
    renderedPhaseResults: readonly UltraSwarmRenderedResult[];
    phase: UltraSwarmPhase;
  }): SwarmBudgetState {
    const phaseEvidenceIds = uniqueStrings(
      input.renderedPhaseResults.flatMap((result) => result.evidenceIds ?? []),
    );
    const verificationPassed = input.renderedPhaseResults.some(
      (result) =>
        result.status === 'completed' &&
        (result.verdict === 'PASS' || result.verdict === 'PASS_WITH_ADVICE'),
    );
    const completedCount = input.renderedPhaseResults.filter(
      (result) => result.status === 'completed',
    ).length;
    const phaseFileChangePaths = uniqueStrings(
      input.renderedPhaseResults.flatMap((result) => {
        const text =
          result.status === 'completed' ? (result.result ?? '') : (result.error ?? '');
        return extractFileChangePaths(text);
      }),
    );
    const phaseFileChangeCount = phaseFileChangePaths.length;
    const phaseArtifactIds = uniqueStrings([
      ...phaseFileChangePaths,
      ...phaseEvidenceIds.filter((id) => id.includes('/') || /\.[A-Za-z0-9]{1,8}$/u.test(id)),
    ]);
    return recordSwarmBudgetRound(input.budgetState, {
      label: input.phase,
      evidenceIds: phaseEvidenceIds,
      artifactIds: phaseArtifactIds,
      verificationPassed,
      fileChangeCount: phaseFileChangeCount,
      toolSuccessCount: completedCount,
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
  }

  private applyBudgetKill(input: {
    budgetSuggestion: ReturnType<typeof suggestSwarmBudgetKill>;
    budgetState: SwarmBudgetState;
    phaseController: AbortController;
    runId: string;
    phase: UltraSwarmPhase;
    boundWorkNodeIds: readonly string[];
  }): true {
    this.agent.telemetry.track('ultra_swarm_budget_kill', {
      run_id: input.runId,
      phase: input.phase,
      wasted_rounds: input.budgetSuggestion.wastedRounds,
      kill_threshold: input.budgetSuggestion.killThreshold,
      reason: input.budgetSuggestion.reason,
    });
    this.workNodes.applyBudgetKill({
      phaseController: input.phaseController,
      runId: input.runId,
      phase: input.phase,
      reason: input.budgetSuggestion.reason,
      boundWorkNodeIds: input.boundWorkNodeIds,
    });
    return true;
  }

  private maybeTriggerDebates(input: {
    phase: UltraSwarmPhase;
    renderedPhaseResults: readonly UltraSwarmRenderedResult[];
    team: TeamPlan;
    runId: string;
  }): void {
    if (input.phase === 'plan' || input.renderedPhaseResults.length === 0) return;

    for (const result of input.renderedPhaseResults) {
      const riskResult = assessDebateRiskForResult(result, input.phase);
      if (riskResult === 'simple') continue;

      void debatePhasesForRisk(riskResult);
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
      debate = attachDraftToDebate(debate, artifactSummary);

      emitDebateTurn(this.agent, input.runId, {
        debateId: debate.debateId,
        workNodeId: debate.config.workNodeId,
        phase: 'critic',
        expertId: criticExpert.id,
        expertName: criticExpert.role,
        text: `Debate triggered (${riskResult} risk) for ${result.spec.expertName}'s ${input.phase} output.`,
        stance: 'neutral',
      });

      const draftExcerpt = (debate.draftExcerpt ?? artifactSummary).trim();
      this.activeDebates.push({
        debateId: debate.debateId,
        workNodeId: debate.config.workNodeId,
        phase: input.phase,
        riskLevel: riskResult,
        authorExpertId: result.spec.expertId,
        criticExpertId: criticExpert.id,
        draftExcerpt: draftExcerpt.slice(0, 4_000),
      });
    }
  }

  private async maybeRunRestaff(input: {
    budgetKilled: boolean;
    phaseResults: UltraSwarmRunResult[];
    input: {
      readonly specs: readonly UltraSwarmSpec[];
      readonly busEnabled: boolean;
      readonly args: UltraSwarmToolInput;
      readonly workNodeContext: { readonly nodes: readonly WorkGraphNode[] } | undefined;
      readonly profileBaseName: string | undefined;
      readonly toolCallId: string;
      readonly runId: string;
      readonly signal: AbortSignal;
      readonly maxExperts: number;
      readonly requiredExpertIds: ReadonlySet<string>;
      readonly routingIntensity: SwarmRoutingIntensity | undefined;
    };
    team: TeamPlan;
    onTeamUpdated: (team: TeamPlan) => void;
  }): Promise<readonly UltraSwarmRunResult[]> {
    const forceRestaff =
      !input.budgetKilled && hasPendingUltraSwarmRestaff(this.agent.ultraSwarmRun);
    const restaffReasons = forceRestaff
      ? consumeUltraSwarmRestaffRequests(this.agent.ultraSwarmRun)
      : [];
    const preRestaffDecision = councilDecisionFromReview(
      input.phaseResults.map(withRenderedMetadata),
    );
    const skipRestaff =
      input.budgetKilled ||
      shouldSkipAdaptiveRestaff({
        pausedForSteer: this.agent.ultraSwarmRun?.pausedForSteer,
        decision: preRestaffDecision,
        intensity: input.input.routingIntensity,
        forceRestaff,
      });
    if (forceRestaff && restaffReasons.length > 0) {
      this.agent.telemetry.track('ultra_swarm_restaff_forced', {
        run_id: input.input.runId,
        reason: restaffReasons.join(' | ').slice(0, 240),
        decision: preRestaffDecision,
      });
    }
    if (skipRestaff) return [];
    return this.restaff.maybeRestaffForRevision({
      rendered: input.phaseResults.map(withRenderedMetadata),
      specs: input.input.specs,
      team: input.team,
      busEnabled: input.input.busEnabled,
      args: input.input.args,
      workNodeContext: input.input.workNodeContext,
      profileBaseName: input.input.profileBaseName,
      toolCallId: input.input.toolCallId,
      runId: input.input.runId,
      signal: input.input.signal,
      maxExperts: input.input.maxExperts,
      requiredExpertIds: input.input.requiredExpertIds,
      forceRestaff,
      restaffReasons,
      onTeamUpdated: input.onTeamUpdated,
    });
  }
}

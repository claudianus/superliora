import type { TeamPlan, WorkGraphNode } from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import {
  buildRestaffReflectionPrompt,
  collectRestaffGaps,
  filterRestaffPlan,
  restaffPhaseForGaps,
  restaffSlotsAvailable,
  shouldPlanRestaffWave,
} from '../../../session/ultra-swarm-restaff';
import { postOrchestratorStandup } from '../../../session/swarm-bus-coordination';
import { globalUltraSwarmOrchestrator } from '../../../expert-agents/orchestrator';
import type { ExpertSwarmPlan } from '../../../expert-agents/types';
import type { SessionSubagentHost } from '../../../session/subagent-host';
import type { ToolStore } from '../../store';
import { extendSwarmBusAllowlist, renderSwarmBusDigest } from '../state/swarm-bus';
import {
  augmentTeamPlan,
  buildPhaseHandoff,
  buildRestaffSpecs,
  selectRestaffPhaseSpecs,
  withRenderedMetadata,
  type UltraSwarmRenderedResult,
  type UltraSwarmRunResult,
  type UltraSwarmSpec,
} from './ultra-swarm-phase';
import type { UltraSwarmPhaseRunner } from './ultra-swarm-phase-runner';
import type { UltraSwarmToolInput } from './ultra-swarm-schema';
import { emitUltraSwarmTeamStaffedEvent } from './ultra-swarm-team';

/**
 * Adaptive restaff: plan additional specialists from review gaps, announce on
 * the swarm bus, augment the team plan, and run a follow-up phase wave.
 */
export class UltraSwarmRestaffCoordinator {
  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly agent: Agent,
    private readonly store: ToolStore,
    private readonly phaseRunner: UltraSwarmPhaseRunner,
  ) {}

  announceRestaffOnBus(input: {
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

  async planRestaffExperts(input: {
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

  async maybeRestaffForRevision(input: {
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

    const results = await this.phaseRunner.runPhaseExperts({
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

  adoptRestaffedTeam(input: {
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
    emitUltraSwarmTeamStaffedEvent(this.agent, input.runId, input.toolCallId, nextTeam);
    if (this.agent.ultraSwarmRun !== undefined) {
      this.agent.ultraSwarmRun = {
        ...this.agent.ultraSwarmRun,
        team: nextTeam,
      };
    }
    return nextTeam;
  }
}

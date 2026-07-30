import type { TeamPlan, WorkGraphNode } from '@superliora/protocol';

import type { Agent } from '../../../agent/index';
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type QueuedSubagentTask,
  type SessionSubagentHost,
} from '../../../session/subagent-host';
import {
  postOrchestratorStandup,
  postWaveStandup,
} from '../../../session/swarm-bus-coordination';
import { buildDependencyWaves } from '../../../session/subagent-wave-scheduler';
import type { ToolStore } from '../../store';
import { renderSwarmBusDigest } from '../state/swarm-bus';
import {
  buildIntraPhaseDependencyHandoff,
  buildReviewRetryHandoff,
  mergeReviewResults,
  needsReviewRetry,
} from './ultra-swarm-helpers';
import {
  planPhaseWaveEntries,
  shouldPostImplementWaveStandup,
  withRenderedMetadata,
  type UltraSwarmPhase,
  type UltraSwarmRenderedResult,
  type UltraSwarmRunResult,
  type UltraSwarmSpec,
} from './ultra-swarm-phase';
import { buildUltraSwarmExpertPrompt } from './ultra-swarm-prompt';
import type { UltraSwarmToolInput } from './ultra-swarm-schema';

/**
 * Runs a single UltraSwarm phase: dependency waves, subagent spawn queue,
 * intra-phase handoffs, and optional implement wave standups.
 */
export class UltraSwarmPhaseRunner {
  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly agent: Agent,
    private readonly store: ToolStore,
  ) {}

  async runPhaseExperts(input: {
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

  async retryFailedReviewExperts(input: {
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

  private buildExpertPrompt(
    spec: UltraSwarmSpec,
    taskDescription: string,
    workNodes: readonly WorkGraphNode[],
    phaseHandoff: string,
    team: TeamPlan,
    busEnabled: boolean,
    dependencyHandoff = '',
    phase: UltraSwarmPhase = spec.phase,
  ): string {
    const liveBusDigest =
      busEnabled ? renderSwarmBusDigest(this.store, { limit: 8 }) : '';
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
}

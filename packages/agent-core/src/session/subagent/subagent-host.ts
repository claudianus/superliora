import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '../../agent';
import {
  DEFAULT_COMPACTION_CONFIG,
  DefaultCompactionStrategy,
  PipelineStrategy,
  ToolCollapseStrategy,
  resolveCompactionBlockRatio,
} from '../../agent/compaction';
import { userCancellationReason } from '../../utils/abort';
import type { Session } from '../index';
import {
  SubagentBatch,
  resolveSwarmMaxConcurrency,
  type SubagentResult,
  type SubagentSuspendedEvent,
  type QueuedSubagentTask,
} from './subagent-batch';
import {
  DEFAULT_SUBAGENT_DEADLINE_MS,
  DEFAULT_SUBAGENT_TIMEOUT_DESCRIPTION,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  SUBAGENT_DEADLINE_ENV,
  SubagentDeadlineError,
  SubagentMaxTokensError,
  enrichPermanentProviderFailure,
  isPermanentProviderFailureMessage,
  isPermanentSubagentProviderFailure,
  isSubagentDeadlineError,
  isSubagentMaxTokensError,
  resolveSubagentDeadlineMs,
} from './subagent-errors';
import {
  runWithActiveChild as runActiveChildLifecycle,
  type ActiveChildEntry,
} from './subagent-run-lifecycle';
import { emitSubagentFailed, emitSubagentSpawned } from './subagent-events';
import {
  assertContractCompiles,
  claimChildOwnership,
  configureSubagentChild,
  ensureIdleSubagent,
  resolveSubagentProfile,
} from './subagent-child-config';
import * as subagentCompletionFlow from './subagent-completion-flow';
import { createSideChannelSubagent } from './subagent-side-channel';
import type {
  RunSubagentOptions,
  SpawnSubagentOptions,
  SubagentCompletion,
  SubagentHandle,
} from './subagent-host-types';

export {
  DEFAULT_SUBAGENT_DEADLINE_MS,
  DEFAULT_SUBAGENT_TIMEOUT_DESCRIPTION,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  SUBAGENT_DEADLINE_ENV,
  SubagentDeadlineError,
  SubagentMaxTokensError,
  isPermanentProviderFailureMessage,
  isPermanentSubagentProviderFailure,
  isSubagentDeadlineError,
  isSubagentMaxTokensError,
  resolveSubagentDeadlineMs,
} from './subagent-errors';
export {
  collectSubagentProgressStats,
  describeSubagentToolDetail,
  type SubagentProgressStats,
} from './subagent-progress-preview';
export { __testing__ } from './subagent-run-lifecycle';
export type {
  QueuedSubagentRunResult,
  QueuedSubagentTask,
  ResumeQueuedSubagentTask,
  RunSubagentOptions,
  SpawnQueuedSubagentTask,
  SpawnSubagentOptions,
  SubagentCompletion,
  SubagentHandle,
} from './subagent-host-types';

export class SessionSubagentHost {
  private readonly activeChildren = new Map<string, ActiveChildEntry>();

  constructor(
    private readonly session: Session,
    private readonly ownerAgentId: string,
  ) {}

  get parentAgentId(): string {
    return this.ownerAgentId;
  }

  parentLoopToolNames(): readonly string[] {
    return this.session.getReadyAgent(this.ownerAgentId)?.tools.loopTools.map((tool) => tool.name) ?? [];
  }

  hasActiveForegroundChildren(): boolean {
    return Array.from(this.activeChildren.values()).some((child) => !child.runInBackground);
  }

  /**
   * Forward a mid-run steer to every child that is running a turn right now,
   * so it can adjust before the next phase checkpoint. Mirrors the
   * main agent's `turn.steer`: an active child buffers the input and flushes it
   * at its own next step boundary. Children without an active turn are skipped
   * — they receive the steer via the phase-checkpoint handoff instead. Returns
   * the number of children the steer was forwarded to.
   */
  steerRunningChildren(input: readonly ContentPart[]): number {
    let forwarded = 0;
    for (const agentId of this.activeChildren.keys()) {
      const child = this.session.getReadyAgent(agentId);
      if (child === undefined || !child.turn.hasActiveTurn) continue;
      child.turn.steer(input);
      forwarded += 1;
    }
    return forwarded;
  }

  /**
   * Steer a specific child agent by id. Returns true if the steer was
   * delivered, false if the child is not running an active turn.
   */
  steerChild(agentId: string, input: readonly ContentPart[]): boolean {
    if (!this.activeChildren.has(agentId)) return false;
    const child = this.session.getReadyAgent(agentId);
    if (child === undefined || !child.turn.hasActiveTurn) return false;
    child.turn.steer(input);
    return true;
  }

  async spawn(options: SpawnSubagentOptions): Promise<SubagentHandle> {
    options.signal.throwIfAborted();

    const parent = await this.session.ensureAgentResumed(this.ownerAgentId);
    await assertContractCompiles(parent, options);
    const profile = resolveSubagentProfile(parent, options.profileName, options.profileBaseName);
    /** Subagent windows compact earlier than parent (MapReduce-style handoff). */
    const subTriggerRatio = 0.65;
    const { id, agent } = await this.session.createAgent(
      {
        type: 'sub',
        generate: parent.rawGenerate,
        compactionStrategy: new PipelineStrategy(
          [new ToolCollapseStrategy(2)],
          new DefaultCompactionStrategy(
            () => parent.config.modelCapabilities.max_context_tokens,
            {
              ...DEFAULT_COMPACTION_CONFIG,
              triggerRatio: subTriggerRatio,
              blockRatio: resolveCompactionBlockRatio(subTriggerRatio),
            },
          ),
        ),
      },
      { parentAgentId: this.ownerAgentId, swarmItem: options.swarmItem },
    );
    claimChildOwnership(agent, id, options);
    const completion = this.runWithActiveChild(id, options, async (runOptions) => {
      const modelAlias = subagentCompletionFlow.spawnModelAlias(
        profile.name,
        options.profileBaseName,
        parent,
        { preferVisionModel: options.preferVisionModel },
      );
      emitSubagentSpawned(parent, this.ownerAgentId, id, profile.name, runOptions, modelAlias);
      try {
        await configureSubagentChild(
          this.session,
          parent,
          agent,
          profile,
          id,
          runOptions,
          options.profileBaseName,
        );
      } catch (error) {
        emitSubagentFailed(parent, id, runOptions, error);
        throw error;
      }
      return  subagentCompletionFlow.runPromptTurnWithModelFallback(
        parent,
        id,
        agent,
        profile.name,
        runOptions,
      );
    });
    return {
      agentId: id,
      profileName: profile.name,
      resumed: false,
      completion,
    };
  }

  async resume(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle> {
    options.signal.throwIfAborted();
    const { parent, child, profileName } = await ensureIdleSubagent(
      this.session,
      this.ownerAgentId,
      this.activeChildren,
      agentId,
    );
    child.swarmFileLease = { ownerId: agentId, runId: options.parentToolCallId };
    subagentCompletionFlow.prepareResumeCheckpoint(agentId, child);
    const completion = this.runWithActiveChild(agentId, options, async (runOptions) => {
      const modelSelection = subagentCompletionFlow.resolveResumeModelSelection(profileName, parent);
      emitSubagentSpawned(
        parent,
        this.ownerAgentId,
        agentId,
        profileName,
        runOptions,
        modelSelection.alias,
      );
      try {
        child.config.update({
          modelAlias: modelSelection.alias,
          thinkingLevel: modelSelection.thinkingLevel,
        });
        return await subagentCompletionFlow.runPromptTurn(
          parent,
          agentId,
          child,
          profileName,
          runOptions,
        );
      } catch (error) {
        const failure = enrichPermanentProviderFailure(error, child);
        emitSubagentFailed(parent, agentId, runOptions, failure);
        throw failure;
      }
    });
    return { agentId, profileName, resumed: true, completion };
  }

  async retry(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle> {
    options.signal.throwIfAborted();
    const { parent, child, profileName } = await ensureIdleSubagent(
      this.session,
      this.ownerAgentId,
      this.activeChildren,
      agentId,
    );
    const completion = this.runWithActiveChild(agentId, options, async (runOptions) => {
      try {
        runOptions.signal.throwIfAborted();
        return await subagentCompletionFlow.retrySubagentTurn(
          parent,
          agentId,
          child,
          profileName,
          runOptions,
        );
      } catch (error) {
        const failure = enrichPermanentProviderFailure(error, child);
        emitSubagentFailed(parent, agentId, runOptions, failure);
        throw failure;
      }
    });
    return { agentId, profileName, resumed: true, completion };
  }

  async runQueued<T>(tasks: readonly QueuedSubagentTask<T>[]): Promise<Array<SubagentResult<T>>> {
    const maxConcurrency = resolveSwarmMaxConcurrency();
    return new SubagentBatch(this, tasks, { maxConcurrency }).run();
  }

  suspended(event: SubagentSuspendedEvent): void {
    const parent = this.session.getReadyAgent?.(this.ownerAgentId);
    parent?.emitEvent({
      type: 'subagent.suspended',
      subagentId: event.agentId,
      reason: event.reason,
    });
  }

  async startBtw(): Promise<string> {
    return createSideChannelSubagent(this.session, this.ownerAgentId);
  }

  cancelAll(reason: unknown = userCancellationReason()): void {
    const foregroundChildren = Array.from(this.activeChildren).filter(
      ([, child]) => !child.runInBackground,
    );
    for (const [childId, child] of foregroundChildren) {
      this.session.getReadyAgent(childId)?.subagentHost?.cancelAll(reason);
      child.controller.abort(reason);
    }
  }

  markActiveChildDetached(agentId: string): void {
    const child = this.activeChildren.get(agentId);
    if (child !== undefined) child.runInBackground = true;
  }

  async getProfileName(agentId: string): Promise<string | undefined> {
    const metadata = this.session.metadata.agents[agentId];
    if (metadata?.type !== 'sub' || metadata.parentAgentId !== this.ownerAgentId) {
      return undefined;
    }
    return (await this.session.ensureAgentResumed(agentId)).config.profileName;
  }

  getSwarmItem(agentId: string): string | undefined {
    const metadata = this.session.metadata.agents[agentId];
    if (metadata?.type !== 'sub' || metadata.parentAgentId !== this.ownerAgentId) {
      return undefined;
    }
    return metadata.swarmItem;
  }

  private runWithActiveChild(
    childId: string,
    options: RunSubagentOptions,
    run: (options: RunSubagentOptions) => Promise<SubagentCompletion>,
  ): Promise<SubagentCompletion> {
    return runActiveChildLifecycle(this.activeChildren, childId, options, run);
  }
}

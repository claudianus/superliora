import {
  APIProviderRateLimitError,
  APIStatusError,
  isProviderRateLimitError,
  isRetryableGenerateError,
  type ContentPart,
  type TokenUsage,
} from '@superliora/kosong';

import type { Agent } from '../agent';
import {
  DEFAULT_COMPACTION_CONFIG,
  DefaultCompactionStrategy,
  PipelineStrategy,
  ToolCollapseStrategy,
  resolveCompactionBlockRatio,
} from '../agent/compaction';
import type { PromptOrigin } from '../agent/context';
import {
  isRetryableProviderFailure,
  listSwitchableFailoverModels,
} from '../agent/provider-failover';
import { ErrorCodes, toKimiErrorPayload, type LioraErrorPayload } from '../errors';
import { DenyAllPermissionPolicy } from '../agent/permission/policies/deny-all';
import { InMemoryAgentRecordPersistence } from '../agent/records';
import { isAbortError } from '../loop/errors';
import { resolveExpertCatalogEntry } from '../expert-agents/catalog-extensions';
import { renderExpertSystemPrompt, resolveExpertWhenToUse } from '../expert-agents/expert-persona';
import type { ExpertCatalogEntry } from '../expert-agents/types';
import {
  deliverSwarmBusCoordination,
  emitSwarmCollaborationMessage,
  emitSwarmCollaborationMention,
  startSwarmStandupTimer,
  type SwarmStandupTimerHandle,
  type SwarmStandupTimerInput,
} from './swarm-bus-coordination';
import {
  SwarmChannelTool,
} from '../tools/builtin/collaboration/swarm-channel';
import {
  TODO_STORE_KEY,
  type TodoItem,
  updateSwarmOrchestrationTodoStatus,
} from '../tools/builtin/state/todo-list';
import { RunProjectChecksTool } from '../tools/builtin/ops/run-project-checks';
import {
  DEFAULT_AGENT_PROFILES,
  prepareSystemPromptContext,
  type ResolvedAgentProfile,
} from '../profile';
import {
  linkAbortSignal,
  userCancellationReason,
} from '../utils/abort';
import { resolveSubagentModelAlias } from '../utils/cheap-model';
import { sharedCredentialHealthStore } from '@superliora/oauth';
import { checkContractFile } from './contract-check';
import { maybeRunRollingCheck, recordChildCompletion } from './rolling-integration';
import { collectGitContext } from './git-context';
import {
  buildCheckpointRecoveryReminder,
  clearSubagentCheckpoint,
  readSubagentCheckpoint,
  writeSubagentCheckpoint,
} from './subagent-checkpoint';
import { getDefaultSwarmFileLeaseRegistry } from './swarm-file-lease';
import {
  buildSubagentResultContract,
  collectFilesChanged,
  deriveVerificationPackageDir,
  snapshotGitWork,
  verdictFromCheckOutcomes,
  VERIFICATION_NOT_RUN,
  type GitWorkSnapshot,
  type ProjectCheckOutcomeLike,
  type SubagentResultContract,
  type SubagentVerificationStatus,
} from './subagent-result-contract';
import type { Session } from './index';
import {
  SubagentBatch,
  resolveSwarmMaxConcurrency,
  type SubagentResult,
  type SubagentSuspendedEvent,
  type QueuedSubagentTask,
} from './subagent-batch';
import SUMMARY_CONTINUATION_PROMPT from './summary-continuation.md?raw';

export const DEFAULT_SUBAGENT_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_SUBAGENT_TIMEOUT_DESCRIPTION = '30 minutes';

/**
 * How many fallback-model hops a spawned subagent may take after a retryable
 * provider failure exhausts the in-loop retries (A -> B -> C at most).
 */
const SUBAGENT_MODEL_FALLBACK_HOPS = 2;

export type {
  SubagentResult as QueuedSubagentRunResult,
  QueuedSubagentTask,
  ResumeQueuedSubagentTask,
  SpawnQueuedSubagentTask,
} from './subagent-batch';

/**
 * A subagent summary shorter than this many characters triggers one
 * follow-up turn that asks the subagent to expand it, so the parent
 * agent receives a technically complete handoff.
 */
const SUMMARY_MIN_LENGTH = 200;

/** Per-check timeout for the completion verification gate (T4-4). */
const COMPLETION_CHECK_TIMEOUT_MS = 180_000;
/** Overall ceiling for the completion verification gate (T4-4). */
const COMPLETION_VERIFICATION_TOTAL_MS = 600_000;

/** Cadence for subagent.progress telemetry (T3-7). */
const SUBAGENT_PROGRESS_INTERVAL_MS = 5_000;
/** Silence window before a subagent is reported stalled (T3-7). */
const SUBAGENT_STALL_MS = 300_000;
/** Checkpoint cadence: snapshot every N completed tool calls (T4-5). */
const CHECKPOINT_TOOL_DELTA = 10;
/** Finishing mode starts when this much budget remains (T4-5). */
const SUBAGENT_FINISHING_WINDOW_MS = 5 * 60 * 1000;
const SUBAGENT_FINISHING_REMINDER = [
  'Time budget is nearly exhausted — enter finishing mode now:',
  '- do not start new implementation work',
  '- run the verification still owed for completed work',
  '- then write the final structured summary of what is done and what remains',
].join('\n');
const SUMMARY_CONTINUATION_ATTEMPTS = 1;
const HOOK_TEXT_PREVIEW_LENGTH = 500;
const SUBAGENT_MAX_TOKENS_ERROR =
  'Subagent turn failed before completing its final summary: reason=max_tokens';

/**
 * Typed error thrown when a subagent turn exhausts its output token budget
 * before producing the required final summary. Callers (subagent-batch,
 * recovery prompts) can identify this class with `instanceof` or the
 * `code` discriminant instead of substring-matching the human message.
 */
export class SubagentMaxTokensError extends Error {
  readonly code = 'subagent_max_tokens' as const;

  constructor(message: string = SUBAGENT_MAX_TOKENS_ERROR) {
    super(message);
    this.name = 'SubagentMaxTokensError';
  }
}

/** Type guard for {@link SubagentMaxTokensError} thrown by `runChildTurnToCompletion`. */
export function isSubagentMaxTokensError(error: unknown): error is SubagentMaxTokensError {
  return error instanceof SubagentMaxTokensError;
}
const TOOL_CALL_DISABLED_MESSAGE =
  'Tool calls are disabled for side questions. Answer with text only.';
const SUBAGENT_PROMPT_ORIGIN: PromptOrigin = { kind: 'system_trigger', name: 'subagent' };
const SIDE_QUESTION_SYSTEM_REMINDER = `
This is a side-channel conversation with the user. Answer from what you already know.

- Lightweight instance; main agent continues independently.
- All tool calls are disabled and will be rejected. Tool definitions are visible for cache only — do not call them.
- Text only; say when you do not know.
`;

export interface RunSubagentOptions {
  readonly parentToolCallId: string;
  readonly parentToolCallUuid?: string;
  readonly prompt: string;
  readonly description: string;
  readonly swarmIndex?: number;
  readonly swarmItem?: string;
  readonly runInBackground: boolean;
  readonly signal: AbortSignal;
  /** Wall-clock budget for the run; drives finishing mode and telemetry (T4-5). */
  readonly timeoutMs?: number;
  /** Shared contract file that must compile before the subagent is spawned (T4-3). */
  readonly contractPath?: string;
  /** File paths the subagent owns; claimed at spawn so overlaps fail fast (T4-2). */
  readonly ownership?: readonly string[];
  readonly onReady?: () => void;
  readonly suppressRateLimitFailureEvent?: boolean;
}

export interface SpawnSubagentOptions extends RunSubagentOptions {
  readonly profileName: string;
  readonly profileBaseName?: string;
}

/** Optional model-fallback progress attached to `subagent.failed` events. */
interface SubagentFailedDetails {
  readonly retryAttempt?: number;
  readonly retryLimit?: number;
  readonly fellBackToModel?: string;
}

type SubagentCompletion = {
  readonly result: string;
  readonly usage?: TokenUsage;
  readonly contract?: SubagentResultContract;
};

export type SubagentHandle = {
  readonly agentId: string;
  readonly profileName: string;
  readonly resumed: boolean;
  readonly completion: Promise<SubagentCompletion>;
};


function isModelAliasHealthy(
  alias: string | undefined,
  models: Record<string, { provider?: string }> | undefined,
): boolean {
  if (alias === undefined || models === undefined) return true;
  const entry = models[alias];
  if (entry === undefined) return true;
  const provider = entry.provider;
  if (provider === undefined || provider.length === 0) return true;
  return sharedCredentialHealthStore.isAvailable(provider);
}

export class SessionSubagentHost {
  private readonly activeChildren = new Map<
    string,
    {
      readonly controller: AbortController;
      runInBackground: boolean;
    }
  >();

  constructor(
    private readonly session: Session,
    private readonly ownerAgentId: string,
  ) {}

  get parentAgentId(): string {
    return this.ownerAgentId;
  }

  hasActiveForegroundChildren(): boolean {
    return Array.from(this.activeChildren.values()).some((child) => !child.runInBackground);
  }

  /**
   * Forward a mid-run steer to every child that is running a turn right now,
   * so it can adjust before the next UltraSwarm phase checkpoint. Mirrors the
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

  startSwarmStandupTimer(
    parent: Agent,
    store: import('../tools/store').ToolStore,
    input: SwarmStandupTimerInput,
    intervalMs?: number,
  ): SwarmStandupTimerHandle {
    return startSwarmStandupTimer(this.session, parent, store, input, intervalMs);
  }

  async spawn(options: SpawnSubagentOptions): Promise<SubagentHandle> {
    options.signal.throwIfAborted();

    const parent = await this.session.ensureAgentResumed(this.ownerAgentId);
    await this.assertContractCompiles(parent, options);
    const profile = this.resolveProfile(parent, options.profileName, options.profileBaseName);
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
    this.claimChildOwnership(agent, id, options);
    const completion = this.runWithActiveChild(id, options, async (runOptions) => {
      const modelAlias = resolveSubagentModelAlias(
        profile.name,
        options.profileBaseName,
        parent.config.modelAlias,
        parent.kimiConfig?.models,
        parent.kimiConfig?.loopControl?.explorationModel,
        {
          isAliasHealthy: (alias) => isModelAliasHealthy(alias, parent.kimiConfig?.models),
        },
      );
      this.emitSubagentSpawned(parent, id, profile.name, runOptions, modelAlias);
      try {
        await this.configureChild(parent, agent, profile, id, runOptions, options.profileBaseName);
      } catch (error) {
        this.emitSubagentFailed(parent, id, runOptions, error);
        throw error;
      }
      return await this.runPromptTurnWithModelFallback(parent, id, agent, profile.name, runOptions);
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
    const { parent, child, profileName } = await this.ensureIdleSubagent(agentId);
    child.swarmFileLease = { ownerId: agentId, runId: options.parentToolCallId };
    const checkpoint = readSubagentCheckpoint(agentId);
    if (checkpoint !== undefined) {
      child.context.appendSystemReminder(buildCheckpointRecoveryReminder(checkpoint), {
        kind: 'system_trigger',
        name: 'subagent-checkpoint',
      });
      clearSubagentCheckpoint(agentId);
    }
    const completion = this.runWithActiveChild(agentId, options, async (runOptions) => {
      const modelAlias = resolveSubagentModelAlias(
        profileName,
        undefined,
        parent.config.modelAlias,
        parent.kimiConfig?.models,
        parent.kimiConfig?.loopControl?.explorationModel,
        {
          isAliasHealthy: (alias) =>
            isModelAliasHealthy(alias, parent.kimiConfig?.models),
        },
      );
      this.emitSubagentSpawned(parent, agentId, profileName, runOptions, modelAlias);
      try {
        // Read-only explore subagents run on a cheap configured model when one
        // exists; every other profile keeps the parent agent's current model.
        child.config.update({
          modelAlias,
        });
        this.attachUltraSwarmChannelIfNeeded(parent, child, agentId, runOptions, profileName);
        return await this.runPromptTurn(parent, agentId, child, profileName, runOptions);
      } catch (error) {
        this.emitSubagentFailed(parent, agentId, runOptions, error);
        throw error;
      }
    });
    return { agentId, profileName, resumed: true, completion };
  }

  async retry(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle> {
    options.signal.throwIfAborted();
    const { parent, child, profileName } = await this.ensureIdleSubagent(agentId);
    const completion = this.runWithActiveChild(agentId, options, async (runOptions) => {
      try {
        runOptions.signal.throwIfAborted();
        // Read-only explore subagents run on a cheap configured model when one
        // exists; every other profile keeps the parent agent's current model.
        child.config.update({
          modelAlias: resolveSubagentModelAlias(
            profileName,
            undefined,
            parent.config.modelAlias,
            parent.kimiConfig?.models,
            parent.kimiConfig?.loopControl?.explorationModel,
            {
              isAliasHealthy: (alias) =>
                isModelAliasHealthy(alias, parent.kimiConfig?.models),
            },
          ),
        });
        this.emitSubagentStarted(parent, agentId, runOptions);
        const workSnapshot = await this.snapshotChildWork(child);
        const turnId = child.turn.retry('agent-host');
        if (turnId === null) {
          throw new Error(`Agent instance "${agentId}" could not start a retry turn`);
        }
        this.observeFirstRequest(child, runOptions);
        return await this.waitForChildCompletion(
          parent,
          agentId,
          child,
          profileName,
          runOptions,
          workSnapshot,
        );
      } catch (error) {
        this.emitSubagentFailed(parent, agentId, runOptions, error);
        throw error;
      }
    });
    return { agentId, profileName, resumed: true, completion };
  }

  private async ensureIdleSubagent(
    agentId: string,
  ): Promise<{ readonly parent: Agent; readonly child: Agent; readonly profileName: string }> {
    const parent = await this.session.ensureAgentResumed(this.ownerAgentId);
    const metadata = this.session.metadata.agents[agentId];
    if (metadata?.type !== 'sub') {
      throw new Error(`Agent instance "${agentId}" is not a subagent`);
    }
    if (metadata.parentAgentId !== this.ownerAgentId) {
      throw new Error(`Agent instance "${agentId}" does not belong to this parent agent`);
    }
    const child = await this.session.ensureAgentResumed(agentId);
    if (this.activeChildren.has(agentId) || child.turn.hasActiveTurn) {
      throw new Error(`Agent instance "${agentId}" is already running and cannot run concurrently`);
    }

    const profileName = child.config.profileName ?? 'subagent';
    return { parent, child, profileName };
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
    const parent = await this.session.ensureAgentResumed(this.ownerAgentId);
    const { id, agent: child } = await this.session.createAgent(
      {
        type: 'sub',
        generate: parent.rawGenerate,
        persistence: new InMemoryAgentRecordPersistence(),
      },
      { parentAgentId: this.ownerAgentId, persistMetadata: false },
    );

    child.config.update({
      modelAlias: parent.config.modelAlias,
      thinkingLevel: parent.config.thinkingLevel,
      systemPrompt: parent.config.systemPrompt,
    });
    child.tools.copyLoopToolsFrom(parent.tools);
    child.context.useProjectedHistoryFrom(parent.context);
    child.context.appendSystemReminder(SIDE_QUESTION_SYSTEM_REMINDER.trim(), {
      kind: 'system_trigger',
      name: 'btw',
    });
    child.permission.policies.unshift(new DenyAllPermissionPolicy(TOOL_CALL_DISABLED_MESSAGE));
    return id;
  }

  cancelAll(reason: unknown = userCancellationReason()): void {
    const foregroundChildren = Array.from(this.activeChildren).filter(
      ([, child]) => !child.runInBackground,
    );
    for (const [childId, child] of foregroundChildren) {
      this.session.getReadyAgent(childId)?.subagentHost?.cancelAll(reason);
      // Abort with the cancel reason (a user interruption by default) so the
      // subagent's in-flight tools report the cause accurately to the model.
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

  private resolveProfile(
    parent: Agent,
    profileName: string,
    profileBaseName?: string,
  ): ResolvedAgentProfile {
    const profile =
      DEFAULT_AGENT_PROFILES[parent.config.profileName ?? 'agent']?.subagents?.[profileName] ??
      DEFAULT_AGENT_PROFILES['agent']?.subagents?.[profileName];
    if (profile !== undefined) return profile;

    const expert = resolveExpertCatalogEntry(profileName);
    if (expert === undefined) {
      throw new Error(`Subagent profile "${profileName}" was not found`);
    }

    const baseName = profileBaseName ?? 'coder';
    const baseProfile =
      DEFAULT_AGENT_PROFILES[parent.config.profileName ?? 'agent']?.subagents?.[baseName] ??
      DEFAULT_AGENT_PROFILES['agent']?.subagents?.[baseName];
    if (baseProfile === undefined) {
      throw new Error(`Subagent profile "${baseName}" was not found`);
    }

    return createExpertSubagentProfile(expert, baseProfile);
  }

  private runWithActiveChild(
    childId: string,
    options: RunSubagentOptions,
    run: (options: RunSubagentOptions) => Promise<SubagentCompletion>,
  ): Promise<SubagentCompletion> {
    const controller = new AbortController();
    const unlinkAbortSignal = linkAbortSignal(options.signal, controller);
    this.activeChildren.set(childId, {
      controller,
      runInBackground: options.runInBackground,
    });

    return run({ ...options, signal: controller.signal }).finally(() => {
      unlinkAbortSignal();
      this.activeChildren.delete(childId);
    });
  }

  /**
   * Run the child prompt turn, hopping through the child model's configured
   * `fallbackModels` when a turn fails with a retryable provider failure
   * (transient 5xx / body-less 400 gateway glitches, rate limits) — at most
   * {@link SUBAGENT_MODEL_FALLBACK_HOPS} hops. Each intermediate failure emits
   * `subagent.failed` with `retryAttempt` / `retryLimit`; the final failure
   * carries `fellBackToModel` when at least one hop happened, then rethrows.
   * Without candidates or for non-retryable failures this behaves exactly like
   * a single failed emit + rethrow.
   */
  private async runPromptTurnWithModelFallback(
    parent: Agent,
    childId: string,
    child: Agent,
    profileName: string,
    options: RunSubagentOptions,
  ): Promise<SubagentCompletion> {
    const fallbackAliases = listSwitchableFailoverModels(child).map((option) => option.alias);
    const maxFallbackHops = Math.min(SUBAGENT_MODEL_FALLBACK_HOPS, fallbackAliases.length);
    let lastAttemptedAlias = child.config.modelAlias;

    for (let hop = 0; ; hop += 1) {
      try {
        return await this.runPromptTurn(parent, childId, child, profileName, options);
      } catch (error) {
        const nextAlias =
          hop < maxFallbackHops && isRetryableSubagentProviderFailure(error)
            ? fallbackAliases[hop]
            : undefined;
        if (nextAlias === undefined) {
          this.emitSubagentFailed(parent, childId, options, error, {
            ...(hop > 0 && lastAttemptedAlias !== undefined
              ? { fellBackToModel: lastAttemptedAlias }
              : {}),
          });
          throw error;
        }
        this.emitSubagentFailed(parent, childId, options, error, {
          retryAttempt: hop + 1,
          retryLimit: maxFallbackHops,
        });
        child.config.update({ modelAlias: nextAlias });
        lastAttemptedAlias = nextAlias;
      }
    }
  }

  private async runPromptTurn(
    parent: Agent,
    childId: string,
    child: Agent,
    profileName: string,
    options: RunSubagentOptions,
  ): Promise<SubagentCompletion> {
    options.signal.throwIfAborted();
    await this.triggerSubagentStart(parent, profileName, options.prompt, options.signal);
    options.signal.throwIfAborted();

    let childPrompt = options.prompt;
    if (profileName === 'explore') {
      const gitContext = await collectGitContext(child.kaos, child.config.cwd);
      if (gitContext) childPrompt = `${gitContext}\n\n${childPrompt}`;
    }

    this.emitSubagentStarted(parent, childId, options);
    const workSnapshot = await this.snapshotChildWork(child);
    const turnId = child.turn.prompt([{ type: 'text', text: childPrompt }], SUBAGENT_PROMPT_ORIGIN);
    if (turnId === null) {
      throw new Error(`Agent instance "${childId}" could not start a turn`);
    }
    this.observeFirstRequest(child, options);
    return this.waitForChildCompletion(parent, childId, child, profileName, options, workSnapshot);
  }

  private async waitForChildCompletion(
    parent: Agent,
    childId: string,
    child: Agent,
    profileName: string,
    options: RunSubagentOptions,
    workSnapshot: GitWorkSnapshot,
  ): Promise<SubagentCompletion> {
    const disposeProgress = this.startProgressReporter(
      parent,
      child,
      childId,
      profileName,
      options.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS,
    );
    try {
      return await this.collectChildCompletion(
        parent,
        child,
        childId,
        profileName,
        options,
        workSnapshot,
      );
    } finally {
      disposeProgress();
    }
  }

  private async collectChildCompletion(
    parent: Agent,
    child: Agent,
    childId: string,
    profileName: string,
    options: RunSubagentOptions,
    workSnapshot: GitWorkSnapshot,
  ): Promise<SubagentCompletion> {
    await runChildTurnToCompletion(child, options.signal);

    await child.fullCompaction.ensureBelowHandoffThreshold(options.signal);

    // A subagent that returns an overly terse summary leaves the parent
    // agent under-informed. Give it a bounded number of chances to expand
    // the handoff; if it is still short after that, accept it as-is rather
    // than retrying indefinitely.
    let result = lastAssistantText(child);
    let remainingContinuations = SUMMARY_CONTINUATION_ATTEMPTS;
    while (remainingContinuations > 0 && result.length < SUMMARY_MIN_LENGTH) {
      remainingContinuations -= 1;
      options.signal.throwIfAborted();
      child.turn.prompt([{ type: 'text', text: SUMMARY_CONTINUATION_PROMPT }], SUBAGENT_PROMPT_ORIGIN);
      await runChildTurnToCompletion(child, options.signal);
      result = lastAssistantText(child);
    }
    const usage = child.usage.data().total;
    if (options.swarmItem !== undefined) {
      updateSwarmOrchestrationTodoStatus(parent.tools.getStore(), options.swarmItem, 'done');
    }
    const contract = await this.buildChildResultContract(
      child,
      childId,
      profileName,
      result,
      workSnapshot,
      options.signal,
    );
    parent.emitEvent({
      type: 'subagent.completed',
      subagentId: childId,
      resultSummary: result,
      usage,
      contextTokens: child.context.tokenCount,
    });
    this.triggerSubagentStop(parent, profileName, result);
    clearSubagentCheckpoint(childId);
    getDefaultSwarmFileLeaseRegistry().releaseAll(options.parentToolCallId);
    if (options.swarmItem !== undefined) {
      recordChildCompletion(options.parentToolCallId, contract.files_changed);
      try {
        await maybeRunRollingCheck(options.parentToolCallId, parent.kaos, parent.config.cwd);
      } catch {
        /* rolling integration must never break completion */
      }
    }
    return { result, usage, contract };
  }

  /**
   * All-mode file lease (harness reform T4-2): every spawned child gets a
   * lease identity so its edits conflict-check against other owners, and any
   * declared ownership is pre-claimed so overlaps fail at fan-out instead of
   * mid-run.
   */
  private claimChildOwnership(
    child: Agent,
    childId: string,
    options: RunSubagentOptions,
  ): void {
    const runId = options.parentToolCallId;
    child.swarmFileLease = { ownerId: childId, runId };
    const declared = options.ownership ?? [];
    if (declared.length === 0) return;
    const registry = getDefaultSwarmFileLeaseRegistry();
    for (const rawPath of declared) {
      const result = registry.claim(rawPath, childId, runId);
      if (result.ok) continue;
      registry.releaseAll(runId);
      const holder = result.conflict.holder;
      throw new Error(
        `Ownership conflict on ${result.conflict.path}: already claimed by owner=${holder.ownerId} run=${holder.runId}. Resolve the overlap before fan-out.`,
      );
    }
  }

  /**
   * Contract-first guard (harness reform T4-3): refuse fan-out while the
   * shared contract file no longer compiles, so conflicting type changes are
   * caught by the compiler before agents diverge.
   */
  private async assertContractCompiles(
    parent: Agent,
    options: RunSubagentOptions,
  ): Promise<void> {
    const contractPath = options.contractPath?.trim();
    if (contractPath === undefined || contractPath.length === 0) return;
    const check = await checkContractFile(parent.kaos, parent.config.cwd, contractPath);
    if (check.ok) return;
    const detail =
      check.output !== undefined && check.output.length > 0 ? `\n${check.output}` : '';
    throw new Error(
      `Contract file did not compile (${check.kind}) — fix it before fan-out: ${contractPath}${detail}`,
    );
  }

  private async snapshotChildWork(child: Agent): Promise<GitWorkSnapshot> {
    try {
      return await snapshotGitWork(child.kaos, child.config.cwd);
    } catch {
      return { head: undefined, dirtyFiles: [] };
    }
  }

  private async buildChildResultContract(
    child: Agent,
    childId: string,
    profileName: string,
    summary: string,
    workSnapshot: GitWorkSnapshot,
    signal: AbortSignal | undefined,
  ): Promise<SubagentResultContract> {
    let filesChanged: string[] = [];
    try {
      filesChanged = await collectFilesChanged(child.kaos, child.config.cwd, workSnapshot);
    } catch {
      filesChanged = [];
    }
    const verification = await this.runCompletionVerification(
      child,
      profileName,
      filesChanged,
      signal,
    );
    return buildSubagentResultContract({
      agentId: childId,
      profile: profileName,
      summary,
      filesChanged,
      verification,
    });
  }

  /**
   * Completion gate (harness reform T4-4): when the child's change set is
   * scoped to a single workspace package, run that package's test /
   * typecheck / lint scripts ourselves and record the verdicts on the
   * result contract. Read-only profiles and ambiguous scopes skip the gate
   * (verdicts stay `not_run`) rather than paying for a repo-wide run.
   */
  private async runCompletionVerification(
    child: Agent,
    profileName: string,
    filesChanged: readonly string[],
    signal: AbortSignal | undefined,
  ): Promise<SubagentVerificationStatus> {
    if (profileName === 'explore') return VERIFICATION_NOT_RUN;
    const packageDir = deriveVerificationPackageDir(filesChanged);
    if (packageDir === undefined) return VERIFICATION_NOT_RUN;
    try {
      const tool = new RunProjectChecksTool(child.kaos, child.config.cwd);
      const execution = await tool.resolveExecution({
        checks: ['test', 'typecheck', 'lint'],
        packageDir,
        timeoutMs: COMPLETION_CHECK_TIMEOUT_MS,
      });
      if (execution.isError === true) return VERIFICATION_NOT_RUN;
      const gateSignal =
        signal === undefined
          ? AbortSignal.timeout(COMPLETION_VERIFICATION_TOTAL_MS)
          : AbortSignal.any([signal, AbortSignal.timeout(COMPLETION_VERIFICATION_TOTAL_MS)]);
      const result = await execution.execute({
        turnId: 'subagent-verification',
        toolCallId: 'subagent-verification',
        signal: gateSignal,
      });
      const text = typeof result.output === 'string' ? result.output : '';
      const parsed = JSON.parse(text) as {
        readonly checks?: readonly ProjectCheckOutcomeLike[];
      };
      const checks = parsed.checks ?? [];
      return {
        tests: verdictFromCheckOutcomes(checks, 'test'),
        typecheck: verdictFromCheckOutcomes(checks, 'typecheck'),
        lint: verdictFromCheckOutcomes(checks, 'lint'),
      };
    } catch {
      return VERIFICATION_NOT_RUN;
    }
  }

  /**
   * Live telemetry for background subagents (harness reform T3-7): emits
   * `subagent.progress` every few seconds with the last tool, tool count,
   * elapsed time, and token spend, plus a one-shot `subagent.stalled` when
   * no tool call has happened for the stall window.
   */
  private startProgressReporter(
    parent: Agent,
    child: Agent,
    childId: string,
    profileName: string,
    budgetMs: number,
  ): () => void {
    const startedAt = Date.now();
    let lastToolCount = -1;
    let lastChangeAt = startedAt;
    let stalledReported = false;
    let finishingNotified = false;
    let lastCheckpointToolCount = 0;
    let checkpointInFlight = false;
    const timer = setInterval(() => {
      const stats = collectSubagentProgressStats(child);
      const now = Date.now();
      const elapsedMs = now - startedAt;
      const budgetRemainingMs = Math.max(0, budgetMs - elapsedMs);
      const finishing = budgetRemainingMs <= SUBAGENT_FINISHING_WINDOW_MS;
      parent.emitEvent({
        type: 'subagent.progress',
        subagentId: childId,
        subagentName: profileName,
        lastTool: stats.lastTool,
        lastTarget: stats.lastTarget,
        toolCount: stats.toolCount,
        elapsedMs,
        tokens: stats.tokens,
        budgetMs,
        budgetRemainingMs,
        finishing,
      });
      if (finishing && !finishingNotified) {
        finishingNotified = true;
        child.context.appendSystemReminder(SUBAGENT_FINISHING_REMINDER, {
          kind: 'system_trigger',
          name: 'subagent-finishing',
        });
      }
      if (stats.toolCount !== lastToolCount) {
        lastToolCount = stats.toolCount;
        lastChangeAt = now;
        stalledReported = false;
      } else if (!stalledReported && now - lastChangeAt >= SUBAGENT_STALL_MS) {
        stalledReported = true;
        parent.emitEvent({
          type: 'subagent.stalled',
          subagentId: childId,
          subagentName: profileName,
          silentMs: now - lastChangeAt,
          toolCount: stats.toolCount,
        });
      }
      if (
        stats.toolCount - lastCheckpointToolCount >= CHECKPOINT_TOOL_DELTA &&
        !checkpointInFlight
      ) {
        lastCheckpointToolCount = stats.toolCount;
        checkpointInFlight = true;
        void this.writeProgressCheckpoint(child, childId, stats, elapsedMs)
          .catch(() => {})
          .finally(() => {
            checkpointInFlight = false;
          });
      }
    }, SUBAGENT_PROGRESS_INTERVAL_MS);
    // Progress reporting must never keep the event loop alive on its own.
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async writeProgressCheckpoint(
    child: Agent,
    childId: string,
    stats: SubagentProgressStats,
    elapsedMs: number,
  ): Promise<void> {
    const todos = normalizeTodoItems(child.tools.getStore().get(TODO_STORE_KEY));
    const work = await this.snapshotChildWork(child);
    writeSubagentCheckpoint(childId, {
      toolCount: stats.toolCount,
      lastTool: stats.lastTool,
      lastTarget: stats.lastTarget,
      tokens: stats.tokens,
      elapsedMs,
      todos,
      dirtyFiles: work.dirtyFiles,
    });
  }

  private async configureChild(
    parent: Agent,
    child: Agent,
    profile: ResolvedAgentProfile,
    childId: string,
    options: RunSubagentOptions,
    profileBaseName?: string,
  ): Promise<void> {
    // A subagent inherits the parent agent's model, except read-only explore
    // subagents, which route to a cheap configured model when one exists so
    // codebase exploration stays fast and cheap.
    child.config.update({
      cwd: parent.config.cwd,
      modelAlias: resolveSubagentModelAlias(
        profile.name,
        profileBaseName,
        parent.config.modelAlias,
        parent.kimiConfig?.models,
        parent.kimiConfig?.loopControl?.explorationModel,
      {
        isAliasHealthy: (alias) =>
          isModelAliasHealthy(alias, parent.kimiConfig?.models),
      },
      ),
      thinkingLevel: parent.config.thinkingLevel,
    });

    const context = await prepareSystemPromptContext(
      this.session.systemContextKaos(child.kaos.getcwd()),
      this.session.options.kimiHomeDir,
      { additionalDirs: child.getAdditionalDirs() },
    );
    child.useProfile(profile, context);
    child.tools.inheritUserTools(parent.tools);
    this.attachSubagentTodoBridge(parent, child, childId, profile.name, options);
    this.attachUltraSwarmChannelIfNeeded(parent, child, childId, options, profile.name);
  }

  private attachSubagentTodoBridge(
    parent: Agent,
    child: Agent,
    childId: string,
    profileName: string,
    options: RunSubagentOptions,
  ): void {
    type ToolManagerLike = {
      updateStore<K extends keyof import('../tools/store').ToolStoreData>(
        key: K,
        value: import('../tools/store').ToolStoreData[K],
      ): void;
    };
    const tools = child.tools as ToolManagerLike;
    const originalUpdateStore = tools.updateStore.bind(tools);
    tools.updateStore = (key, value) => {
      originalUpdateStore(key, value);
      if (key !== TODO_STORE_KEY) return;
      parent.emitEvent({
        type: 'subagent.todo.updated',
        subagentId: childId,
        subagentName: profileName,
        parentToolCallId: options.parentToolCallId,
        todos: normalizeTodoItems(value),
      });
    };
  }

  private attachUltraSwarmChannelIfNeeded(
    parent: Agent,
    child: Agent,
    childAgentId: string,
    options: RunSubagentOptions,
    profileName: string,
  ): void {
    const run = parent.ultraSwarmRun;
    if (run === undefined || options.parentToolCallId !== run.parentToolCallId) {
      return;
    }
    // Wire Edit/Write file-lease identity for this UltraSwarm worker (bus optional).
    child.swarmFileLease = { ownerId: childAgentId, runId: run.runId };
    if (!run.busEnabled) return;
    const expert = run.team.experts.find((entry) => entry.id === profileName);
    if (expert === undefined) return;
    child.tools.attachEphemeralBuiltin(
      new SwarmChannelTool({
        parentAgent: parent,
        parentStore: parent.tools.getStore(),
        run,
        expert,
        childAgentId,
        onMessagePosted: ({ message, mentionExpertIds }) => {
          emitSwarmCollaborationMessage(parent, message);
          emitSwarmCollaborationMention(parent, message, mentionExpertIds);
          deliverSwarmBusCoordination(this.session, parent, message, mentionExpertIds);
        },
      }),
    );
  }

  private async triggerSubagentStart(
    parent: Agent,
    profileName: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<void> {
    await parent.hooks?.trigger('SubagentStart', {
      matcherValue: profileName,
      signal,
      inputData: {
        agentName: profileName,
        prompt: prompt.slice(0, HOOK_TEXT_PREVIEW_LENGTH),
      },
    });
  }

  private triggerSubagentStop(parent: Agent, profileName: string, result: string): void {
    void parent.hooks?.fireAndForgetTrigger('SubagentStop', {
      matcherValue: profileName,
      inputData: {
        agentName: profileName,
        response: result.slice(0, HOOK_TEXT_PREVIEW_LENGTH),
      },
    });
  }

  private observeFirstRequest(
    child: Agent,
    options: RunSubagentOptions,
  ): void {
    if (options.onReady === undefined) return;
    void child.turn
      .waitForTurnFirstRequest()
      .then(() => {
        options.onReady?.();
      })
      .catch(() => {
        // Turn failed before the first request — onReady is skipped since the
        // subagent never became ready.
      });
  }

  private emitSubagentSpawned(
    parent: Agent,
    childId: string,
    profileName: string,
    options: RunSubagentOptions,
    modelAlias?: string,
  ): void {
    const run = parent.ultraSwarmRun;
    if (
      run !== undefined &&
      run.busEnabled &&
      options.parentToolCallId === run.parentToolCallId
    ) {
      run.expertAgentIds.set(profileName, childId);
    }
    parent.emitEvent({
      type: 'subagent.spawned',
      subagentId: childId,
      subagentName: profileName,
      parentToolCallId: options.parentToolCallId,
      parentToolCallUuid: options.parentToolCallUuid,
      parentAgentId: this.ownerAgentId,
      description: options.description,
      swarmIndex: options.swarmIndex,
      runInBackground: options.runInBackground,
      modelAlias,
    });
    parent.telemetry.track('subagent_created', {
      subagent_name: profileName,
      run_in_background: options.runInBackground,
    });
  }

  private emitSubagentStarted(
    parent: Agent,
    childId: string,
    options: RunSubagentOptions,
  ): void {
    if (options.swarmItem !== undefined) {
      updateSwarmOrchestrationTodoStatus(parent.tools.getStore(), options.swarmItem, 'in_progress');
    }
    parent.emitEvent({
      type: 'subagent.started',
      subagentId: childId,
    });
  }

  private emitSubagentFailed(
    parent: Agent,
    childId: string,
    options: RunSubagentOptions,
    error: unknown,
    details?: SubagentFailedDetails,
  ): void {
    getDefaultSwarmFileLeaseRegistry().releaseAll(options.parentToolCallId);
    if (shouldSuppressQueuedAttemptFailureEvent(options, error)) return;
    if (options.swarmItem !== undefined) {
      updateSwarmOrchestrationTodoStatus(parent.tools.getStore(), options.swarmItem, 'pending');
    }
    parent.emitEvent({
      type: 'subagent.failed',
      subagentId: childId,
      error: error instanceof Error ? error.message : String(error),
      ...(details?.retryAttempt !== undefined ? { retryAttempt: details.retryAttempt } : {}),
      ...(details?.retryLimit !== undefined ? { retryLimit: details.retryLimit } : {}),
      ...(details?.fellBackToModel !== undefined ? { fellBackToModel: details.fellBackToModel } : {}),
    });
  }
}

async function runChildTurnToCompletion(child: Agent, signal: AbortSignal): Promise<void> {
  const completion = await child.turn.waitForCurrentTurn(signal);
  const turnEnded = completion.event;
  if (turnEnded.reason !== 'completed') {
    if (turnEnded.reason === 'filtered') {
      throw new Error('Subagent turn blocked by provider safety policy');
    }
    if (turnEnded.error?.code === ErrorCodes.PROVIDER_RATE_LIMIT) {
      throw providerRateLimitErrorFromPayload(turnEnded.error);
    }
    const failure = new Error(
      turnEnded.error === undefined
        ? `Subagent turn ${turnEnded.reason}`
        : `[${turnEnded.error.code}] ${turnEnded.error.message}`,
    );
    // Preserve the provider HTTP status so downstream classifiers can tell
    // transient 5xx failures apart from permanent 4xx after payload flattening.
    const failureStatusCode = turnEnded.error?.details?.['statusCode'];
    if (typeof failureStatusCode === 'number') {
      (failure as Error & { statusCode?: number }).statusCode = failureStatusCode;
    }
    throw failure;
  }
  if (completion.stopReason === 'max_tokens') {
    throw new SubagentMaxTokensError(`${SUBAGENT_MAX_TOKENS_ERROR}.`);
  }
}

function providerRateLimitErrorFromPayload(error: LioraErrorPayload): APIProviderRateLimitError {
  const requestId =
    typeof error.details?.['requestId'] === 'string' ? error.details['requestId'] : null;
  return new APIProviderRateLimitError(error.message, requestId);
}

/**
 * Test-only export. Exposed so the request-id propagation path can be
 * pinned without spinning up a full subagent-host mock. Production callers
 * reach this through `runChildTurnToCompletion`.
 */
export const __testing__ = { providerRateLimitErrorFromPayload };

function lastAssistantText(agent: Agent): string {
  for (const message of [...agent.context.history].toReversed()) {
    if (message.role !== 'assistant') continue;
    const text = message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    if (text.trim().length > 0) return text.trim();
  }
  return '';
}

function normalizeTodoItems(value: unknown): readonly TodoItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isTodoItemLike).map((todo) => ({
    title: todo.title,
    status: todo.status,
  }));
}

function isTodoItemLike(value: unknown): value is TodoItem {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['title'] === 'string' &&
    (record['status'] === 'pending' ||
      record['status'] === 'in_progress' ||
      record['status'] === 'done')
  );
}

function shouldSuppressQueuedAttemptFailureEvent(
  options: RunSubagentOptions,
  error: unknown,
): boolean {
  if (options.suppressRateLimitFailureEvent !== true) return false;
  if (isProviderRateLimitError(error)) return true;
  return isAbortError(error) || options.signal.aborted;
}

/**
 * Whether a subagent turn failure deserves a model-fallback hop. Direct
 * provider errors (rate limit, status errors thrown before flattening) are
 * judged through their wire payload. Flattened turn failures arrive as plain
 * `Error`s with the provider HTTP status copied on, so rebuild a status error
 * and let kosong's classifier judge transient cases (e.g. body-less 400
 * gateway glitches) exactly the same way.
 */
function isRetryableSubagentProviderFailure(error: unknown): boolean {
  if (isAbortError(error)) return false;
  if (isRetryableProviderFailure(toKimiErrorPayload(error))) return true;
  if (!(error instanceof Error)) return false;
  const statusCode = (error as Error & { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== 'number') return false;
  return isRetryableGenerateError(new APIStatusError(statusCode, error.message));
}

function createExpertSubagentProfile(
  expert: ExpertCatalogEntry,
  baseProfile: ResolvedAgentProfile,
): ResolvedAgentProfile {
  return {
    ...baseProfile,
    name: expert.id,
    description: expert.description,
    whenToUse: resolveExpertWhenToUse(expert),
    systemPrompt: (context) =>
      renderExpertSystemPrompt(baseProfile.systemPrompt(context), expert, baseProfile.name),
    tools: [...baseProfile.tools],
    subagents: baseProfile.subagents,
  };
}


export interface SubagentProgressStats {
  readonly toolCount: number;
  readonly lastTool: string | undefined;
  readonly lastTarget: string | undefined;
  readonly tokens: number;
}

/** Aggregate live progress stats for a running subagent (T3-7 telemetry). */
export function collectSubagentProgressStats(child: Agent): SubagentProgressStats {
  let toolCount = 0;
  let lastTool: string | undefined;
  let lastTarget: string | undefined;
  for (const message of child.context.history) {
    if (message.role !== 'assistant') continue;
    for (const toolCall of message.toolCalls) {
      toolCount += 1;
      lastTool = toolCall.name;
      lastTarget = summarizeToolTarget(toolCall.arguments ?? undefined);
    }
  }
  const total = child.usage.data().total;
  const tokens =
    total === undefined
      ? 0
      : total.inputOther + total.output + total.inputCacheRead + total.inputCacheCreation;
  return { toolCount, lastTool, lastTarget, tokens };
}

function summarizeToolTarget(argsJson: string | undefined): string | undefined {
  if (argsJson === undefined || argsJson.length === 0) return undefined;
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    for (const key of ['path', 'command', 'pattern', 'query', 'url', 'description']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.length > 0) {
        return value.length > 80 ? `${value.slice(0, 80)}…` : value;
      }
    }
  } catch {
    // Fall through to the raw snippet below.
  }
  const raw = argsJson.trim();
  return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
}

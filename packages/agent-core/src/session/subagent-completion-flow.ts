/**
 * Subagent prompt-turn execution and completion collection: model fallback
 * hops, git context for explore profiles, summary continuation, and the
 * completion contract handoff.
 *
 * Extracted from subagent-host so turn orchestration does not grow the host
 * class body.
 */

import { listSwitchableFailoverModels } from '../agent/provider-failover';
import type { PromptOrigin } from '../agent/context';
import type { Agent } from '../agent';
import { updateSwarmOrchestrationTodoStatus } from '../tools/builtin/state/todo-list';
import { resolveSubagentModelAlias } from '../utils/cheap-model';
import { collectGitContext } from './git-context';
import { maybeRunRollingCheck, recordChildCompletion } from './rolling-integration';
import {
  buildCheckpointRecoveryReminder,
  clearSubagentCheckpoint,
  readSubagentCheckpoint,
} from './subagent-checkpoint';
import { getDefaultSwarmFileLeaseRegistry } from './swarm-file-lease';
import { snapshotChildWork, type GitWorkSnapshot } from './subagent-result-contract';
import {
  enrichPermanentProviderFailure,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
} from './subagent-errors';
import {
  isModelAliasHealthy,
  isRetryableSubagentProviderFailure,
  runChildTurnToCompletion,
} from './subagent-run-lifecycle';
import {
  emitSubagentFailed,
  emitSubagentStarted,
  observeFirstRequest,
  triggerSubagentStart,
  triggerSubagentStop,
} from './subagent-events';
import { attachToolStreamBridge, startProgressReporter } from './subagent-telemetry';
import type { RunSubagentOptions, SubagentCompletion } from './subagent-host-types';
import { buildChildResultContract } from './subagent-verification-gate';
import SUMMARY_CONTINUATION_PROMPT from './summary-continuation.md?raw';

const SUBAGENT_MODEL_FALLBACK_HOPS = 2;

/**
 * A subagent summary shorter than this many characters triggers one
 * follow-up turn that asks the subagent to expand it, so the parent
 * agent receives a technically complete handoff.
 */
const SUMMARY_MIN_LENGTH = 200;
const SUMMARY_CONTINUATION_ATTEMPTS = 1;
const SUBAGENT_PROMPT_ORIGIN: PromptOrigin = { kind: 'system_trigger', name: 'subagent' };

export function lastAssistantText(agent: Agent): string {
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

export async function runPromptTurnWithModelFallback(
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
      return await completionFlowApi.runPromptTurn(parent, childId, child, profileName, options);
    } catch (error) {
      const nextAlias =
        hop < maxFallbackHops && isRetryableSubagentProviderFailure(error)
          ? fallbackAliases[hop]
          : undefined;
      if (nextAlias === undefined) {
        const failure = enrichPermanentProviderFailure(error, child);
        emitSubagentFailed(parent, childId, options, failure, {
          ...(hop > 0 && lastAttemptedAlias !== undefined
            ? { fellBackToModel: lastAttemptedAlias }
            : {}),
        });
        throw failure;
      }
      emitSubagentFailed(parent, childId, options, error, {
        retryAttempt: hop + 1,
        retryLimit: maxFallbackHops,
      });
      child.config.update({ modelAlias: nextAlias });
      lastAttemptedAlias = nextAlias;
    }
  }
}

export async function runPromptTurn(
  parent: Agent,
  childId: string,
  child: Agent,
  profileName: string,
  options: RunSubagentOptions,
): Promise<SubagentCompletion> {
  options.signal.throwIfAborted();
  await triggerSubagentStart(parent, profileName, options.prompt, options.signal);
  options.signal.throwIfAborted();

  let childPrompt = options.prompt;
  if (profileName === 'explore') {
    const gitContext = await collectGitContext(child.kaos, child.config.cwd);
    if (gitContext) childPrompt = `${gitContext}\n\n${childPrompt}`;
  }

  emitSubagentStarted(parent, childId, options);
  const workSnapshot = await snapshotChildWork(child);
  const turnId = child.turn.prompt([{ type: 'text', text: childPrompt }], SUBAGENT_PROMPT_ORIGIN);
  if (turnId === null) {
    throw new Error(`Agent instance "${childId}" could not start a turn`);
  }
  observeFirstRequest(child, options);
  return waitForChildCompletion(parent, childId, child, profileName, options, workSnapshot);
}

export async function waitForChildCompletion(
  parent: Agent,
  childId: string,
  child: Agent,
  profileName: string,
  options: RunSubagentOptions,
  workSnapshot: GitWorkSnapshot,
): Promise<SubagentCompletion> {
  const disposeProgress = startProgressReporter(
    parent,
    child,
    childId,
    profileName,
    options.timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS,
  );
  const disposeToolStream = attachToolStreamBridge(parent, child, childId, profileName, options);
  try {
    return await collectChildCompletion(
      parent,
      child,
      childId,
      profileName,
      options,
      workSnapshot,
    );
  } finally {
    disposeProgress();
    disposeToolStream();
  }
}

export async function collectChildCompletion(
  parent: Agent,
  child: Agent,
  childId: string,
  profileName: string,
  options: RunSubagentOptions,
  workSnapshot: GitWorkSnapshot,
): Promise<SubagentCompletion> {
  await runChildTurnToCompletion(child, options.signal);

  await child.fullCompaction.ensureBelowHandoffThreshold(options.signal);

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
  const contract = await buildChildResultContract(
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
  triggerSubagentStop(parent, profileName, result);
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

export async function retrySubagentTurn(
  parent: Agent,
  agentId: string,
  child: Agent,
  profileName: string,
  options: RunSubagentOptions,
): Promise<SubagentCompletion> {
  options.signal.throwIfAborted();
  child.config.update({
    modelAlias: resolveSubagentModelAlias(
      profileName,
      undefined,
      parent.config.modelAlias,
      parent.kimiConfig?.models,
      parent.kimiConfig?.loopControl?.explorationModel,
      {
        isAliasHealthy: (alias) => isModelAliasHealthy(alias, parent.kimiConfig?.models),
      },
    ),
  });
  emitSubagentStarted(parent, agentId, options);
  const workSnapshot = await snapshotChildWork(child);
  const turnId = child.turn.retry('agent-host');
  if (turnId === null) {
    throw new Error(`Agent instance "${agentId}" could not start a retry turn`);
  }
  observeFirstRequest(child, options);
  return waitForChildCompletion(parent, agentId, child, profileName, options, workSnapshot);
}

export function prepareResumeCheckpoint(childId: string, child: Agent): void {
  const checkpoint = readSubagentCheckpoint(childId);
  if (checkpoint === undefined) return;
  child.context.appendSystemReminder(buildCheckpointRecoveryReminder(checkpoint), {
    kind: 'system_trigger',
    name: 'subagent-checkpoint',
  });
  clearSubagentCheckpoint(childId);
}

export function resolveResumeModelAlias(
  profileName: string,
  parent: Agent,
): string | undefined {
  return resolveSubagentModelAlias(
    profileName,
    undefined,
    parent.config.modelAlias,
    parent.kimiConfig?.models,
    parent.kimiConfig?.loopControl?.explorationModel,
    {
      isAliasHealthy: (alias) => isModelAliasHealthy(alias, parent.kimiConfig?.models),
    },
  );
}

export function spawnModelAlias(
  profileName: string,
  profileBaseName: string | undefined,
  parent: Agent,
): string | undefined {
  return resolveSubagentModelAlias(
    profileName,
    profileBaseName,
    parent.config.modelAlias,
    parent.kimiConfig?.models,
    parent.kimiConfig?.loopControl?.explorationModel,
    {
      isAliasHealthy: (alias) => isModelAliasHealthy(alias, parent.kimiConfig?.models),
    },
  );
}

/** Indirection so intra-module callers and tests share one `runPromptTurn` binding. */
export const completionFlowApi = {
  runPromptTurn,
  waitForChildCompletion,
};

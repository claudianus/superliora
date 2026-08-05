/**
 * Subagent prompt-turn execution and completion collection: model fallback
 * hops, git context for explore profiles, summary continuation, and the
 * completion contract handoff.
 *
 * Extracted from subagent-host so turn orchestration does not grow the host
 * class body.
 */

import { isPermanentAuthError } from '@superliora/kosong';

import { listSwitchableFailoverModels } from '../../agent/provider-failover';
import type { PromptOrigin } from '../../agent/context';
import type { Agent } from '../../agent';
import { updateSwarmOrchestrationTodoStatus } from '../../tools/builtin/state/todo-list';
import { collectGitContext } from '../git-context';
import { maybeRunRollingCheck, recordChildCompletion } from '../rolling-integration';
import {
  buildCheckpointRecoveryReminder,
  clearSubagentCheckpoint,
  readSubagentCheckpoint,
} from './subagent-checkpoint';
import { getDefaultSwarmFileLeaseRegistry } from '#/fleet';
import { snapshotChildWork, type GitWorkSnapshot } from './subagent-result-contract';
import {
  enrichPermanentProviderFailure,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
} from './subagent-errors';
import {
  isModelAliasHealthy,
  isRetryableSubagentProviderFailure,
  markModelAliasAuthRejected,
  runChildTurnToCompletion,
} from './subagent-run-lifecycle';
import {
  currentAgentConfig,
  resolveSubagentModelSelection,
  type SubagentModelSelection,
} from './subagent-model-routing';
import {
  emitSubagentFailed,
  emitSubagentStarted,
  observeFirstRequest,
  triggerSubagentStart,
  triggerSubagentStop,
} from './subagent-events';
import { attachToolStreamBridge, startProgressReporter } from './subagent-telemetry';
import type {
  RunSubagentOptions,
  SubagentCompletion,
  SubagentGoalBinding,
  SubagentPlanBinding,
} from './subagent-host-types';
import { buildChildResultContract } from './subagent-verification-gate';
import SUMMARY_CONTINUATION_PROMPT from '../summary-continuation.md?raw';

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

/**
 * Failover hop candidates for a subagent turn: the child's configured
 * `fallbackModels`, minus aliases whose provider credential is already
 * marked unhealthy. Non-explore workers inherit the parent model; a hop
 * must never route them into a provider known to be dead (e.g. exhausted
 * credits) only to fail permanently one request later.
 */
export function subagentFallbackAliases(
  child: Agent,
  isAliasHealthy?: (alias: string) => boolean,
): readonly string[] {
  const models = currentAgentConfig(child)?.models;
  const healthy =
    isAliasHealthy ??
    ((alias: string) => isModelAliasHealthy(alias, models));
  return listSwitchableFailoverModels(child)
    .map((option) => option.alias)
    .filter((alias) => healthy(alias));
}

export async function runPromptTurnWithModelFallback(
  parent: Agent,
  childId: string,
  child: Agent,
  profileName: string,
  options: RunSubagentOptions,
): Promise<SubagentCompletion> {
  const fallbackAliases = subagentFallbackAliases(child);
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
        // V7-2: a permanent auth refusal (401/403) from the attempted alias's
        // provider must poison that credential in the shared health store so
        // later spawn/resume/retry resolution never routes back into the
        // rejected exploration model and earns another guaranteed 403.
        if (isPermanentAuthError(error)) {
          markModelAliasAuthRejected(lastAttemptedAlias, currentAgentConfig(child)?.models, error);
        }
        const failure = enrichPermanentProviderFailure(error, child);
        emitSubagentFailed(parent, childId, options, failure, (hop > 0 && lastAttemptedAlias !== undefined
            ? { fellBackToModel: lastAttemptedAlias }
            : {}));
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
  if (options.goal !== undefined) {
    await migrateGoalToWorker(child, options.goal);
  }
  if (options.plan !== undefined) {
    await migratePlanToWorker(child, options.plan);
  }
  const turnId = child.turn.prompt([{ type: 'text', text: childPrompt }], SUBAGENT_PROMPT_ORIGIN);
  if (turnId === null) {
    throw new Error(`Agent instance "${childId}" could not start a turn`);
  }
  observeFirstRequest(child, options);
  return waitForChildCompletion(parent, childId, child, profileName, options, workSnapshot);
}

/**
 * Goal migration (spec 2026-08-04-goal-driver-jobs): create the goal on the
 * worker agent mechanically before its task prompt turn. The turn engine
 * already drives continuation turns while a goal is `active`, so the worker
 * becomes an autonomous loop on its own lane — no new machinery. Budget
 * limits are attached in the same breath; they are the circuit breakers the
 * loop checks between continuation turns.
 */
export async function migrateGoalToWorker(
  child: Agent,
  binding: SubagentGoalBinding,
): Promise<void> {
  await child.goal.createGoal(
    {
      objective: binding.objective,
      completionCriterion: binding.completionCriterion,
    },
    'system',
  );
  if (binding.budgetLimits !== undefined) {
    await child.goal.setBudgetLimits({ budgetLimits: binding.budgetLimits }, 'system');
  }
}

/**
 * Plan Desk: activate plan mode on the worker before its first turn so
 * research/interview/write run where Write + web tools exist — not on Conductor.
 */
export async function migratePlanToWorker(
  child: Agent,
  binding: SubagentPlanBinding,
): Promise<void> {
  if (child.planMode.isActive) return;
  await child.planMode.enter(
    binding.planId,
    false,
    true,
    binding.ultra ?? true,
    binding.initialContext ?? '',
    'standalone',
  );
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
  // A migrated goal still `active` means another prompt re-enters the goal
  // loop — never trigger that from the summary expansion path.
  const goalStillActive = options.goal !== undefined && child.goal.getActiveGoal() !== null;
  let remainingContinuations = goalStillActive ? 0 : SUMMARY_CONTINUATION_ATTEMPTS;
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
  // Goal-driver terminal state (spec 2026-08-04-goal-driver-jobs §3.5):
  // `complete` clears the durable record, so a null goal on a migrated run
  // means success; anything else is the stopped status the Job maps to blocked.
  if (options.goal === undefined) {
    return { result, usage, contract };
  }
  const goalFinal = child.goal.getGoal().goal;
  if (goalFinal === null) {
    return { result, usage, contract, goalStatus: 'complete' };
  }
  return {
    result,
    usage,
    contract,
    goalStatus: goalFinal.status,
    goalId: goalFinal.goalId,
    goalTerminalReason: goalFinal.terminalReason,
  };
}

export async function retrySubagentTurn(
  parent: Agent,
  agentId: string,
  child: Agent,
  profileName: string,
  options: RunSubagentOptions,
): Promise<SubagentCompletion> {
  options.signal.throwIfAborted();
  const selection = resolveSubagentModelSelection(parent, profileName);
  child.config.update({
    modelAlias: selection.alias,
    thinkingLevel: selection.thinkingLevel,
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
  return resolveResumeModelSelection(profileName, parent).alias;
}

export function resolveResumeModelSelection(
  profileName: string,
  parent: Agent,
): SubagentModelSelection {
  return resolveSubagentModelSelection(parent, profileName);
}

export function spawnModelAlias(
  profileName: string,
  profileBaseName: string | undefined,
  parent: Agent,
): string | undefined {
  return resolveSubagentModelSelection(parent, profileName, profileBaseName).alias;
}

/** Indirection so intra-module callers and tests share one `runPromptTurn` binding. */
export const completionFlowApi = {
  runPromptTurn,
  waitForChildCompletion,
};

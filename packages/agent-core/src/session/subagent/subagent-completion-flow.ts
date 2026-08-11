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
import {
  escalateSmartRoute,
  mergeRouteFallbackAliases,
  recordRouteOutcome,
  type SmartRoute,
} from '../../agent/routing';
import { classifyProviderRouteFailure } from '../../agent/turn/provider-route-classify';
import { isAuthOrCreditFailure } from '../../utils/model-presets';
import { updateSwarmOrchestrationTodoStatus } from '../../tools/builtin/state/todo-list';
import { collectGitContext } from '../git-context';
import { maybeRunRollingCheck, recordChildCompletion } from '../rolling-integration';
import {
  buildCheckpointRecoveryReminder,
  clearSubagentCheckpoint,
  readSubagentCheckpoint,
} from './subagent-checkpoint';
import { getDefaultSwarmFileLeaseRegistry } from '#/fleet';
import { extractToolCallEventsFromHistory } from '../../skill/auto-skillify-runtime';
import { computeSubagentFriction } from './subagent-friction';
import { snapshotChildWork, type GitWorkSnapshot } from './subagent-result-contract';
import {
  enrichPermanentProviderFailure,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
} from './subagent-errors';
import {
  isModelAliasHealthy,
  isRetryableSubagentProviderFailure,
  markModelAliasAuthRejected,
  markModelAliasUnavailable,
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
import { formatModelFailedNote } from './subagent-model-failed-note';
import SUMMARY_CONTINUATION_PROMPT from '../summary-continuation.md?raw';

export {
  formatModelFailedNote,
  parseModelFailedNote,
} from './subagent-model-failed-note';

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

export type SubagentFallbackAliasOptions = {
  /**
   * When true (Conductor JobCreate.model_alias pin), prefer the pin's
   * `fallbackModels` ahead of the role smart chain so hops stay on the
   * chosen family's failover path.
   */
  readonly pinFallbacksFirst?: boolean;
};

/**
 * Failover hop candidates: role smart chain + config `fallbackModels`,
 * minus unhealthy aliases. Never hop into a known-dead provider.
 *
 * Default order is route-chain then pin `fallbackModels` (legacy).
 * Conductor pins flip the order via {@link SubagentFallbackAliasOptions.pinFallbacksFirst}.
 */
export function subagentFallbackAliases(
  child: Agent,
  isAliasHealthy?: (alias: string) => boolean,
  route?: SmartRoute,
  options?: SubagentFallbackAliasOptions,
): readonly string[] {
  const config = currentAgentConfig(child);
  const models = config?.models;
  const healthy =
    isAliasHealthy ??
    ((alias: string) => isModelAliasHealthy(alias, models));
  const configFallbacks = listSwitchableFailoverModels(child).map((option) => option.alias);
  if (options?.pinFallbacksFirst !== true) {
    return mergeRouteFallbackAliases(route, configFallbacks, child.config.modelAlias, healthy);
  }

  // Pin-first: configured fallbacks of the current (pinned) alias, then role chain.
  const merged: string[] = [];
  const seen = new Set<string>();
  const current = child.config.modelAlias;
  if (current !== undefined) seen.add(current);
  const push = (alias: string | undefined): void => {
    if (alias === undefined || alias.length === 0 || seen.has(alias)) return;
    if (!healthy(alias)) return;
    seen.add(alias);
    merged.push(alias);
  };
  for (const alias of configFallbacks) push(alias);
  if (route !== undefined) {
    for (const alias of route.chain) push(alias);
  }
  return merged;
}

function shouldHopSubagentModel(error: unknown): boolean {
  if (isRetryableSubagentProviderFailure(error)) return true;
  if (isPermanentAuthError(error)) return true;
  const failure = classifyProviderRouteFailure(error, undefined);
  if (failure?.kind === 'model_unavailable') return true;
  const message = error instanceof Error ? error.message : String(error);
  return isAuthOrCreditFailure(message);
}

export async function runPromptTurnWithModelFallback(
  parent: Agent,
  childId: string,
  child: Agent,
  profileName: string,
  options: RunSubagentOptions,
): Promise<SubagentCompletion> {
  const conductorPin = options.modelAlias?.trim();
  const pinFallbacksFirst =
    conductorPin !== undefined && conductorPin.length > 0;

  // Prefer a route from the live parent config; fallback tests may pass a
  // stub parent without `config`, so never throw before the turn runs.
  // When Conductor pinned model_alias, resolve with that pin so the chain
  // matches the worker that actually runs.
  let route: SmartRoute | undefined;
  try {
    if (parent.config !== undefined) {
      route = resolveSubagentModelSelection(parent, profileName, undefined, {
        forcedAlias: conductorPin,
        signals: { prompt: options.prompt, profileName },
      }).route;
    }
  } catch {
    route = undefined;
  }
  const fallbackAliases = subagentFallbackAliases(child, undefined, route, {
    pinFallbacksFirst,
  });
  const maxFallbackHops = Math.min(
    Math.max(SUBAGENT_MODEL_FALLBACK_HOPS, 4),
    fallbackAliases.length,
  );
  let lastAttemptedAlias = child.config.modelAlias;
  let softEscalateUsed = false;
  const triedAliases: string[] = [];

  for (let hop = 0; ; hop += 1) {
    if (lastAttemptedAlias !== undefined && !triedAliases.includes(lastAttemptedAlias)) {
      triedAliases.push(lastAttemptedAlias);
    }
    try {
      const result = await completionFlowApi.runPromptTurn(
        parent,
        childId,
        child,
        profileName,
        options,
      );
      if (route !== undefined && lastAttemptedAlias !== undefined) {
        recordRouteOutcome({ role: route.role, alias: lastAttemptedAlias, ok: true });
      }
      return result;
    } catch (error) {
      if (route !== undefined && lastAttemptedAlias !== undefined) {
        recordRouteOutcome({ role: route.role, alias: lastAttemptedAlias, ok: false });
      }

      let nextAlias =
        hop < maxFallbackHops && shouldHopSubagentModel(error)
          ? fallbackAliases[hop]
          : undefined;

      // Soft quality escalate once: rebuild chain at higher intensity (auto only).
      if (
        nextAlias === undefined &&
        !softEscalateUsed &&
        route !== undefined &&
        route.source === 'auto' &&
        isSoftQualityFailure(error)
      ) {
        const config = currentAgentConfig(parent);
        if (config !== undefined) {
          const escalated = escalateSmartRoute(
            {
              role: route.role,
              config,
              parentAlias: parent.config.modelAlias,
              signals: { prompt: options.prompt, profileName, softEscalate: true },
            },
            route,
          );
          if (escalated !== undefined && escalated.alias !== lastAttemptedAlias) {
            softEscalateUsed = true;
            route = escalated;
            nextAlias = escalated.alias;
          }
        }
      }

      const classified = classifyProviderRouteFailure(error, undefined);
      if (classified?.kind === 'model_unavailable') {
        markModelAliasUnavailable(lastAttemptedAlias, error);
      }

      if (nextAlias === undefined) {
        if (
          classified?.kind !== 'model_unavailable' &&
          (isPermanentAuthError(error) || isAuthOrCreditFailure(errorMessage(error)))
        ) {
          markModelAliasAuthRejected(lastAttemptedAlias, currentAgentConfig(child)?.models, error);
        }
        const failure = enrichPermanentProviderFailure(error, child);
        const nextHint = fallbackAliases.find((alias) => !triedAliases.includes(alias));
        const kind =
          classified?.kind ??
          (isAuthOrCreditFailure(errorMessage(error)) ? 'auth_or_credit' : 'route_fail');
        const note = formatModelFailedNote({
          alias: lastAttemptedAlias,
          kind,
          tried: triedAliases,
          nextHint,
        });
        emitSubagentFailed(parent, childId, options, failure, (hop > 0 && lastAttemptedAlias !== undefined
            ? { fellBackToModel: lastAttemptedAlias }
            : {}));
        throw appendModelFailedNote(failure, note);
      }
      // Non-terminal hop: clients should treat retryAttempt as "retrying", not
      // a finished failure. fellBackToModel is the alias about to run next.
      emitSubagentFailed(parent, childId, options, error, {
        retryAttempt: hop + 1,
        retryLimit: Math.max(maxFallbackHops, 1),
        fellBackToModel: nextAlias,
      });
      child.config.update({ modelAlias: nextAlias });
      lastAttemptedAlias = nextAlias;
    }
  }
}

function appendModelFailedNote(error: unknown, note: string): Error {
  if (error instanceof Error) {
    if (error.message.includes('model_failed:')) return error;
    error.message = `${error.message}\n${note}`;
    return error;
  }
  return new Error(`${String(error)}\n${note}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSoftQualityFailure(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes('empty') ||
    message.includes('no tool') ||
    message.includes('invalid tool') ||
    message.includes('quality')
  );
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
      ...(binding.gateCommand !== undefined ? { gateCommand: binding.gateCommand } : {}),
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

  // Friction + skillify events are computed before the handoff compaction:
  // the walk needs the tool results that compaction is about to collapse.
  const friction = computeSubagentFriction(child.context.history);
  const skillifyEvents = extractToolCallEventsFromHistory(child.context.history);
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
  const gateOutcome = child.goal.consumeTerminalGateOutcome();
  const gateFields =
    gateOutcome !== undefined ? ({ gateOutcome } as const) : ({} as const);
  const skillifyFields =
    skillifyEvents.length > 0 ? ({ skillifyEvents } as const) : ({} as const);
  if (options.goal === undefined) {
    return { result, usage, contract, friction, ...gateFields, ...skillifyFields };
  }
  const goalFinal = child.goal.getGoal().goal;
  if (goalFinal === null) {
    return {
      result,
      usage,
      contract,
      friction,
      goalStatus: 'complete',
      ...gateFields,
      ...skillifyFields,
    };
  }
  return {
    result,
    usage,
    contract,
    friction,
    goalStatus: goalFinal.status,
    goalId: goalFinal.goalId,
    goalTerminalReason: goalFinal.terminalReason,
    ...gateFields,
    ...skillifyFields,
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

export function spawnModelSelection(
  profileName: string,
  profileBaseName: string | undefined,
  parent: Agent,
  options?: {
    readonly preferVisionModel?: boolean;
    readonly prompt?: string;
    readonly modelAlias?: string;
  },
): SubagentModelSelection {
  return resolveSubagentModelSelection(parent, profileName, profileBaseName, {
    preferVision: options?.preferVisionModel === true,
    forcedAlias: options?.modelAlias,
    signals: {
      prompt: options?.prompt,
      profileName,
      profileBaseName,
    },
  });
}

export function spawnModelAlias(
  profileName: string,
  profileBaseName: string | undefined,
  parent: Agent,
  options?: {
    readonly preferVisionModel?: boolean;
    readonly prompt?: string;
    readonly modelAlias?: string;
  },
): string | undefined {
  return spawnModelSelection(profileName, profileBaseName, parent, options).alias;
}

/** Indirection so intra-module callers and tests share one `runPromptTurn` binding. */
export const completionFlowApi = {
  runPromptTurn,
  waitForChildCompletion,
};

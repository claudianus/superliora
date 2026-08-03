/**
 * Subagent lifecycle event emission and hook triggers: `subagent.spawned` /
 * `subagent.started` / `subagent.failed`, the `SubagentStart` / `SubagentStop`
 * hook pair, and the `onReady` first-request observer.
 *
 * Extracted from subagent-host so the host class body does not grow with
 * every new telemetry field. Each function takes the parent agent and the
 * run options explicitly instead of closing over host state.
 */

import { isProviderRateLimitError } from '@superliora/kosong';

import type { Agent } from '../../agent';
import { isAbortError } from '../../loop/errors';
import { updateSwarmOrchestrationTodoStatus } from '../../tools/builtin/state/todo-list';
import { getDefaultSwarmFileLeaseRegistry } from '#/fleet';
import type { RunSubagentOptions } from './subagent-host-types';

const HOOK_TEXT_PREVIEW_LENGTH = 500;

/** Optional model-fallback progress attached to `subagent.failed` events. */
export interface SubagentFailedDetails {
  readonly retryAttempt?: number;
  readonly retryLimit?: number;
  readonly fellBackToModel?: string;
}

export async function triggerSubagentStart(
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

export function triggerSubagentStop(parent: Agent, profileName: string, result: string): void {
  void parent.hooks?.fireAndForgetTrigger('SubagentStop', {
    matcherValue: profileName,
    inputData: {
      agentName: profileName,
      response: result.slice(0, HOOK_TEXT_PREVIEW_LENGTH),
    },
  });
}

export function observeFirstRequest(child: Agent, options: RunSubagentOptions): void {
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

export function emitSubagentSpawned(
  parent: Agent,
  ownerAgentId: string,
  childId: string,
  profileName: string,
  options: RunSubagentOptions,
  modelAlias?: string,
): void {
  parent.emitEvent({
    type: 'subagent.spawned',
    subagentId: childId,
    subagentName: profileName,
    parentToolCallId: options.parentToolCallId,
    parentToolCallUuid: options.parentToolCallUuid,
    parentAgentId: ownerAgentId,
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

export function emitSubagentStarted(
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

export function emitSubagentFailed(
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

function shouldSuppressQueuedAttemptFailureEvent(
  options: RunSubagentOptions,
  error: unknown,
): boolean {
  if (options.suppressRateLimitFailureEvent !== true) return false;
  if (isProviderRateLimitError(error)) return true;
  return isAbortError(error) || options.signal.aborted;
}

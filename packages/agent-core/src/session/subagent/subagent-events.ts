/** Factual worker lifecycle events and the first-request observer. */

import type { Agent } from '../../agent';
import type { RunSubagentOptions } from './subagent-host-types';


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
  _options: RunSubagentOptions,
): void {
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
): void {
  parent.emitEvent({
    type: 'subagent.failed',
    subagentId: childId,
    error: error instanceof Error ? error.message : String(error),
  });
}


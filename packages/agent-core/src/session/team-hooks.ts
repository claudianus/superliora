/**
 * Claude Agent Teams hook semantics hosted by the TaskGraph.
 *
 * Mapping:
 * - TaskCreated   → WorkGraph node first created, or a worker claim/running
 * - TaskCompleted → node marked needs_integration or done
 *
 * Decision control (Claude-compatible):
 * - exit code 2 / action:block → prevent the action; feed stderr to the model; keep working
 * - JSON {"continue": false, "stopReason": "..."} → halt (stopReason for the user, not the model)
 */

import type { Agent } from '../agent';
import type { HookEngine } from './hooks/engine';
import type { HookResult } from './hooks/types';

export type TeamHookEvent = 'TaskCreated' | 'TaskCompleted';

export type TeamHookDecision =
  | { readonly kind: 'allow'; readonly systemMessage?: string }
  | { readonly kind: 'block'; readonly feedback: string; readonly systemMessage?: string }
  | { readonly kind: 'halt'; readonly reason: string; readonly systemMessage?: string };

export function resolveTeamHookDecision(results: readonly HookResult[]): TeamHookDecision {
  const systemMessage = firstSystemMessage(results);

  const halt = results.find((result) => result.halt === true);
  if (halt !== undefined) {
    const reason =
      (halt.stopReason?.trim() ??
        halt.reason?.trim() ??
        halt.message?.trim()) ||
      'Stopped by team hook (continue: false)';
    return { kind: 'halt', reason, systemMessage };
  }

  const block = results.find((result) => result.action === 'block');
  if (block !== undefined) {
    const feedback =
      (block.reason?.trim() ??
        block.message?.trim() ??
        block.stderr?.trim()) ||
      'Blocked by team hook';
    return { kind: 'block', feedback, systemMessage };
  }

  return { kind: 'allow', systemMessage };
}

/**
 * Surface team-hook outcomes the Claude way:
 * - halt → user-visible hook.result (stopReason); do not inject into the model
 * - block → user-visible hook.result + system-reminder for the model (unless disabled)
 * - systemMessage → always user-visible when present
 */
export function publishTeamHookDecision(
  agent: Agent,
  event: TeamHookEvent,
  decision: TeamHookDecision,
  options?: { readonly injectFeedback?: boolean },
): void {
  const turnId = agent.turn.currentTurnId() ?? 0;
  if (decision.systemMessage !== undefined && decision.systemMessage.length > 0) {
    agent.emitEvent({
      type: 'hook.result',
      turnId,
      hookEvent: event,
      content: decision.systemMessage,
    });
  }

  if (decision.kind === 'allow') return;

  if (decision.kind === 'halt') {
    agent.emitEvent({
      type: 'hook.result',
      turnId,
      hookEvent: event,
      content: decision.reason,
      blocked: true,
    });
    return;
  }

  agent.emitEvent({
    type: 'hook.result',
    turnId,
    hookEvent: event,
    content: decision.feedback,
    blocked: true,
  });

  if (options?.injectFeedback === false) return;
  agent.context.appendSystemReminder(`${event} hook feedback:\n${decision.feedback}`, {
    kind: 'hook_result',
    event,
    blocked: true,
  });
}

export async function fireTaskCreated(
  hooks: HookEngine | undefined,
  input: {
    readonly taskId: string;
    readonly taskSubject: string;
    readonly taskDescription?: string;
    readonly teammateName?: string;
    readonly teamName: string;
    readonly signal?: AbortSignal;
  },
): Promise<TeamHookDecision> {
  if (hooks === undefined) return { kind: 'allow' };
  const results = await hooks.trigger('TaskCreated', {
    inputData: {
      taskId: input.taskId,
      taskSubject: input.taskSubject,
      taskDescription: input.taskDescription,
      teammateName: input.teammateName,
      teamName: input.teamName,
    },
    signal: input.signal,
  });
  return resolveTeamHookDecision(results);
}

export async function fireTaskCompleted(
  hooks: HookEngine | undefined,
  input: {
    readonly taskId: string;
    readonly taskSubject: string;
    readonly taskDescription?: string;
    readonly teammateName?: string;
    readonly teamName: string;
    readonly signal?: AbortSignal;
  },
): Promise<TeamHookDecision> {
  if (hooks === undefined) return { kind: 'allow' };
  const results = await hooks.trigger('TaskCompleted', {
    inputData: {
      taskId: input.taskId,
      taskSubject: input.taskSubject,
      taskDescription: input.taskDescription,
      teammateName: input.teammateName,
      teamName: input.teamName,
    },
    signal: input.signal,
  });
  return resolveTeamHookDecision(results);
}

/** Claude TaskCompleted-equivalent statuses on WorkGraph. */
export function isTeamTaskCompletionStatus(
  status: string,
): status is 'done' | 'needs_integration' {
  return status === 'done' || status === 'needs_integration';
}

export function isTeamTaskCompletionTransition(
  beforeStatus: string | undefined,
  afterStatus: string,
): boolean {
  if (!isTeamTaskCompletionStatus(afterStatus)) return false;
  return beforeStatus !== afterStatus;
}

function firstSystemMessage(results: readonly HookResult[]): string | undefined {
  for (const result of results) {
    const message = result.systemMessage?.trim();
    if (message !== undefined && message.length > 0) return message;
  }
  return undefined;
}

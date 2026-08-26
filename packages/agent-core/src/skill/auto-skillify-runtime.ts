/**
 * Wire auto-skillify into a live agent: extract recoveries from recent
 * history, LLM-distill a SKILL.md under `.agents/skills/auto/`, and
 * live-register so SearchSkill/Skill see it without a restart.
 */

import type { ContextMessage } from '../agent/context/types';
import type { Agent } from '../agent/index';
import {
  detectSkillifiableEvents,
  type ToolCallEvent,
} from './auto-skillify';
import {
  formatWorkerEventsForDistill,
  hasDistillSignal,
  runLessonDistill,
  serializeHistoryForDistill,
} from './skill-distill';

export type { ToolCallEvent };

/** Distill writes at most one skill per flush. */
export const AUTO_SKILLIFY_MAX_PER_RUN = 1;

/** Look at the trailing history window only — lessons live in recent work. */
export const AUTO_SKILLIFY_HISTORY_WINDOW = 80;

/**
 * Build ToolCallEvent[] from conversation history.
 * A success after N consecutive failures of the same tool becomes
 * `retryCount: N` so detectSkillifiableEvents can skillify the recovery.
 */
export function extractToolCallEventsFromHistory(
  messages: readonly ContextMessage[],
): ToolCallEvent[] {
  const nameByCallId = new Map<string, string>();
  const argsByCallId = new Map<string, string>();
  const failStreakByTool = new Map<string, { count: number; lastError?: string }>();
  const events: ToolCallEvent[] = [];

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls) {
        if (call.id.length > 0 && call.name.length > 0) {
          nameByCallId.set(call.id, call.name);
        }
        if (call.id.length > 0 && typeof call.arguments === 'string' && call.arguments.length > 0) {
          argsByCallId.set(call.id, call.arguments.slice(0, 300));
        }
      }
      continue;
    }
    if (message.role !== 'tool' || message.toolCallId === undefined) continue;

    const toolName = nameByCallId.get(message.toolCallId) ?? 'unknown';
    const outputText = message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();
    const success = message.isError !== true;

    if (!success) {
      const prev = failStreakByTool.get(toolName);
      failStreakByTool.set(toolName, {
        count: (prev?.count ?? 0) + 1,
        lastError: outputText.slice(0, 400) || prev?.lastError,
      });
      events.push({
        toolName,
        success: false,
        retryCount: 0,
        error: outputText.slice(0, 400) || undefined,
        inputSummary: argsByCallId.get(message.toolCallId),
        outputSummary: outputText.slice(0, 300) || undefined,
      });
      continue;
    }

    const streak = failStreakByTool.get(toolName);
    const retryCount = streak?.count ?? 0;
    failStreakByTool.delete(toolName);
    events.push({
      toolName,
      success: true,
      retryCount,
      error: streak?.lastError,
      inputSummary: argsByCallId.get(message.toolCallId),
      outputSummary: outputText.slice(0, 300) || undefined,
    });
  }

  return events;
}

export interface AutoSkillifyRunResult {
  readonly examined: number;
  readonly written: readonly string[];
}

function historyHasUserCorrection(messages: readonly ContextMessage[]): boolean {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const text = message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    if (
      /\b(?:no,|don't|do not|instead|that(?:'s| is) wrong|not that|stop doing)\b/i.test(text)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Detect + LLM-distill + live-register auto skills from recent history.
 * No-op when there is no recovery or user-correction signal.
 */
export async function runAutoSkillify(agent: Agent): Promise<AutoSkillifyRunResult> {
  const history = agent.context.history;
  const window =
    history.length > AUTO_SKILLIFY_HISTORY_WINDOW
      ? history.slice(history.length - AUTO_SKILLIFY_HISTORY_WINDOW)
      : history;
  return runAutoSkillifyFromEvents(agent, extractToolCallEventsFromHistory(window));
}

/**
 * Same pipeline as {@link runAutoSkillify}, but from an explicit event list
 * (e.g. Job worker trajectories fed into the Conductor main agent).
 */
export async function runAutoSkillifyFromEvents(
  agent: Agent,
  events: readonly ToolCallEvent[],
): Promise<AutoSkillifyRunResult> {
  const history = agent.context.history;
  const window =
    history.length > AUTO_SKILLIFY_HISTORY_WINDOW
      ? history.slice(history.length - AUTO_SKILLIFY_HISTORY_WINDOW)
      : history;
  const hasRecovery =
    detectSkillifiableEvents(events).length > 0 || hasDistillSignal(events);
  if (!hasRecovery && !historyHasUserCorrection(window)) {
    return { examined: events.length, written: [] };
  }

  const workerBlock =
    events.length > 0 ? `\n\nWorker / extracted tool events:\n${formatWorkerEventsForDistill(events)}` : '';
  const serialized = `${serializeHistoryForDistill(agent)}${workerBlock}`;
  try {
    const result = await runLessonDistill(agent, serialized);
    return { examined: events.length, written: result === undefined ? [] : [result.writtenPath] };
  } catch (error) {
    agent.log.warn('auto-skillify distill failed', error);
    return { examined: events.length, written: [] };
  }
}

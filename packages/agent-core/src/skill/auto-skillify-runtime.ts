/**
 * Wire auto-skillify into a live agent: extract tool outcomes from recent
 * history, write reusable SKILL.md files under `.agents/skills/auto/`, and
 * register them so SearchSkill/Skill see them without a restart.
 */

import path from 'pathe';

import type { ContextMessage } from '../agent/context/types';
import type { Agent } from '../agent/index';
import { autoSkillsRoot } from '../tools/builtin/fleet/skill-create';
import {
  batchSkillify,
  detectSkillifiableEvents,
  type ToolCallEvent,
} from './auto-skillify';
import { parseSkillMetadataFromFile } from './parser';

export type { ToolCallEvent };

/** Cap how many auto skills one turn-end flush may write (spam guard). */
export const AUTO_SKILLIFY_MAX_PER_RUN = 3;

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
  const failStreakByTool = new Map<string, { count: number; lastError?: string }>();
  const events: ToolCallEvent[] = [];

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls) {
        if (call.id.length > 0 && call.name.length > 0) {
          nameByCallId.set(call.id, call.name);
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
      outputSummary: outputText.slice(0, 300) || undefined,
    });
  }

  return events;
}

export interface AutoSkillifyRunResult {
  readonly examined: number;
  readonly written: readonly string[];
}

/**
 * Detect + write + live-register auto skills from the agent's recent history.
 * No-op when there is nothing skillifiable.
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
  const candidates = detectSkillifiableEvents(events);
  if (candidates.length === 0) {
    return { examined: events.length, written: [] };
  }

  const existingNames =
    agent.skills?.registry.listInvocableSkills().map((skill) => skill.name) ?? [];
  const autoRoot = autoSkillsRoot(agent.config.cwd);
  const skillsDir = path.dirname(autoRoot);
  const limited = candidates.slice(0, AUTO_SKILLIFY_MAX_PER_RUN);

  const written = await batchSkillify(limited, {
    skillsDir,
    existingSkillNames: existingNames,
  });

  for (const skillMdPath of written) {
    await registerWrittenSkill(agent, skillMdPath);
  }

  return { examined: events.length, written };
}

async function registerWrittenSkill(agent: Agent, skillMdPath: string): Promise<void> {
  const registry = agent.skills?.registry;
  if (registry?.register === undefined) return;
  const name = path.basename(path.dirname(skillMdPath));
  try {
    const parsed = await parseSkillMetadataFromFile({
      skillMdPath,
      skillDirName: name,
      source: 'project',
    });
    registry.register(parsed, { replace: true });
  } catch (error) {
    agent.log.warn('auto-skillify register failed', { skillMdPath, error });
  }
}

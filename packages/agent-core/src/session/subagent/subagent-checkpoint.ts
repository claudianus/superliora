import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { resolveLioraHome } from '#/config/path';
import { writeFileAtomicSync } from '#/utils/fs';

export const SUBAGENT_CHECKPOINT_VERSION = 1;

const CHECKPOINT_DIRNAME = 'subagent-checkpoints';

/**
 * Durable progress snapshot for a running subagent (harness reform T4-5).
 * Written every N tool calls so a resume after timeout can start from the
 * last known state instead of blindly re-running the task.
 */
export interface SubagentCheckpoint {
  readonly version: number;
  readonly subagentId: string;
  readonly toolCount: number;
  readonly lastTool?: string;
  readonly lastTarget?: string;
  readonly tokens: number;
  readonly elapsedMs: number;
  readonly todos?: readonly unknown[];
  readonly dirtyFiles?: readonly string[];
  readonly savedAt: string;
}

export type SubagentCheckpointInput = Omit<
  SubagentCheckpoint,
  'version' | 'subagentId' | 'savedAt'
>;

function safeFileName(subagentId: string): string {
  // Dots are excluded so ids like "../x" cannot escape the checkpoint dir.
  return subagentId.replaceAll(/[^A-Za-z0-9_-]/g, '_');
}

export function subagentCheckpointPath(subagentId: string, homeDir?: string): string {
  return join(resolveLioraHome(homeDir), CHECKPOINT_DIRNAME, `${safeFileName(subagentId)}.json`);
}

/** Best-effort atomic write; checkpointing must never break a subagent run. */
export function writeSubagentCheckpoint(
  subagentId: string,
  input: SubagentCheckpointInput,
  homeDir?: string,
): void {
  try {
    const checkpoint: SubagentCheckpoint = {
      version: SUBAGENT_CHECKPOINT_VERSION,
      subagentId,
      savedAt: new Date().toISOString(),
      ...input,
    };
    writeFileAtomicSync(subagentCheckpointPath(subagentId, homeDir), JSON.stringify(checkpoint));
  } catch {
    // Best effort only.
  }
}

export function readSubagentCheckpoint(
  subagentId: string,
  homeDir?: string,
): SubagentCheckpoint | undefined {
  try {
    const parsed = JSON.parse(readFileSync(subagentCheckpointPath(subagentId, homeDir), 'utf8')) as
      | SubagentCheckpoint
      | undefined;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      parsed.version !== SUBAGENT_CHECKPOINT_VERSION ||
      parsed.subagentId !== subagentId
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function clearSubagentCheckpoint(subagentId: string, homeDir?: string): void {
  try {
    unlinkSync(subagentCheckpointPath(subagentId, homeDir));
  } catch {
    // Already gone.
  }
}

interface TodoLike {
  readonly title?: unknown;
  readonly status?: unknown;
}

/** Render the reminder injected into a resumed subagent's context. */
export function buildCheckpointRecoveryReminder(checkpoint: SubagentCheckpoint): string {
  const lines: string[] = [
    'You are resuming after an interruption. A checkpoint from the previous run was recovered:',
    `- tool calls completed: ${String(checkpoint.toolCount)}`,
    `- tokens spent: ${String(checkpoint.tokens)}`,
    `- elapsed before interruption: ${Math.round(checkpoint.elapsedMs / 1000)}s`,
  ];
  if (checkpoint.lastTool !== undefined) {
    const target = checkpoint.lastTarget !== undefined ? ` (${checkpoint.lastTarget})` : '';
    lines.push(`- last tool: ${checkpoint.lastTool}${target}`);
  }
  const todos = (checkpoint.todos ?? []).filter(
    (item): item is TodoLike => item !== null && typeof item === 'object',
  );
  if (todos.length > 0) {
    lines.push('- todo list at interruption:');
    for (const todo of todos.slice(0, 20)) {
      const title = typeof todo.title === 'string' ? todo.title : '(untitled)';
      const status = typeof todo.status === 'string' ? todo.status : 'pending';
      lines.push(`  - [${status}] ${title}`);
    }
  }
  const dirty = checkpoint.dirtyFiles ?? [];
  if (dirty.length > 0) {
    lines.push(`- uncommitted file changes: ${dirty.slice(0, 20).join(', ')}`);
  }
  lines.push(
    'Do not repeat completed work. Verify the current state first, then continue from where the checkpoint stopped.',
  );
  return lines.join('\n');
}

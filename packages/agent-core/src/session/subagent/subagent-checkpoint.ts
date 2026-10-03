import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { resolveLioraHome } from '#/config/path';
import { writeFileAtomicSync } from '#/utils/fs';
import { log } from '../../logging/logger';

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
  } catch (error) {
    log.warn('Worker checkpoint persistence failed', { agentId: subagentId, error });
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
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    log.warn('Worker checkpoint read failed', { agentId: subagentId, error });
    return undefined;
  }
}

export function clearSubagentCheckpoint(subagentId: string, homeDir?: string): void {
  try {
    unlinkSync(subagentCheckpointPath(subagentId, homeDir));
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
    log.warn('Worker checkpoint cleanup failed', { agentId: subagentId, error });
  }
}

/** Render the reminder injected into a resumed subagent's context. */
export function buildCheckpointRecoveryReminder(checkpoint: SubagentCheckpoint): string {
  const lines: string[] = [
    'Recovered checkpoint from the previous worker run:',
    `- tool calls completed: ${String(checkpoint.toolCount)}`,
    `- tokens spent: ${String(checkpoint.tokens)}`,
    `- elapsed before interruption: ${Math.round(checkpoint.elapsedMs / 1000)}s`,
  ];
  if (checkpoint.lastTool !== undefined) {
    const target = checkpoint.lastTarget !== undefined ? ` (${checkpoint.lastTarget})` : '';
    lines.push(`- last tool: ${checkpoint.lastTool}${target}`);
  }
  const dirty = checkpoint.dirtyFiles ?? [];
  if (dirty.length > 0) {
    lines.push(`- uncommitted file changes: ${dirty.slice(0, 20).join(', ')}`);
  }
  return lines.join('\n');
}

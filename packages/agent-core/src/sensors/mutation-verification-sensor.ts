/**
 * PostToolUse quality-loop sensor (SOTA harness Phase B / reform T2-ish).
 *
 * After Edit/Write/ApplyPatch succeeds, remind the model to run mechanical
 * checks before claiming done. Tracks pending mutations so Goal soft advisory
 * can surface "mutated but never verified" evidence.
 *
 * Soft only — never hard-blocks the tool result or Goal complete (Mission/UW
 * hard gates remain separate).
 */

import type { ExecutableToolResult } from '../loop/types';

export const FILE_MUTATION_TOOL_NAMES = new Set(['Edit', 'Write', 'ApplyPatch']);

/** Max pending mutation records retained for soft advisory. */
export const MUTATION_SENSOR_MAX_PENDING = 12;

/** Mutations older than this are ignored for Goal soft advisory. */
export const MUTATION_SENSOR_RECENCY_MS = 30 * 60 * 1000;

export const MUTATION_VERIFY_NUDGE =
  'PostToolUse sensor: source mutated. Before claiming done, run RunProjectChecks (or package-scoped test/typecheck/lint).';

export const MUTATION_SENSOR_GOAL_DONE_TIP =
  'Soft sensor: files were mutated this session without a subsequent green RunProjectChecks — re-verify before telling the user you are done.';

export interface MutationRecord {
  readonly toolName: string;
  readonly recordedAtMs: number;
}

export interface MutationVerificationLedger {
  pending: MutationRecord[];
  lastCheckPassAtMs?: number | undefined;
}

export function createMutationVerificationLedger(): MutationVerificationLedger {
  return { pending: [] };
}

export function isFileMutationTool(toolName: string): boolean {
  return FILE_MUTATION_TOOL_NAMES.has(toolName);
}

export function recordFileMutation(
  ledger: MutationVerificationLedger,
  toolName: string,
  recordedAtMs: number = Date.now(),
): void {
  ledger.pending.push({ toolName, recordedAtMs });
  if (ledger.pending.length > MUTATION_SENSOR_MAX_PENDING) {
    ledger.pending.splice(0, ledger.pending.length - MUTATION_SENSOR_MAX_PENDING);
  }
}

export function clearPendingMutations(
  ledger: MutationVerificationLedger,
  nowMs: number = Date.now(),
): void {
  ledger.pending = [];
  ledger.lastCheckPassAtMs = nowMs;
}

export function filterRecentMutations(
  pending: readonly MutationRecord[],
  nowMs: number = Date.now(),
): MutationRecord[] {
  const cutoff = nowMs - MUTATION_SENSOR_RECENCY_MS;
  return pending.filter((record) => record.recordedAtMs >= cutoff);
}

/**
 * After a successful file mutation tool, record pending work and append a
 * short verification nudge to the tool output (once per result).
 */
export function observeFileMutationToolResult(
  ledger: MutationVerificationLedger,
  toolName: string,
  result: ExecutableToolResult,
): ExecutableToolResult {
  if (!isFileMutationTool(toolName) || result.isError === true) {
    return result;
  }
  recordFileMutation(ledger, toolName);
  return appendMutationNudge(result);
}

export function appendMutationNudge(result: ExecutableToolResult): ExecutableToolResult {
  const text = toolResultText(result.output);
  if (text === undefined) return result;
  if (text.includes('PostToolUse sensor: source mutated')) return result;
  const output =
    typeof result.output === 'string'
      ? `${result.output}\n\n${MUTATION_VERIFY_NUDGE}`
      : result.output;
  return result.isError === true
    ? { ...result, output, isError: true }
    : { ...result, output };
}

export function buildPendingMutationSoftTips(
  ledger: MutationVerificationLedger,
  nowMs: number = Date.now(),
): readonly string[] {
  const recent = filterRecentMutations(ledger.pending, nowMs);
  if (recent.length === 0) return [];
  const lastPass = ledger.lastCheckPassAtMs;
  if (lastPass !== undefined) {
    const newestMutation = Math.max(...recent.map((r) => r.recordedAtMs));
    if (lastPass >= newestMutation) return [];
  }
  const latest = recent.at(-1)!;
  return [
    MUTATION_SENSOR_GOAL_DONE_TIP,
    `· Latest mutation tool: ${latest.toolName} (${String(recent.length)} pending in window)`,
    'Run RunProjectChecks (or the package test/typecheck/lint suite) and confirm green.',
  ];
}

function toolResultText(output: ExecutableToolResult['output']): string | undefined {
  if (typeof output === 'string') return output;
  return undefined;
}

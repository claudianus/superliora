/**
 * PostToolUse quality-loop sensor (SOTA harness Phase B / reform T2-ish).
 *
 * After Edit/Write/ApplyPatch succeeds, remind the model to run mechanical
 * checks before claiming done. Tracks pending mutations so Goal soft advisory
 * can surface "mutated but never verified" evidence.
 *
 * Soft only — never hard-blocks the tool result or Goal complete (Mission/UW
 * hard gates remain separate).
 *
 * Loop13: when all mutated paths share one packages/apps scope, the nudge
 * names that packageDir so the model can run package-scoped RunProjectChecks
 * instead of a vague repo-wide check.
 */

import type { ExecutableToolResult } from '../loop/types';
import { pathsLookLikeUi } from '../premium-quality/ui-surface';
import { withAutoCheckDirective } from './auto-check-sensor';

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
  /** packages/<name> or apps/<name> when all paths in this mutation share one scope. */
  readonly packageDir?: string | undefined;
  /** Paths from this mutation (for UI-surface stop proof). */
  readonly paths?: readonly string[] | undefined;
}

export interface MutationVerificationLedger {
  pending: MutationRecord[];
  lastCheckPassAtMs?: number | undefined;
  /**
   * Sticky: UI-looking paths were mutated. Survives RunProjectChecks clear;
   * cleared only after VerifySurface load+interaction+craft pass.
   */
  uiSurfaceProofPending?: boolean | undefined;
}

export function createMutationVerificationLedger(): MutationVerificationLedger {
  return { pending: [] };
}

export function isFileMutationTool(toolName: string): boolean {
  return FILE_MUTATION_TOOL_NAMES.has(toolName);
}

/**
 * Scope a set of paths to one workspace package when every path lives under
 * the same `packages/<name>/` or `apps/<name>/` prefix. Mirrors
 * `deriveVerificationPackageDir` (subagent gate) so soft tips and hard gates
 * agree on package scope without sensors importing session/.
 */
export function deriveMutationPackageDir(
  filesChanged: readonly string[],
): string | undefined {
  if (filesChanged.length === 0) return undefined;
  let scope: string | undefined;
  for (const file of filesChanged) {
    const normalized = file.replace(/\\/g, '/');
    const match = /(?:^|\/)((?:packages|apps)\/[^/]+)\//.exec(normalized);
    if (match === null || match[1] === undefined) return undefined;
    const dir = match[1];
    if (scope === undefined) {
      scope = dir;
    } else if (scope !== dir) {
      return undefined;
    }
  }
  return scope;
}

/** Extract mutated file paths from Edit/Write/ApplyPatch tool args. */
export function extractMutationPathsFromToolArgs(
  toolName: string,
  args: Record<string, unknown> | undefined,
): string[] {
  if (args === undefined) return [];
  if (toolName === 'Edit' || toolName === 'Write') {
    const path = args['path'];
    return typeof path === 'string' && path.length > 0 ? [path] : [];
  }
  if (toolName === 'ApplyPatch') {
    const patch = args['patch'];
    if (typeof patch !== 'string' || patch.length === 0) return [];
    return extractPathsFromOpenCodePatch(patch);
  }
  return [];
}

const OPEN_CODE_FILE_LINE =
  /^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/gm;

export function extractPathsFromOpenCodePatch(patch: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const match of patch.matchAll(OPEN_CODE_FILE_LINE)) {
    const raw = match[1]?.trim();
    if (raw === undefined || raw.length === 0 || seen.has(raw)) continue;
    seen.add(raw);
    paths.push(raw);
  }
  return paths;
}

export function recordFileMutation(
  ledger: MutationVerificationLedger,
  toolName: string,
  recordedAtMs: number = Date.now(),
  packageDir?: string | undefined,
  paths?: readonly string[] | undefined,
): void {
  ledger.pending.push({
    toolName,
    recordedAtMs,
    packageDir,
    paths,
  });
  if (pathsLookLikeUi(paths)) {
    ledger.uiSurfaceProofPending = true;
  }
  if (ledger.pending.length > MUTATION_SENSOR_MAX_PENDING) {
    ledger.pending.splice(0, ledger.pending.length - MUTATION_SENSOR_MAX_PENDING);
  }
}

export function clearUiSurfaceProofPending(ledger: MutationVerificationLedger): void {
  ledger.uiSurfaceProofPending = false;
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
 *
 * Optional `toolArgs` enables package-scoped check hints (Loop13).
 */
export function observeFileMutationToolResult(
  ledger: MutationVerificationLedger,
  toolName: string,
  result: ExecutableToolResult,
  toolArgs?: Record<string, unknown> | undefined,
): ExecutableToolResult {
  if (!isFileMutationTool(toolName) || result.isError === true) {
    return result;
  }
  const paths = extractMutationPathsFromToolArgs(toolName, toolArgs);
  const packageDir = deriveMutationPackageDir(paths);
  recordFileMutation(ledger, toolName, Date.now(), packageDir, paths);
  return appendMutationNudge(result, packageDir);
}

export function formatMutationVerifyNudge(packageDir?: string | undefined): string {
  const base =
    packageDir === undefined
      ? MUTATION_VERIFY_NUDGE
      : `PostToolUse sensor: source mutated under \`${packageDir}\`. ` +
        `Before claiming done, run RunProjectChecks with packageDir=${packageDir} ` +
        `(or package-scoped test/typecheck/lint).`;
  const withSurface =
    `${base} On UI surfaces call VerifySurface (load+interaction+craft); ` +
    `BrowserScreenshot alone does not set visual=passed.`;
  // Loop16a: SUPERLIORA_AUTO_CHECK=1 upgrades nudge to machine-actionable directive.
  return withAutoCheckDirective(withSurface, packageDir);
}

export function appendMutationNudge(
  result: ExecutableToolResult,
  packageDir?: string | undefined,
): ExecutableToolResult {
  const text = toolResultText(result.output);
  if (text === undefined) return result;
  if (text.includes('PostToolUse sensor: source mutated')) return result;
  const nudge = formatMutationVerifyNudge(packageDir);
  const output =
    typeof result.output === 'string' ? `${result.output}\n\n${nudge}` : result.output;
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
  // Prefer a packageDir only when every recent record agrees on the same scope.
  const packageDirs = recent
    .map((r) => r.packageDir)
    .filter((dir): dir is string => typeof dir === 'string' && dir.length > 0);
  const unanimousPackageDir =
    packageDirs.length === recent.length &&
    packageDirs.length > 0 &&
    packageDirs.every((d) => d === packageDirs[0])
      ? packageDirs[0]
      : undefined;

  const tips: string[] = [
    MUTATION_SENSOR_GOAL_DONE_TIP,
    `· Latest mutation tool: ${latest.toolName} (${String(recent.length)} pending in window)`,
  ];
  if (unanimousPackageDir !== undefined) {
    tips.push(
      `· Scope: ${unanimousPackageDir} — run RunProjectChecks with packageDir=${unanimousPackageDir}.`,
    );
  } else {
    tips.push(
      'Run RunProjectChecks (or the package test/typecheck/lint suite) and confirm green.',
    );
  }
  // Loop16a: opt-in AUTO_CHECK directive on Goal soft tips.
  const autoLine = withAutoCheckDirective('', unanimousPackageDir).trim();
  if (autoLine.length > 0) {
    tips.push(autoLine);
  }
  return tips;
}

function toolResultText(output: ExecutableToolResult['output']): string | undefined {
  if (typeof output === 'string') return output;
  return undefined;
}

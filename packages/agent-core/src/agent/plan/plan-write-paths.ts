/**
 * Pure path allow-list for plan-file writes during plan mode.
 * Shared by plan-mode guard (deny) and plan-mode approve (Manual no-ask).
 */

import { normalize } from 'pathe';

export interface PlanWriteContext {
  readonly planFilePath: string | null | undefined;
  readonly workDir: string;
}

/**
 * Lexical path equality that tolerates relative vs absolute forms against workDir.
 */
export function pathsEqualForPlanWrite(
  left: string,
  right: string,
  workDir: string,
): boolean {
  const a = normalizePlanPath(left, workDir);
  const b = normalizePlanPath(right, workDir);
  return a === b;
}

export function normalizePlanPath(path: string, workDir: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) return '';
  const n = normalize(trimmed);
  if (n.startsWith('/') || /^[A-Za-z]:[\\/]/.test(n)) {
    return n;
  }
  if (workDir.length === 0) return n;
  return normalize(`${workDir.replace(/\/+$/, '')}/${n}`);
}

/** True when every write path is the active plan file. */
export function isPlanPhaseAllowedWrite(
  writePaths: readonly string[],
  ctx: PlanWriteContext,
): boolean {
  if (writePaths.length === 0) return false;
  return writePaths.every((path) => isSinglePlanPhaseAllowedWrite(path, ctx));
}

export function isSinglePlanPhaseAllowedWrite(
  path: string,
  ctx: PlanWriteContext,
): boolean {
  const workDir = typeof ctx.workDir === 'string' && ctx.workDir.length > 0 ? ctx.workDir : '';
  if (
    ctx.planFilePath !== null &&
    ctx.planFilePath !== undefined &&
    ctx.planFilePath.length > 0 &&
    pathsEqualForPlanWrite(path, ctx.planFilePath, workDir)
  ) {
    return true;
  }
  return false;
}

/** Directory that must be sandbox-allowed for plan file writes (parent of plan file). */
export function planFileAllowDir(planFilePath: string | null | undefined): string | undefined {
  if (planFilePath === null || planFilePath === undefined || planFilePath.length === 0) {
    return undefined;
  }
  const n = normalize(planFilePath);
  const idx = n.lastIndexOf('/');
  if (idx <= 0) return undefined;
  return n.slice(0, idx);
}

/**
 * Evaluate GoalPredicateSpec against world state (paths, evidence, optional tests).
 * Whitelist-only test execution — no arbitrary shell.
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import type { UltraworkRun } from '@superliora/protocol';

import { auditUltraworkCompletion } from '../../ultrawork/completion-audit';
import type {
  GoalPredicateEvalResult,
  GoalPredicateFailure,
  GoalPredicateSpec,
} from './predicate';

export interface EvaluateGoalPredicateInput {
  readonly spec: GoalPredicateSpec;
  readonly workspaceRoot: string;
  readonly ultraworkRun?: UltraworkRun | null;
  /** Total evidenceIds count across graph nodes (caller may precompute). */
  readonly evidenceIdCount?: number;
  /** When false, skip spawning vitest (unit tests inject results). Default true. */
  readonly runTests?: boolean;
  readonly testTimeoutMs?: number;
  /** Injected for tests. */
  readonly pathExists?: (absPath: string) => Promise<boolean>;
  readonly runVitestFile?: (absTestFile: string, timeoutMs: number) => Promise<{ ok: boolean; detail: string }>;
}

const DEFAULT_TEST_TIMEOUT_MS = 120_000;

export async function evaluateGoalPredicate(
  input: EvaluateGoalPredicateInput,
): Promise<GoalPredicateEvalResult> {
  const failures: GoalPredicateFailure[] = [];
  const root = resolve(input.workspaceRoot);
  const pathExists = input.pathExists ?? defaultPathExists;

  for (const rel of input.spec.requiredPaths ?? []) {
    const abs = resolveWithinRoot(root, rel);
    if (abs === null) {
      failures.push({
        code: 'missing_path',
        message: `requiredPath escapes workspace or is invalid: ${rel}`,
      });
      continue;
    }
    if (!(await pathExists(abs))) {
      failures.push({
        code: 'missing_path',
        message: `requiredPath does not exist: ${rel}`,
      });
    }
  }

  const minEvidence = input.spec.minEvidenceIds;
  if (minEvidence !== undefined && minEvidence > 0) {
    const count =
      input.evidenceIdCount ??
      countEvidenceIds(input.ultraworkRun ?? null);
    if (count < minEvidence) {
      failures.push({
        code: 'min_evidence',
        message: `minEvidenceIds=${minEvidence} but found ${count} evidence id(s)`,
      });
    }
  }

  const requireGraph =
    input.spec.requireUltraworkGraph === true ||
    (input.spec.requireUltraworkGraph !== false &&
      input.ultraworkRun !== null &&
      input.ultraworkRun !== undefined &&
      input.ultraworkRun.status !== 'done' &&
      input.ultraworkRun.status !== 'failed');

  if (requireGraph && input.ultraworkRun !== null && input.ultraworkRun !== undefined) {
    const audit = auditUltraworkCompletion({
      run: input.ultraworkRun,
      requireWorkGraph: true,
    });
    if (!audit.ok) {
      failures.push({
        code: 'ultrawork_audit',
        message: `Ultrawork completion audit failed (${audit.code}): ${audit.reasons[0] ?? 'unknown'}`,
      });
    }
  } else if (input.spec.requireUltraworkGraph === true && (input.ultraworkRun === null || input.ultraworkRun === undefined)) {
    failures.push({
      code: 'ultrawork_audit',
      message: 'requireUltraworkGraph=true but no live Ultrawork run',
    });
  }

  if (input.runTests !== false) {
    const runVitest = input.runVitestFile ?? defaultRunVitestFile;
    const timeout = input.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
    for (const rel of input.spec.requiredTestFiles ?? []) {
      const abs = resolveWithinRoot(root, rel);
      if (abs === null || !isAllowedTestFile(root, abs)) {
        failures.push({
          code: 'test_failed',
          message: `requiredTestFile not allowed (must be under workspace and look like a test): ${rel}`,
        });
        continue;
      }
      if (!(await pathExists(abs))) {
        failures.push({
          code: 'test_failed',
          message: `requiredTestFile does not exist: ${rel}`,
        });
        continue;
      }
      try {
        const result = await runVitest(abs, timeout);
        if (!result.ok) {
          failures.push({
            code: 'test_failed',
            message: `vitest failed for ${rel}: ${result.detail}`,
          });
        }
      } catch (error) {
        failures.push({
          code: 'runner_error',
          message: `vitest runner error for ${rel}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

export function countEvidenceIds(run: UltraworkRun | null): number {
  if (run === null || run.workGraph === undefined) return 0;
  let n = 0;
  for (const node of run.workGraph.nodes) {
    n += node.evidenceIds?.length ?? 0;
  }
  return n;
}

/** Resolve path under root; null if escapes. */
export function resolveWithinRoot(root: string, maybeRel: string): string | null {
  const abs = isAbsolute(maybeRel) ? normalize(maybeRel) : resolve(root, maybeRel);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  // Disallow null bytes / weird segments
  if (abs.includes('\0')) return null;
  return abs;
}

export function isAllowedTestFile(root: string, absPath: string): boolean {
  const rel = relative(root, absPath);
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  // Must look like a test file under a test directory or *.test.*
  const base = absPath.split(sep).pop() ?? '';
  if (!/\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(base) && !rel.includes(`${sep}test${sep}`)) {
    return false;
  }
  return true;
}

async function defaultPathExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultRunVitestFile(
  absTestFile: string,
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolvePromise) => {
    // Whitelist: node + vitest binary via pnpm exec is too loose; use node_modules vitest if present
    // Fall back to `pnpm exec vitest run <file>` with fixed argv shape only.
    const args = ['exec', 'vitest', 'run', absTestFile];
    const child = spawn('pnpm', args, {
      cwd: process.cwd(),
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolvePromise({ ok: false, detail: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, detail: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({ ok: true, detail: 'exit 0' });
      } else {
        const tail = (stderr || stdout).slice(-500);
        resolvePromise({ ok: false, detail: `exit ${String(code)}: ${tail}` });
      }
    });
  });
}

export function formatPredicateFailures(failures: readonly GoalPredicateFailure[]): string {
  return failures.map((f) => `- [${f.code}] ${f.message}`).join('\n');
}

// re-export join for tests
export { join };

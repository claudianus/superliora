/**
 * Structured result contract for subagent hand-offs (harness reform T4-6).
 *
 * The child's free-form summary stays the primary content; the runtime
 * attaches a machine-readable contract — files changed (git-derived),
 * verification status (filled by the completion gate, T4-4), and
 * deviations. Every field is computed by the runtime, so the contract
 * needs no co-operation from the child.
 */

import type { Kaos } from '@superliora/kaos';

import { runGit, type GitResult } from './git-context';

export type VerificationVerdict = 'passed' | 'failed' | 'not_run';

export interface SubagentVerificationStatus {
  readonly tests: VerificationVerdict;
  readonly typecheck: VerificationVerdict;
  readonly lint: VerificationVerdict;
}

export interface SubagentResultContract {
  readonly agent_id: string;
  readonly profile: string;
  readonly status: 'completed';
  readonly summary: string;
  readonly files_changed: readonly string[];
  readonly verification: SubagentVerificationStatus;
  readonly verification_failed: boolean;
  readonly deviations: readonly string[];
}

export const VERIFICATION_NOT_RUN: SubagentVerificationStatus = {
  tests: 'not_run',
  typecheck: 'not_run',
  lint: 'not_run',
};

const MAX_FILES_CHANGED = 100;

/** Git state snapshot taken before the child starts working. */
export interface GitWorkSnapshot {
  readonly head: string | undefined;
  readonly dirtyFiles: readonly string[];
}

export function buildSubagentResultContract(options: {
  readonly agentId: string;
  readonly profile: string;
  readonly summary: string;
  readonly filesChanged: readonly string[];
  readonly verification?: SubagentVerificationStatus;
  readonly deviations?: readonly string[];
}): SubagentResultContract {
  const verification = options.verification ?? VERIFICATION_NOT_RUN;
  return {
    agent_id: options.agentId,
    profile: options.profile,
    status: 'completed',
    summary: options.summary,
    files_changed: [...options.filesChanged],
    verification,
    verification_failed:
      verification.tests === 'failed' ||
      verification.typecheck === 'failed' ||
      verification.lint === 'failed',
    deviations: [...(options.deviations ?? [])],
  };
}

/**
 * Render the contract as a `<subagent-result>` envelope. The summary is
 * intentionally omitted — it already precedes the envelope verbatim.
 */
export function formatSubagentResultEnvelope(contract: SubagentResultContract): string {
  const envelope = {
    agent_id: contract.agent_id,
    profile: contract.profile,
    status: contract.status,
    files_changed: contract.files_changed,
    verification: contract.verification,
    verification_failed: contract.verification_failed,
    deviations: contract.deviations,
  };
  return `<subagent-result>\n${JSON.stringify(envelope, null, 2)}\n</subagent-result>`;
}

/** Append the contract envelope to a completion summary when present. */
export function renderSubagentCompletionText(completion: {
  readonly result: string;
  readonly contract?: SubagentResultContract;
}): string {
  if (completion.contract === undefined) return completion.result;
  return `${completion.result}\n\n${formatSubagentResultEnvelope(completion.contract)}`;
}

/**
 * Pure diff: committed changes since the snapshot plus currently dirty
 * files, minus files that were already dirty before the child started
 * (those belong to the parent's in-flight work, not the child's).
 */
export function computeFilesChanged(options: {
  readonly committedChanged: readonly string[];
  readonly dirtyBefore: readonly string[];
  readonly dirtyNow: readonly string[];
}): string[] {
  const before = new Set(options.dirtyBefore);
  const merged = new Set<string>();
  for (const file of [...options.committedChanged, ...options.dirtyNow]) {
    if (file.length > 0 && !before.has(file)) merged.add(file);
  }
  return [...merged].sort().slice(0, MAX_FILES_CHANGED);
}

export async function snapshotGitWork(kaos: Kaos, cwd: string): Promise<GitWorkSnapshot> {
  const [head, status] = await Promise.all([
    runGit(kaos, cwd, ['rev-parse', 'HEAD']),
    runGit(kaos, cwd, ['status', '--porcelain']),
  ]);
  return {
    head: head.ok && head.stdout.length > 0 ? head.stdout : undefined,
    dirtyFiles: parseStatusPorcelain(status),
  };
}

export async function collectFilesChanged(
  kaos: Kaos,
  cwd: string,
  before: GitWorkSnapshot,
): Promise<string[]> {
  const after = await snapshotGitWork(kaos, cwd);
  let committedChanged: string[] = [];
  if (before.head !== undefined && after.head !== undefined && before.head !== after.head) {
    const diff = await runGit(kaos, cwd, [
      'diff',
      '--name-only',
      `${before.head}..${after.head}`,
    ]);
    if (diff.ok && diff.stdout.length > 0) {
      committedChanged = diff.stdout.split('\n').filter((line) => line.length > 0);
    }
  }
  return computeFilesChanged({
    committedChanged,
    dirtyBefore: before.dirtyFiles,
    dirtyNow: after.dirtyFiles,
  });
}

function parseStatusPorcelain(result: GitResult): string[] {
  if (!result.ok || result.stdout.length === 0) return [];
  const files: string[] = [];
  for (const line of result.stdout.split('\n')) {
    if (line.length < 4) continue;
    let path = line.slice(3).trim();
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4);
    if (path.length > 0) files.push(path);
  }
  return files;
}

/**
 * Scope the completion gate to a single workspace package when every
 * changed file lives under the same `packages/<name>/` or `apps/<name>/`
 * prefix. Returns `undefined` when the change set is empty, spans multiple
 * packages, or touches files outside the package layout — the gate skips
 * rather than paying for a repo-wide run.
 */
export function deriveVerificationPackageDir(
  filesChanged: readonly string[],
): string | undefined {
  if (filesChanged.length === 0) return undefined;
  let scope: string | undefined;
  for (const file of filesChanged) {
    const match = /^(?:packages|apps)\/[^/]+\//.exec(file);
    if (match === null) return undefined;
    const dir = match[0].slice(0, -1);
    if (scope === undefined) {
      scope = dir;
    } else if (scope !== dir) {
      return undefined;
    }
  }
  return scope;
}

export interface ProjectCheckOutcomeLike {
  readonly name: string;
  readonly exitCode: number;
  readonly skipped?: boolean;
}

/** Map a run-project-checks outcome onto a single verification verdict. */
export function verdictFromCheckOutcomes(
  outcomes: readonly ProjectCheckOutcomeLike[],
  kind: 'test' | 'typecheck' | 'lint',
): VerificationVerdict {
  const outcome = outcomes.find((entry) => entry.name === kind);
  if (outcome === undefined || outcome.skipped === true) return 'not_run';
  return outcome.exitCode === 0 ? 'passed' : 'failed';
}

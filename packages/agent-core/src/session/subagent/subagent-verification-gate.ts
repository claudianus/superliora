/**
 * Completion verification gate (harness reform T4-4): when a subagent's change
 * set is scoped to a single workspace package, run that package's test /
 * typecheck / lint scripts and record verdicts on the result contract.
 *
 * Extracted from subagent-host so verification policy does not grow the host
 * class body.
 */

import type { Kaos } from '@superliora/kaos';

import type { Agent } from '../../agent';
import { RunProjectChecksTool } from '../../tools/builtin/ops/run-project-checks';
import {
  isStaticSiteChangeSet,
  runStaticSiteChecks,
} from '../../tools/builtin/ops/static-site-checks';
import {
  buildSubagentResultContract,
  collectFilesChanged,
  deriveVerificationPackageDir,
  verdictFromCheckOutcomes,
  VERIFICATION_NOT_RUN,
  type GitWorkSnapshot,
  type ProjectCheckOutcomeLike,
  type SubagentResultContract,
  type SubagentVerificationStatus,
} from './subagent-result-contract';

/** Per-check timeout for the completion verification gate (T4-4). */
const COMPLETION_CHECK_TIMEOUT_MS = 180_000;
/** Overall ceiling for the completion verification gate (T4-4). */
const COMPLETION_VERIFICATION_TOTAL_MS = 600_000;

export async function buildChildResultContract(
  child: Agent,
  childId: string,
  profileName: string,
  summary: string,
  workSnapshot: GitWorkSnapshot,
  signal: AbortSignal | undefined,
): Promise<SubagentResultContract> {
  let filesChanged: string[] = [];
  try {
    filesChanged = await collectFilesChanged(child.kaos, child.config.cwd, workSnapshot);
  } catch {
    filesChanged = [];
  }
  const verification = await runCompletionVerification(child, profileName, filesChanged, signal);
  return buildSubagentResultContract({
    agentId: childId,
    profile: profileName,
    summary,
    filesChanged,
    verification,
  });
}

/**
 * Read-only profiles and ambiguous scopes skip the gate (verdicts stay
 * `not_run`) rather than paying for a repo-wide run.
 */
export async function runCompletionVerification(
  child: Agent,
  profileName: string,
  filesChanged: readonly string[],
  signal: AbortSignal | undefined,
): Promise<SubagentVerificationStatus> {
  if (profileName === 'explore') return VERIFICATION_NOT_RUN;
  const packageDir = deriveVerificationPackageDir(filesChanged);
  if (packageDir === undefined) {
    // Static-site contract: pure HTML/CSS/JS change sets have no package.json
    // scripts to run. Verify what the deliverable can prove (existence + JS
    // syntax) instead of recording "checks did not run" forever.
    if (isStaticSiteChangeSet(filesChanged)) {
      return runStaticCompletionVerification(child.kaos, child.config.cwd, filesChanged);
    }
    return VERIFICATION_NOT_RUN;
  }
  try {
    const tool = new RunProjectChecksTool(child.kaos, child.config.cwd);
    const execution = tool.resolveExecution({
      checks: ['test', 'typecheck', 'lint'],
      packageDir,
      timeoutMs: COMPLETION_CHECK_TIMEOUT_MS,
    });
    if (execution.isError === true) return VERIFICATION_NOT_RUN;
    const gateSignal =
      signal === undefined
        ? AbortSignal.timeout(COMPLETION_VERIFICATION_TOTAL_MS)
        : AbortSignal.any([signal, AbortSignal.timeout(COMPLETION_VERIFICATION_TOTAL_MS)]);
    const result = await execution.execute({
      turnId: 'subagent-verification',
      toolCallId: 'subagent-verification',
      signal: gateSignal,
    });
    const text = typeof result.output === 'string' ? result.output : '';
    const parsed = JSON.parse(text) as {
      readonly checks?: readonly ProjectCheckOutcomeLike[];
    };
    const checks = parsed.checks ?? [];
    return {
      tests: verdictFromCheckOutcomes(checks, 'test'),
      typecheck: verdictFromCheckOutcomes(checks, 'typecheck'),
      lint: verdictFromCheckOutcomes(checks, 'lint'),
    };
  } catch {
    return VERIFICATION_NOT_RUN;
  }
}

/**
 * Static-site completion contract. One check stands in for the whole gate —
 * a static site has no test/typecheck/lint toolchain, so existence + JS
 * syntax is the entire verifiable surface — so the verdict maps onto all
 * three slots and `verificationIsGreen` can actually go green.
 */
async function runStaticCompletionVerification(
  kaos: Kaos,
  cwd: string,
  filesChanged: readonly string[],
): Promise<SubagentVerificationStatus> {
  try {
    const outcome = await runStaticSiteChecks(kaos, cwd, filesChanged);
    return outcome.ok
      ? { tests: 'passed', typecheck: 'passed', lint: 'passed' }
      : { tests: 'failed', typecheck: 'failed', lint: 'failed' };
  } catch {
    return VERIFICATION_NOT_RUN;
  }
}

/**
 * Completion verification gate (harness reform T4-4): when a subagent's change
 * set is scoped to a single workspace package, run that package's test /
 * typecheck / lint scripts and record verdicts on the result contract.
 *
 * Extracted from subagent-host so verification policy does not grow the host
 * class body.
 *
 * Visual slots honor the verification sensor (VerifySurface / TUI smoke) —
 * path/keyword regex must not invent a web UI requirement.
 */

import type { Kaos } from '@superliora/kaos';

import type { Agent } from '../../agent';
import { RunProjectChecksTool } from '../../tools/builtin/ops/run-project-checks';
import {
  isRenderableStaticSiteChangeSet,
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
  type VisualVerificationVerdict,
} from './subagent-result-contract';
import { maybeAutoVerifySurface } from './subagent-visual-completion';

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
    verification: await withVisualVerdict(verification, child, filesChanged, summary, signal),
  });
}

async function withVisualVerdict(
  verification: SubagentVerificationStatus,
  child: Agent,
  filesChanged: readonly string[],
  summary: string,
  signal: AbortSignal | undefined,
): Promise<SubagentVerificationStatus> {
  const visual = await resolveVisualVerdict(child, filesChanged, summary, signal);
  const ledger = child.verificationSensorLedger;
  // Axes only stick when VerifySurface recorded them; otherwise N/A (TUI smoke
  // and non-visual jobs must not inherit not_run interaction/craft gates).
  const interaction =
    ledger.interactionVerdict === 'passed' || ledger.interactionVerdict === 'failed'
      ? ledger.interactionVerdict
      : visual === 'passed' && ledger.visualVerdict === 'passed' && ledger.interactionVerdict === undefined
        ? 'not_applicable'
        : visual === 'not_applicable'
          ? 'not_applicable'
          : ledger.interactionVerdict === 'not_run'
            ? 'not_run'
            : 'not_applicable';
  const craft =
    ledger.craftVerdict === 'passed' || ledger.craftVerdict === 'failed'
      ? ledger.craftVerdict
      : visual === 'passed' && ledger.visualVerdict === 'passed' && ledger.craftVerdict === undefined
        ? 'not_applicable'
        : visual === 'not_applicable'
          ? 'not_applicable'
          : ledger.craftVerdict === 'not_run'
            ? 'not_run'
            : 'not_applicable';
  return { ...verification, visual, interaction, craft };
}

async function resolveVisualVerdict(
  child: Agent,
  filesChanged: readonly string[],
  summary: string,
  signal: AbortSignal | undefined,
): Promise<VisualVerificationVerdict> {
  const observed = child.verificationSensorLedger.visualVerdict;
  if (observed === 'passed' || observed === 'failed') return observed;
  // Auto VerifySurface only when a URL/HTML surface exists (tool decides).
  const auto = await maybeAutoVerifySurface(child, filesChanged, summary, signal);
  if (auto === 'passed' || auto === 'failed') return auto;
  // No URL/HTML / skipped → N/A. Job.surfaceKind decides if that blocks merge.
  return 'not_applicable';
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
    // Static-site contract: only renderable HTML/CSS/JS sets (not docs/json alone)
    // may stamp checks green via existence + node --check.
    if (isRenderableStaticSiteChangeSet(filesChanged)) {
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
      visual: 'not_run',
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
      ? { tests: 'passed', typecheck: 'passed', lint: 'passed', visual: 'not_run' }
      : { tests: 'failed', typecheck: 'failed', lint: 'failed', visual: 'not_run' };
  } catch {
    return VERIFICATION_NOT_RUN;
  }
}

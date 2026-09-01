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
  type HostBrowserStatus,
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
    verification: await withVisualVerdict(
      verification,
      child,
      filesChanged,
      summary,
      signal,
      profileName,
    ),
  });
}

async function withVisualVerdict(
  verification: SubagentVerificationStatus,
  child: Agent,
  filesChanged: readonly string[],
  summary: string,
  signal: AbortSignal | undefined,
  profileName: string,
): Promise<SubagentVerificationStatus> {
  const visual = await resolveVisualVerdict(
    child,
    filesChanged,
    summary,
    signal,
    profileName,
  );
  const ledger = child.verificationSensorLedger;
  // Axes only stick when VerifySurface recorded them; otherwise N/A (TUI smoke
  // and non-visual jobs must not inherit not_run interaction/craft gates).
  // not_applicable = the surface offered nothing to score (canvas/visual UI) —
  // sticky, not a pending gate.
  const interaction =
    ledger.interactionVerdict === 'passed' ||
    ledger.interactionVerdict === 'failed' ||
    ledger.interactionVerdict === 'not_applicable'
      ? ledger.interactionVerdict
      : visual === 'passed' && ledger.visualVerdict === 'passed' && ledger.interactionVerdict === undefined
        ? 'not_applicable'
        : visual === 'not_applicable'
          ? 'not_applicable'
          : ledger.interactionVerdict === 'not_run'
            ? 'not_run'
            : 'not_applicable';
  const craft =
    ledger.craftVerdict === 'passed' ||
    ledger.craftVerdict === 'failed' ||
    ledger.craftVerdict === 'not_applicable'
      ? ledger.craftVerdict
      : visual === 'passed' && ledger.visualVerdict === 'passed' && ledger.craftVerdict === undefined
        ? 'not_applicable'
        : visual === 'not_applicable'
          ? 'not_applicable'
          : ledger.craftVerdict === 'not_run'
            ? 'not_run'
            : 'not_applicable';
  const hostBrowser: HostBrowserStatus | undefined =
    ledger.hostBrowser === 'einval' ||
    ledger.hostBrowser === 'missing' ||
    ledger.hostBrowser === 'ok'
      ? ledger.hostBrowser
      : undefined;
  return {
    ...verification,
    visual,
    interaction,
    craft,
    ...(hostBrowser !== undefined ? { host_browser: hostBrowser } : {}),
    playable: inferPlayable(filesChanged, summary),
  };
}

function inferPlayable(
  filesChanged: readonly string[],
  summary: string,
): 'yes' | 'unknown' {
  const hay = `${filesChanged.join('\n')}\n${summary}`.toLowerCase();
  if (filesChanged.some((file) => /(?:^|\/)index\.html?$/i.test(file.replaceAll('\\', '/')))) {
    return 'yes';
  }
  if (/https?:\/\/localhost\b|python\s+-m\s+http\.server|file:\/\//i.test(hay)) {
    return 'yes';
  }
  return 'unknown';
}

async function resolveVisualVerdict(
  child: Agent,
  filesChanged: readonly string[],
  summary: string,
  signal: AbortSignal | undefined,
  profileName: string,
): Promise<VisualVerificationVerdict> {
  const observed = child.verificationSensorLedger.visualVerdict;
  if (observed === 'passed' || observed === 'failed' || observed === 'skipped_host') {
    return observed;
  }
  if (profileName === 'explore') return 'not_applicable';
  // Auto VerifySurface only when a URL/HTML surface exists (tool decides).
  const auto = await maybeAutoVerifySurface(child, filesChanged, summary, signal);
  if (auto === 'passed' || auto === 'failed' || auto === 'skipped_host') return auto;
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

  const fromPackage = await runPackageCompletionVerification(child, packageDir, signal);
  if (fromPackage !== undefined) return fromPackage;

  // Root HTML/JS sites often have no package.json — keep the static contract.
  if (packageDir === '.' && isRenderableStaticSiteChangeSet(filesChanged)) {
    return runStaticCompletionVerification(child.kaos, child.config.cwd, filesChanged);
  }
  return VERIFICATION_NOT_RUN;
}

async function runPackageCompletionVerification(
  child: Agent,
  packageDir: string,
  signal: AbortSignal | undefined,
): Promise<SubagentVerificationStatus | undefined> {
  try {
    const tool = new RunProjectChecksTool(child.kaos, child.config.cwd);
    const execution = tool.resolveExecution({
      checks: ['test', 'typecheck', 'lint'],
      packageDir,
      timeoutMs: COMPLETION_CHECK_TIMEOUT_MS,
    });
    if (execution.isError === true) return undefined;
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
    return undefined;
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

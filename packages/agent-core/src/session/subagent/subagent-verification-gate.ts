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
import type { CheckKindVerdicts } from '../../sensors/verification-sensor-ledger';
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
  type VerificationVerdict,
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

/** True when the script/static gate produced no verdict for any check slot. */
function gateRanNothing(verification: SubagentVerificationStatus): boolean {
  return (
    verification.tests === 'not_run' &&
    verification.typecheck === 'not_run' &&
    verification.lint === 'not_run'
  );
}

/**
 * Evidence backfill is for implement-style workers whose own final checks
 * prove their change. `verify` workers run checks to FIND failures (a red
 * repro is the deliverable — judged by the structured verifyVerdict, not by
 * the contract) and `plan` workers analyze without shipping; both keep the
 * script-gate-only semantics.
 */
const EVIDENCE_BACKFILL_EXEMPT_PROFILES = new Set(['verify', 'plan']);

/**
 * Evidence fallback for change sets the script gate cannot run at all
 * (scriptless projects without package.json, or ambiguous multi-package
 * scopes where a repo-wide gate would be too expensive).
 *
 * The worker's own check-like Bash commands were observed live by the
 * verification sensor ledger (`node --test`, `pnpm test`, `tsc`, `oxlint`,
 * RunProjectChecks …), with the last outcome per kind winning — so a
 * red-then-green worker run lands `passed` and a run that ends red lands
 * `failed` instead of the previous misleading `done` + "checks did not run".
 *
 * Scoped change sets (no `packages/|apps/` layout): missing kinds are
 * `not_applicable` (no script exists in a package-less project), so a fully
 * Bash-proven green clears the unverified label. Ambiguous scopes only
 * surface recorded kinds — partial evidence keeps the remaining slots
 * `not_run`, which preserves the honest "unverified" label for partial
 * coverage while still surfacing a final red run as a hard failure.
 */
export function verificationFromCheckEvidence(
  kindVerdicts: CheckKindVerdicts | undefined,
  scope: 'scoped' | 'ambiguous',
): SubagentVerificationStatus | undefined {
  const verdicts = kindVerdicts ?? {};
  const hasEvidence = Object.keys(verdicts).length > 0;
  if (!hasEvidence) return undefined;
  const resolve = (slot: 'tests' | 'typecheck' | 'lint'): VerificationVerdict => {
    const verdict = verdicts[slot];
    if (verdict === undefined) return scope === 'scoped' ? 'not_applicable' : 'not_run';
    return verdict;
  };
  return {
    tests: resolve('tests'),
    typecheck: resolve('typecheck'),
    lint: resolve('lint'),
    visual: 'not_run',
  };
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
  let verification: SubagentVerificationStatus;
  if (packageDir === undefined) {
    // Static-site contract: only renderable HTML/CSS/JS sets (not docs/json alone)
    // may stamp checks green via existence + node --check.
    verification = isRenderableStaticSiteChangeSet(filesChanged)
      ? await runStaticCompletionVerification(child.kaos, child.config.cwd, filesChanged)
      : VERIFICATION_NOT_RUN;
  } else {
    const fromPackage = await runPackageCompletionVerification(child, packageDir, signal);
    verification =
      fromPackage !== undefined
        ? fromPackage
        : packageDir === '.' && isRenderableStaticSiteChangeSet(filesChanged)
          ? await runStaticCompletionVerification(child.kaos, child.config.cwd, filesChanged)
          : VERIFICATION_NOT_RUN;
  }
  if (gateRanNothing(verification) && !EVIDENCE_BACKFILL_EXEMPT_PROFILES.has(profileName)) {
    const fromEvidence = verificationFromCheckEvidence(
      child.verificationSensorLedger?.kindVerdicts,
      packageDir === undefined ? 'ambiguous' : 'scoped',
    );
    if (fromEvidence !== undefined) return fromEvidence;
  }
  return verification;
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

/**
 * W6 verification sensor ledger — records recent test/command failures from
 * PostToolUse paths (RunProjectChecks, check-like Bash) for Goal soft advisory.
 */

import type { ExecutableToolResult } from '../loop/types';
import type { RunProjectChecksResult } from '../tools/builtin/ops/run-project-checks';

export interface VerificationFailureRecord {
  readonly toolName: string;
  readonly summary: string;
  readonly recordedAtMs: number;
}

export type VisualSensorVerdict = 'passed' | 'failed' | 'not_run';

/** Host browser class — EINVAL is host skip, not product visual quality. */
export type HostBrowserSensorStatus = 'einval' | 'missing' | 'ok';

export interface VerificationSensorLedger {
  failures: VerificationFailureRecord[];
  lastPassAtMs?: number | undefined;
  /** Last VerifySurface outcome observed this agent run (not_run until called). */
  visualVerdict?: VisualSensorVerdict;
  /** VerifySurface interaction axis (default scenario / explicit actions). */
  interactionVerdict?: VisualSensorVerdict;
  /** VerifySurface craft / banned-ship axis. */
  craftVerdict?: VisualSensorVerdict;
  /**
   * Host browser spawn class. `einval` when VerifySurface/Browser spawn fails
   * with EINVAL on this host — record separately; do not treat as product fail.
   */
  hostBrowser?: HostBrowserSensorStatus;
}

export const VERIFICATION_SENSOR_MAX_FAILURES = 8;
/** Failures older than this are ignored for Goal soft advisory. */
export const VERIFICATION_SENSOR_RECENCY_MS = 30 * 60 * 1000;

export const VERIFICATION_SENSOR_GOAL_DONE_TIP =
  'W6 soft sensor: UpdateGoal(complete) warns when recent RunProjectChecks/Bash test failures exist (plain /goal — not a hard block).';

/** Korean brief — Settings / Mission operator summary. */
export const VERIFICATION_SENSOR_GOAL_DONE_TIP_KO =
  'W6 소프트 센서: 최근 테스트·명령 실패 증거가 있으면 UpdateGoal(complete)에 소프트 경고(plain /goal은 하드 차단 아님).';

const CHECK_TOOL_NAMES = new Set(['RunProjectChecks', 'VerifySurface']);

/**
 * Check-like Bash commands that should feed the verification/mutation sensors.
 * Expanded beyond pure tests so green typecheck/lint/tsc also clear sticky
 * mutation state and red failures (SOTA harness Phase B / Loop1 residual).
 */
const BASH_CHECK_PATTERN =
  /(?:^|[\s;&|])(?:vitest|jest|mocha|playwright\s+test|pytest|cargo\s+test|go\s+test|make\s+test|bun\s+test|node\s+--test|\btsc\b|oxlint|eslint|turbo\s+run|(?:pnpm|npm|yarn)(?:\s+-C\s+\S+)?(?:\s+exec)?(?:\s+run)?\s+(?:test|typecheck|lint|check|build|smoke)\b|(?:pnpm|npm|yarn)\s+-C\s+\S+\s+exec\s+(?:vitest|tsc|eslint|oxlint)\b)/i;

/** TUI ANSI visual smoke — stamps visual=passed without VerifySurface axes. */
const TUI_VISUAL_SMOKE_PATTERN =
  /(?:smoke:visual|visual-smoke|visual_smoke|\bsmoke:visual\b|run\s+smoke:visual\b)/i;

export function isTuiVisualSmokeCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return TUI_VISUAL_SMOKE_PATTERN.test(command);
}

export function createVerificationSensorLedger(): VerificationSensorLedger {
  return { failures: [], visualVerdict: 'not_run' };
}

export function recordVisualVerdict(
  ledger: VerificationSensorLedger,
  verdict: VisualSensorVerdict,
): void {
  ledger.visualVerdict = verdict;
}

/**
 * True until VerifySurface reports a green visual verdict and no failed axis.
 * Missing axis fields after an overall pass are treated as passed (older outputs).
 */
export function surfaceProofAxesSatisfied(ledger: VerificationSensorLedger): boolean {
  if ((ledger.visualVerdict ?? 'not_run') !== 'passed') return false;
  if (ledger.interactionVerdict === 'failed' || ledger.interactionVerdict === 'not_run') {
    return false;
  }
  if (ledger.craftVerdict === 'failed' || ledger.craftVerdict === 'not_run') {
    return false;
  }
  return true;
}

export function surfaceProofAxesIncomplete(ledger: VerificationSensorLedger): boolean {
  return !surfaceProofAxesSatisfied(ledger);
}

export function isVerificationCheckTool(toolName: string): boolean {
  return CHECK_TOOL_NAMES.has(toolName);
}

export function isCheckLikeBashCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  return BASH_CHECK_PATTERN.test(trimmed);
}

export function filterRecentVerificationFailures(
  failures: readonly VerificationFailureRecord[],
  nowMs: number = Date.now(),
): VerificationFailureRecord[] {
  const cutoff = nowMs - VERIFICATION_SENSOR_RECENCY_MS;
  return failures.filter((record) => record.recordedAtMs >= cutoff);
}

export function recordVerificationFailure(
  ledger: VerificationSensorLedger,
  record: Omit<VerificationFailureRecord, 'recordedAtMs'> & { readonly recordedAtMs?: number },
): void {
  const entry: VerificationFailureRecord = {
    ...record,
    recordedAtMs: record.recordedAtMs ?? Date.now(),
  };
  ledger.failures.push(entry);
  if (ledger.failures.length > VERIFICATION_SENSOR_MAX_FAILURES) {
    ledger.failures.splice(0, ledger.failures.length - VERIFICATION_SENSOR_MAX_FAILURES);
  }
}

export function clearVerificationFailures(ledger: VerificationSensorLedger): void {
  ledger.failures = [];
}

export function recordVerificationPass(ledger: VerificationSensorLedger, nowMs: number = Date.now()): void {
  ledger.lastPassAtMs = nowMs;
  clearVerificationFailures(ledger);
}

function summarizeRunProjectChecksFailure(output: string): string {
  try {
    const parsed = JSON.parse(output) as RunProjectChecksResult;
    if (typeof parsed.summary === 'string' && parsed.summary.length > 0) {
      return parsed.summary.slice(0, 240);
    }
    const failed = parsed.checks?.filter((check) => check.exitCode !== 0) ?? [];
    if (failed.length > 0) {
      return `Failed checks: ${failed.map((check) => check.name).join(', ')}`;
    }
  } catch {
    /* fall through */
  }
  return output.trim().slice(0, 240) || 'RunProjectChecks failed';
}

function summarizeBashFailure(args: unknown, output: string): string {
  const command =
    args !== null && typeof args === 'object' && 'command' in args
      ? String((args as { command?: unknown }).command ?? '')
      : '';
  const preview = output.trim().slice(0, 160);
  if (command.length > 0) {
    return preview.length > 0 ? `${command.slice(0, 120)} — ${preview}` : command.slice(0, 200);
  }
  return preview.length > 0 ? preview : 'Bash command failed';
}

/**
 * PostToolUse sensor hook — mutates ledger from a finalized tool result.
 * Clears failures on green RunProjectChecks; records check-like failures.
 */
export function observeVerificationToolResult(
  ledger: VerificationSensorLedger,
  toolName: string,
  args: unknown,
  result: ExecutableToolResult,
): void {
  if (toolName === 'RunProjectChecks') {
    if (result.isError !== true) {
      recordVerificationPass(ledger);
      return;
    }
    const output = toolOutputText(result.output);
    recordVerificationFailure(ledger, {
      toolName,
      summary: summarizeRunProjectChecksFailure(output),
    });
    return;
  }

  if (toolName === 'Bash') {
    const command = extractBashCommand(args);
    if (isTuiVisualSmokeCommand(command)) {
      if (result.isError !== true) {
        recordVisualVerdict(ledger, 'passed');
        // TUI smoke has no web interaction/craft axes.
        ledger.interactionVerdict = undefined;
        ledger.craftVerdict = undefined;
        recordVerificationPass(ledger);
      } else {
        recordVisualVerdict(ledger, 'failed');
        recordVerificationFailure(ledger, {
          toolName,
          summary: summarizeBashFailure(args, toolOutputText(result.output)),
        });
      }
      return;
    }
    if (!isCheckLikeBashCommand(command)) return;
    if (result.isError !== true) {
      // Green check-like Bash clears sticky failure evidence (same as RunProjectChecks).
      recordVerificationPass(ledger);
      return;
    }
    recordVerificationFailure(ledger, {
      toolName,
      summary: summarizeBashFailure(args, toolOutputText(result.output)),
    });
    return;
  }

  if (toolName === 'VerifySurface') {
    observeVerifySurfaceResult(ledger, result);
    return;
  }

  if (isVerificationCheckTool(toolName) && result.isError === true) {
    recordVerificationFailure(ledger, {
      toolName,
      summary: toolOutputText(result.output).trim().slice(0, 240) || `${toolName} failed`,
    });
  }
}

/** Detect Windows spawn EINVAL / host browser class from tool output text. */
export function classifyHostBrowserFromText(text: string): HostBrowserSensorStatus | undefined {
  const blob = text.trim();
  if (blob.length === 0) return undefined;
  // Node spawn EINVAL on this Windows host (Cloak/Playwright/Camoufox).
  if (/\bEINVAL\b/i.test(blob) || /spawn\s+.*\beinval\b/i.test(blob)) {
    return 'einval';
  }
  if (
    /Browser-use runtime is not available/i.test(blob) ||
    /browser runtime missing or not ready/i.test(blob)
  ) {
    return 'missing';
  }
  return undefined;
}

export const HOST_BROWSER_EINVAL_LEDGER_NOTE = 'host_browser=einval';

function observeVerifySurfaceResult(
  ledger: VerificationSensorLedger,
  result: ExecutableToolResult,
): void {
  const output = toolOutputText(result.output);
  const hostClass = classifyHostBrowserFromText(output);
  if (hostClass !== undefined) {
    ledger.hostBrowser = hostClass;
  }
  if (result.isError === true) {
    // visual stays failed — never auto-pass. host_browser=einval is recorded
    // separately so implement closeout can stay mechanical-green.
    recordVisualVerdict(ledger, 'failed');
    recordAxisVerdicts(ledger, output);
    const summary =
      hostClass === 'einval'
        ? `${HOST_BROWSER_EINVAL_LEDGER_NOTE} — ${output.trim().slice(0, 200) || 'VerifySurface spawn EINVAL'}`
        : output.trim().slice(0, 240) || 'VerifySurface failed';
    recordVerificationFailure(ledger, {
      toolName: 'VerifySurface',
      summary,
    });
    return;
  }
  const pass = parseVerifySurfacePass(output);
  recordAxisVerdicts(ledger, output);
  if (pass === true) {
    recordVisualVerdict(ledger, 'passed');
    ledger.hostBrowser = 'ok';
    // Green visual proof clears sticky VerifySurface failures without wiping
    // unrelated RunProjectChecks evidence.
    ledger.failures = ledger.failures.filter((entry) => entry.toolName !== 'VerifySurface');
    return;
  }
  recordVisualVerdict(ledger, 'failed');
  const failSummary =
    pass === false
      ? summarizeVerifySurfaceFailure(output)
      : output.trim().slice(0, 240) || 'VerifySurface did not report pass=true';
  recordVerificationFailure(ledger, {
    toolName: 'VerifySurface',
    summary:
      hostClass === 'einval'
        ? `${HOST_BROWSER_EINVAL_LEDGER_NOTE} — ${failSummary}`
        : failSummary,
  });
}

function recordAxisVerdicts(ledger: VerificationSensorLedger, output: string): void {
  try {
    const parsed = JSON.parse(extractJsonObject(output) ?? output) as {
      axes?: { load?: string; interaction?: string; craft?: string };
    };
    const axes = parsed.axes;
    if (axes === undefined) return;
    if (axes.interaction === 'passed' || axes.interaction === 'failed' || axes.interaction === 'not_run') {
      ledger.interactionVerdict = axes.interaction;
    }
    if (axes.craft === 'passed' || axes.craft === 'failed' || axes.craft === 'not_run') {
      ledger.craftVerdict = axes.craft;
    }
    // load maps onto visualVerdict when present (overall pass still authoritative).
    if (axes.load === 'passed' || axes.load === 'failed') {
      // keep visualVerdict from pass/fail path; axis is informational
    }
  } catch {
    // ignore
  }
}

function extractJsonObject(output: string): string | undefined {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  return output.slice(start, end + 1);
}

function parseVerifySurfacePass(output: string): boolean | undefined {
  try {
    const parsed = JSON.parse(extractJsonObject(output) ?? output) as { pass?: unknown };
    if (typeof parsed.pass === 'boolean') return parsed.pass;
  } catch {
    /* fall through */
  }
  return undefined;
}

function summarizeVerifySurfaceFailure(output: string): string {
  try {
    const parsed = JSON.parse(output) as {
      notes?: readonly string[];
      consoleErrors?: readonly string[];
    };
    const note = parsed.notes?.find((line) => line.trim().length > 0);
    if (note !== undefined) return note.slice(0, 240);
    if ((parsed.consoleErrors?.length ?? 0) > 0) {
      return `VerifySurface console errors: ${parsed.consoleErrors!.slice(0, 2).join('; ')}`.slice(
        0,
        240,
      );
    }
  } catch {
    /* fall through */
  }
  return output.trim().slice(0, 240) || 'VerifySurface pass=false';
}

export function buildTestFailureSoftTips(
  failures: readonly VerificationFailureRecord[],
  nowMs: number = Date.now(),
): readonly string[] {
  const recent = filterRecentVerificationFailures(failures, nowMs);
  if (recent.length === 0) return [];
  const latest = recent.at(-1)!;
  return [
    'Soft sensor: Goal marked complete while recent test/command failure evidence exists.',
    `· Latest: ${latest.toolName} — ${latest.summary}`,
    'Re-run RunProjectChecks or the failing command and confirm green before telling the user you are done.',
    'Hard gate still applies on live fan-out runs (swarm-evidence-gate).',
  ];
}

const OPS_GOAL_SOFT_ADVISORY_SUMMARY_MAX = 64;

function truncateOpsSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= OPS_GOAL_SOFT_ADVISORY_SUMMARY_MAX) return trimmed;
  return `${trimmed.slice(0, OPS_GOAL_SOFT_ADVISORY_SUMMARY_MAX - 1)}…`;
}

/** Compact Ops Goal pane line — live failure summary or W6 soft tip (SSOT). */
export function formatGoalSoftAdvisoryOpsLine(
  failures: readonly VerificationFailureRecord[],
  nowMs: number = Date.now(),
): string {
  const recent = filterRecentVerificationFailures(failures, nowMs);
  if (recent.length === 0) return VERIFICATION_SENSOR_GOAL_DONE_TIP;
  const latest = recent.at(-1)!;
  return `Soft sensor: ${latest.toolName} failed — ${truncateOpsSummary(latest.summary)}`;
}

/** AppState.goalSoftAdvisory payload when recent verification failures exist. */
export function goalSoftAdvisoryFromLedger(
  ledger: VerificationSensorLedger,
  nowMs: number = Date.now(),
): string | null {
  const recent = filterRecentVerificationFailures(ledger.failures, nowMs);
  if (recent.length === 0) return null;
  return formatGoalSoftAdvisoryOpsLine(ledger.failures, nowMs);
}

function extractBashCommand(args: unknown): string {
  if (args === null || typeof args !== 'object') return '';
  const command = (args as { command?: unknown }).command;
  return typeof command === 'string' ? command : '';
}

function toolOutputText(output: ExecutableToolResult['output']): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  if (!Array.isArray(output)) return String(output);
  return output
    .filter(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join('\n');
}

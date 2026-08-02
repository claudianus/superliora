/**
 * Built-in Stop sensor (Claude Stop-hook style, one-shot).
 *
 * When the model ends a turn without Goal mode, sticky PostToolUse evidence
 * (pending mutations / recent check failures) still warrants one forced
 * continuation with a mechanical repair reminder — soft tips alone do not
 * re-enter the loop.
 */

import {
  formatAutoCheckDirective,
  isAutoCheckEnabled,
  resolveAutoCheckPackageDir,
} from './auto-check-sensor';
import {
  buildPendingMutationSoftTips,
  filterRecentMutations,
  type MutationVerificationLedger,
} from './mutation-verification-sensor';
import {
  buildTestFailureSoftTips,
  type VerificationSensorLedger,
} from './verification-sensor-ledger';

export const STOP_SENSOR_ORIGIN_NAME = 'stop_sensor' as const;

/**
 * Loop34a — wire `warning.code` when the built-in Stop sensor forces one repair
 * continuation. Injection alone is model-visible; operators need a named notice.
 */
export const STOP_SENSOR_WARNING_CODE = 'stop-sensor' as const;

export function formatStopSensorWireTip(body: string): string {
  const firstLine = body.split('\n')[0]?.trim() ?? body.trim();
  const head =
    firstLine.length > 0
      ? firstLine
      : 'Stop sensor: turn ended with unverified work still sticky.';
  if (head.startsWith('STOP_SENSOR:')) return head;
  return `STOP_SENSOR: ${head}`;
}

export interface StopSensorInput {
  readonly verificationLedger?: VerificationSensorLedger;
  readonly mutationLedger?: MutationVerificationLedger;
  readonly nowMs?: number;
  /** When true, skip (Goal/Ultrawork already enforce hard gates). */
  readonly skip?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Loop20b: when true, a recent successful AUTO_CHECK_SPAWN already cleared
   * package-scoped verification for this turn — suppress mutation-only stop
   * continuation (verification failures still fire).
   */
  readonly recentAutoCheckSpawnOk?: boolean;
}

/**
 * Returns a user-message body to inject for one-shot stop continuation,
 * or null when the turn may end cleanly.
 */
export function evaluateStopSensor(input: StopSensorInput): string | null {
  if (input.skip === true) return null;
  const nowMs = input.nowMs ?? Date.now();
  const env = input.env ?? process.env;

  const failureTips =
    input.verificationLedger !== undefined
      ? buildTestFailureSoftTips(input.verificationLedger.failures, nowMs)
      : [];
  // Loop20b: green auto-spawn already re-verified mutations this turn —
  // do not re-nudge RunProjectChecks solely from the mutation ledger.
  const suppressMutationTips = input.recentAutoCheckSpawnOk === true;
  const mutationTips =
    !suppressMutationTips && input.mutationLedger !== undefined
      ? buildPendingMutationSoftTips(input.mutationLedger, nowMs)
      : [];

  if (failureTips.length === 0 && mutationTips.length === 0) return null;

  const lines = [
    'Stop sensor: turn ended with unverified work still sticky. Do not claim done yet.',
    ...failureTips.slice(0, 3),
    ...mutationTips.slice(0, 3),
    'Run RunProjectChecks or a green check-like Bash (test/typecheck/lint/tsc), then finish the user-facing summary.',
  ];

  // Loop16a: when SUPERLIORA_AUTO_CHECK=1, force a machine-actionable directive.
  // Loop20b: skip directive when spawn already ran green this turn.
  if (isAutoCheckEnabled(env) && !suppressMutationTips) {
    const packageDir =
      input.mutationLedger !== undefined
        ? resolveAutoCheckPackageDir(
            filterRecentMutations(input.mutationLedger.pending, nowMs).map((r) => r.packageDir),
          )
        : undefined;
    const directive = formatAutoCheckDirective({ packageDir });
    if (!lines.some((line) => line.includes(directive) || line.includes('AUTO_CHECK:'))) {
      lines.push(directive);
    }
  }

  return lines.join('\n');
}

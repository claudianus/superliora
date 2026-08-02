/**
 * Built-in Stop sensor (Claude Stop-hook style, one-shot).
 *
 * When the model ends a turn without Goal mode, sticky PostToolUse evidence
 * (pending mutations / recent check failures) still warrants one forced
 * continuation with a mechanical repair reminder — soft tips alone do not
 * re-enter the loop.
 */

import {
  buildPendingMutationSoftTips,
  type MutationVerificationLedger,
} from './mutation-verification-sensor';
import {
  buildTestFailureSoftTips,
  type VerificationSensorLedger,
} from './verification-sensor-ledger';

export const STOP_SENSOR_ORIGIN_NAME = 'stop_sensor' as const;

export interface StopSensorInput {
  readonly verificationLedger?: VerificationSensorLedger;
  readonly mutationLedger?: MutationVerificationLedger;
  readonly nowMs?: number;
  /** When true, skip (Goal/Ultrawork already enforce hard gates). */
  readonly skip?: boolean;
}

/**
 * Returns a user-message body to inject for one-shot stop continuation,
 * or null when the turn may end cleanly.
 */
export function evaluateStopSensor(input: StopSensorInput): string | null {
  if (input.skip === true) return null;
  const nowMs = input.nowMs ?? Date.now();

  const failureTips =
    input.verificationLedger !== undefined
      ? buildTestFailureSoftTips(input.verificationLedger.failures, nowMs)
      : [];
  const mutationTips =
    input.mutationLedger !== undefined
      ? buildPendingMutationSoftTips(input.mutationLedger, nowMs)
      : [];

  if (failureTips.length === 0 && mutationTips.length === 0) return null;

  const lines = [
    'Stop sensor: turn ended with unverified work still sticky. Do not claim done yet.',
    ...failureTips.slice(0, 3),
    ...mutationTips.slice(0, 3),
    'Run RunProjectChecks or a green check-like Bash (test/typecheck/lint/tsc), then finish the user-facing summary.',
  ];
  return lines.join('\n');
}

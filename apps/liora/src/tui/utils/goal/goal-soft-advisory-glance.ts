/**
 * Goal W6 verification sensor — Ops Goal pane soft advisory (SSOT via @superliora/sdk).
 */

import {
  VERIFICATION_SENSOR_GOAL_DONE_TIP,
  createVerificationSensorLedger,
  goalSoftAdvisoryFromLedger,
  observeVerificationToolResult,
  type VerificationSensorLedger,
} from '@superliora/sdk';

import type { AppState } from '#/tui/types';

const ledgers = new Map<string, VerificationSensorLedger>();

function ledgerFor(sessionId: string): VerificationSensorLedger {
  let ledger = ledgers.get(sessionId);
  if (ledger === undefined) {
    ledger = createVerificationSensorLedger();
    ledgers.set(sessionId, ledger);
  }
  return ledger;
}

/** Drop session-scoped verification ledger (session close / switch). */
export function resetGoalSoftAdvisoryLedger(sessionId: string): void {
  ledgers.delete(sessionId);
}

/** Ops Goal pane — live AppState advisory when wired; else W6 soft tip. */
export function formatGoalSoftAdvisoryOpsDisplayLine(
  advisory: string | null | undefined,
): string {
  if (advisory !== undefined && advisory !== null && advisory.trim().length > 0) {
    const trimmed = advisory.trim();
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
  }
  return VERIFICATION_SENSOR_GOAL_DONE_TIP;
}

/** PostToolUse sensor hook — mutates session ledger and returns AppState patch. */
export function goalSoftAdvisoryPatchFromToolResult(
  sessionId: string,
  toolName: string,
  args: unknown,
  isError: boolean,
  output: string,
  nowMs: number = Date.now(),
): Pick<AppState, 'goalSoftAdvisory'> {
  const ledger = ledgerFor(sessionId);
  observeVerificationToolResult(ledger, toolName, args, { isError, output });
  return { goalSoftAdvisory: goalSoftAdvisoryFromLedger(ledger, nowMs) };
}
